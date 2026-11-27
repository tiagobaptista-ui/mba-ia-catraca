// Rajada HTTP pela API de parceiros (C17, X10, R07): 30 POST simultâneos num evento de lotação 5 → exatamente 5 × 202
// e 25 × 409 sold_out, repetido em eventos novos. Worker do gateway ligado, como no produto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp } from '../helpers/index.js';
import { query } from '../../src/core/db.js';
import { getSeatAvailability } from '../../src/modules/sales/service.js';
import { CARD, listedEvent, onSaleEvent, partnerApi, ticketsOf, waitForTicketStatus } from './support.js';

const app = useTestApp({ workers: true });

const BURST = 30;
const CAPACITY = 5;

// Como o `seq 30 | xargs -P 30 curl …` do contrato: as 30 requisições HTTP disparadas juntas, sem serializar.
function burst(api, eventId, tag) {
  return Promise.all(
    Array.from({ length: BURST }, (_, i) =>
      api.purchase(eventId, { buyerEmail: `carga${tag}.${i + 1}@example.com`, cardNumber: CARD.approve }),
    ),
  );
}

async function assertBurst(api, eventId, responses, label) {
  const statuses = responses.map((r) => r.status);
  const accepted = responses.filter((r) => r.status === 202);
  const soldOut = responses.filter((r) => r.status === 409);
  assert.equal(accepted.length, CAPACITY, `${label}: 202 (${statuses})`);
  assert.equal(soldOut.length, BURST - CAPACITY, `${label}: 409 (${statuses})`);
  for (const r of accepted) assert.equal(r.json.status, 'pending');
  for (const r of soldOut) assert.deepEqual(r.json, { error: 'sold_out' });

  const tickets = await ticketsOf(eventId);
  assert.equal(tickets.length, CAPACITY, `${label}: ingressos no banco`);
  assert.deepEqual(new Set(tickets.map((t) => t.id)), new Set(accepted.map((r) => r.json.ticketId)));
  assert.equal(new Set(tickets.map((t) => t.code)).size, CAPACITY, `${label}: códigos distintos`);
  assert.ok(tickets.every((t) => t.channel === 'partner' && t.user_id === null), `${label}: canal partner, sem conta`);
  assert.equal(new Set(tickets.map((t) => t.buyer_email)).size, CAPACITY, `${label}: um comprador por ingresso`);
  assert.deepEqual(await getSeatAvailability(eventId), { capacity: CAPACITY, occupied: CAPACITY, available: 0 });
  assert.equal((await listedEvent(api, eventId)).availableSeats, 0, `${label}: listagem sem vagas`);
  return accepted.map((r) => r.json.ticketId);
}

test('C17, X10 (R07): rajada HTTP de 30 compras simultâneas em lotação 5 → 5 × 202 e 25 × 409, em 5 eventos', async () => {
  const api = partnerApi(app.baseUrl);
  const chargesBefore = (await query('SELECT count(*) AS n FROM gateway_charges')).rows[0].n;
  for (let round = 1; round <= 5; round += 1) {
    const eventId = await onSaleEvent(app.users.organizerA.id, { name: `Rajada API ${round}`, capacity: String(CAPACITY) });
    const ticketIds = await assertBurst(api, eventId, await burst(api, eventId, round), `evento ${round}`);

    // As aprovações chegam e as vagas continuam ocupadas: nada além da lotação, nem depois do gateway.
    for (const id of ticketIds) await waitForTicketStatus(api, id, 'confirmed');
    assert.equal((await listedEvent(api, eventId)).availableSeats, 0);
    const again = await api.purchase(eventId, { buyerEmail: 'depois@example.com', cardNumber: CARD.approve });
    assert.equal(again.status, 409);
  }
  const chargesAfter = (await query('SELECT count(*) AS n FROM gateway_charges')).rows[0].n;
  assert.equal(chargesAfter - chargesBefore, 5 * CAPACITY, 'só as compras aceitas pedem cobrança');
});

test('X10 (R07): rajadas simultâneas em dois eventos não se misturam (60 compras → 5 + 5 aceitas)', async () => {
  const api = partnerApi(app.baseUrl);
  const organizerId = app.users.organizerA.id;
  const first = await onSaleEvent(organizerId, { name: 'Rajada dupla 1', capacity: String(CAPACITY) });
  const second = await onSaleEvent(organizerId, { name: 'Rajada dupla 2', capacity: String(CAPACITY) });
  const [r1, r2] = await Promise.all([burst(api, first, 'a'), burst(api, second, 'b')]);
  await assertBurst(api, first, r1, 'evento 1');
  await assertBurst(api, second, r2, 'evento 2');
});
