// Roteiro do contrato de F08 (C01–C08, C10) com o worker do gateway ligado, como no produto: ninguém entrega
// resposta na mão. A aprovação lenta do cartão 0003 (~40 s no produto) é segurada pelo teste e liberada no passo
// em que o contrato a espera; o resto chega pelo worker (GATEWAY_TIME_SCALE dos gates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp, waitFor, SEED } from '../helpers/index.js';
import {
  CARD,
  buy,
  cancelEvent,
  checkIn,
  createEventVia,
  eventInput,
  holdResponses,
  loginAs,
  metricsOf,
  panel,
  readPanel,
  releaseResponses,
  ticketIdsOf,
  ticketStatus,
} from './support.js';

const app = useTestApp({ workers: true });

const WAIT = { timeoutMs: 5000, intervalMs: 20 };

async function lastTicket(eventId) {
  return (await ticketIdsOf(eventId)).at(-1);
}

test('contrato F08 C01–C08, C10: painel acompanha compras reais da vitrine e o worker do gateway', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const b = await loginAs(app.baseUrl, SEED.organizerB);
  const p = await loginAs(app.baseUrl, SEED.participant);

  // C01: evento publicado, lotação 2, 100,00
  const E = await createEventVia(a, { name: 'Contrato F08', capacity: '2', price: '100,00' });
  assert.deepEqual(await readPanel(a, E), panel({ available: 2 }));

  // C02: compra lenta (0003) → pendente logo depois
  assert.equal((await buy(p, E, CARD.approveSlow)).status, 302);
  const slow = await lastTicket(E);
  await holdResponses([slow]);
  assert.deepEqual(await readPanel(a, E), panel({ pending: 1, available: 1 }));

  // C03: compra 0001 → o worker confirma
  assert.equal((await buy(p, E, CARD.approve)).status, 302);
  const fast = await lastTicket(E);
  await waitFor(async () => (await ticketStatus(fast)) === 'confirmed', WAIT);
  assert.deepEqual(await readPanel(a, E), panel({ confirmed: 1, pending: 1, available: 0, revenue: 'R$ 100,00' }));

  // C04: lotação 3 e preço 150,00; compra 0001 → receita 100 + 150
  const edited = await a.post(`/organizer/events/${E}`, eventInput({ name: 'Contrato F08', capacity: '3', price: '150,00' }));
  assert.equal(edited.status, 302);
  assert.equal((await buy(p, E, CARD.approve)).status, 302);
  const third = await lastTicket(E);
  await waitFor(async () => (await ticketStatus(third)) === 'confirmed', WAIT);
  assert.deepEqual(await readPanel(a, E), panel({ confirmed: 2, pending: 1, available: 0, revenue: 'R$ 250,00' }));

  // C05: a aprovação lenta chega → passo 9 do Fluxo do avaliador
  await releaseResponses([slow]);
  await waitFor(async () => (await readPanel(a, E)).pending === '0', WAIT);
  assert.deepEqual(await readPanel(a, E), panel({ confirmed: 3, available: 0, revenue: 'R$ 350,00' }));

  // C06: check-in (F06 simulado por SQL) conta sem mudar Confirmados
  await checkIn(slow);
  assert.deepEqual(await readPanel(a, E), panel({ confirmed: 3, checkins: 1, available: 0, revenue: 'R$ 350,00' }));

  // C07: esgotado; lotação 4; compra 0002 recusada pelo worker não conta
  const soldOut = await buy(p, E, CARD.approve);
  assert.equal(soldOut.status, 409);
  assert.match(soldOut.text, /Ingressos esgotados/);
  await a.post(`/organizer/events/${E}`, eventInput({ name: 'Contrato F08', capacity: '4', price: '150,00' }));
  assert.equal((await buy(p, E, CARD.decline)).status, 302);
  const declined = await lastTicket(E);
  await waitFor(async () => (await ticketStatus(declined)) === 'declined', WAIT);
  assert.deepEqual(await readPanel(a, E), panel({ confirmed: 3, checkins: 1, available: 1, revenue: 'R$ 350,00' }));

  // C08: cancelamento (F07 simulado por SQL): estornados fora de Confirmados, Check-ins e Receita
  await cancelEvent(E);
  assert.deepEqual(await readPanel(a, E), panel({ available: 0, refunded: 3 }));

  // C10: B → 404 sem nenhum número nem o nome de E
  const res = await b.get(`/organizer/events/${E}`);
  assert.equal(res.status, 404);
  assert.deepEqual(metricsOf(res.text), {});
  assert.doesNotMatch(res.text, /Contrato F08/);
});
