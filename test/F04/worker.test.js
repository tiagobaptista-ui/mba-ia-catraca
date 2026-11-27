// X07 (F04 ← F03): com o worker do gateway iniciado pelo app (como no produto), ninguém entrega resposta na mão.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp, waitFor, SEED } from '../helpers/index.js';
import {
  CARD,
  HAS_PURCHASE_FORM,
  buy,
  cardOf,
  createEventVia,
  loginAs,
  myTicketRows,
  salesExtraOf,
  signupParticipant,
} from './support.js';

const app = useTestApp({ workers: true });

async function statusIn(client, eventId) {
  const row = myTicketRows((await client.get('/my-tickets')).text).find((r) => r.eventId === eventId);
  return row ? row.label : null;
}

test('X07 (R08): compra com final 0001 fica confirmada depois da resposta do gateway, com o mesmo código', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Worker 0001', capacity: '2' });
  const p1 = await signupParticipant(app.baseUrl, 'Lia');

  assert.equal((await buy(p1, eventId, CARD.approve)).status, 302);
  const [before] = myTicketRows((await p1.get('/my-tickets')).text);
  assert.ok(['pendente', 'confirmado'].includes(before.label));

  await waitFor(async () => (await statusIn(p1, eventId)) === 'confirmado', { timeoutMs: 5000, intervalMs: 20 });
  const [after] = myTicketRows((await p1.get('/my-tickets')).text);
  assert.equal(after.code, before.code);
  assert.equal(after.status, 'confirmed');
});

test('X07 (R05, R08): compra com final 0002 fica recusada e a vaga volta à vitrine', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Worker 0002', capacity: '1' });
  const p1 = await signupParticipant(app.baseUrl, 'Mel');
  const p2 = await signupParticipant(app.baseUrl, 'Nina');

  assert.equal((await buy(p1, eventId, CARD.decline)).status, 302);
  await waitFor(async () => (await statusIn(p1, eventId)) === 'recusado', { timeoutMs: 5000, intervalMs: 20 });

  const page = salesExtraOf((await p2.get(`/events/${eventId}`)).text);
  assert.match(page, HAS_PURCHASE_FORM);
  assert.match(page, /1 vaga disponível/);
  assert.match(cardOf((await p2.get('/')).text, eventId), /1 vaga disponível/);
  assert.equal((await buy(p2, eventId, CARD.approve)).status, 302);
  await waitFor(async () => (await statusIn(p2, eventId)) === 'confirmado', { timeoutMs: 5000, intervalMs: 20 });
  assert.match(salesExtraOf((await p1.get(`/events/${eventId}`)).text), /Ingressos esgotados/);
});

test('X07 (R05): recusa lenta (0004) segura a vaga enquanto pendente e a devolve quando chega', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Worker 0004', capacity: '1' });
  const p1 = await signupParticipant(app.baseUrl, 'Otto');
  const p2 = await signupParticipant(app.baseUrl, 'Pia');

  assert.equal((await buy(p1, eventId, CARD.declineSlow)).status, 302);
  // Com a escala dos gates (0,02), a recusa lenta chega em ~0,6–0,8 s: antes disso, esgotado.
  assert.equal(await statusIn(p1, eventId), 'pendente');
  assert.equal((await buy(p2, eventId, CARD.approve)).status, 409);

  await waitFor(async () => (await statusIn(p1, eventId)) === 'recusado', { timeoutMs: 5000, intervalMs: 20 });
  assert.match(salesExtraOf((await p2.get(`/events/${eventId}`)).text), HAS_PURCHASE_FORM);
});
