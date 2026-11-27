// Integração com a gestão de eventos de F02: capacity guard (X05) e preço vigente por compra (X06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp, SEED } from '../helpers/index.js';
import { query, withTransaction } from '../../src/core/db.js';
import { toDateTimeLocalValue } from '../../src/core/time.js';
import { capacityGuard } from '../../src/modules/sales/service.js';
import {
  CARD,
  buy,
  createEventVia,
  deliverResponses,
  eventInput,
  loginAs,
  myTicketRows,
  salesExtraOf,
  signupParticipant,
  ticketsOf,
} from './support.js';

const app = useTestApp({ workers: false });

async function eventRow(id) {
  const { rows } = await query('SELECT * FROM events WHERE id = $1', [id]);
  return rows[0];
}

// Formulário de edição com os demais campos iguais aos gravados.
async function editForm(id, changes) {
  const row = await eventRow(id);
  return eventInput({
    name: row.name,
    startsAt: toDateTimeLocalValue(row.starts_at),
    venue: row.venue,
    capacity: String(row.capacity),
    price: `${Math.floor(row.price_cents / 100)},${String(row.price_cents % 100).padStart(2, '0')}`,
    ...changes,
  });
}

test('X05 (R03, R05): com 2 vagas ocupadas, reduzir a lotação para 1 na gestão é rejeitado e aumentar para 3 é aceito', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Guard C12', capacity: '2' });
  const p1 = await signupParticipant(app.baseUrl, 'Hugo');
  const p2 = await signupParticipant(app.baseUrl, 'Iara');

  // 1 confirmado + 1 pendente = 2 vagas ocupadas
  assert.equal((await buy(p1, eventId, CARD.approve)).status, 302);
  await deliverResponses((await ticketsOf(eventId)).map((t) => t.id));
  assert.equal((await buy(p2, eventId, CARD.approveSlow)).status, 302);
  assert.deepEqual((await ticketsOf(eventId)).map((t) => t.status), ['confirmed', 'pending']);

  const rejected = await a.post(`/organizer/events/${eventId}`, await editForm(eventId, { capacity: '1' }));
  assert.equal(rejected.status, 409);
  assert.ok(rejected.text.includes('A lotação não pode ficar menor que as vagas ocupadas (2).'));
  assert.equal((await eventRow(eventId)).capacity, 2);

  const increased = await a.post(`/organizer/events/${eventId}`, await editForm(eventId, { capacity: '3' }));
  assert.equal(increased.status, 302);
  assert.equal((await eventRow(eventId)).capacity, 3);

  // Recusado não ocupa vaga: com 1 recusado a mais, reduzir para 2 (= ocupadas) é aceito
  assert.equal((await buy(p2, eventId, CARD.decline)).status, 302);
  await deliverResponses([(await ticketsOf(eventId)).at(-1).id]);
  assert.deepEqual((await ticketsOf(eventId)).map((t) => t.status), ['confirmed', 'pending', 'declined']);
  const reduced = await a.post(`/organizer/events/${eventId}`, await editForm(eventId, { capacity: '2' }));
  assert.equal(reduced.status, 302);
  assert.equal((await eventRow(eventId)).capacity, 2);
  assert.match(salesExtraOf((await p1.get(`/events/${eventId}`)).text), /Ingressos esgotados/);

  // O guard direto: mensagem com o número de vagas ocupadas, null quando cabe
  await withTransaction(async (client) => {
    const event = { id: eventId, capacity: 2 };
    assert.equal(await capacityGuard(client, event, 1), 'A lotação não pode ficar menor que as vagas ocupadas (2).');
    assert.equal(await capacityGuard(client, event, 2), null);
  });
});

test('X06 (R03): preço alterado na gestão vale só para as compras feitas depois', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Preço C13', capacity: '5', price: '100,00' });
  const p1 = await signupParticipant(app.baseUrl, 'João');
  const p2 = await signupParticipant(app.baseUrl, 'Kel');

  assert.equal((await buy(p1, eventId, CARD.approve)).status, 302);
  assert.equal((await buy(p2, eventId, CARD.approveSlow)).status, 302);

  const edited = await a.post(`/organizer/events/${eventId}`, await editForm(eventId, { price: '150,00' }));
  assert.equal(edited.status, 302);
  assert.equal((await eventRow(eventId)).price_cents, 15000);
  assert.match((await p1.get(`/events/${eventId}`)).text, /R\$ 150,00/);

  assert.equal((await buy(p1, eventId, CARD.approve)).status, 302);
  const tickets = await ticketsOf(eventId);
  assert.deepEqual(tickets.map((t) => t.price_cents), [10000, 10000, 15000]);

  // A cobrança usa o preço gravado no ingresso
  const { rows } = await query(
    `SELECT t.price_cents, g.amount_cents FROM tickets t JOIN gateway_charges g ON g.ticket_id = t.id
      WHERE t.event_id = $1`,
    [eventId],
  );
  assert.equal(rows.length, 3);
  for (const r of rows) assert.equal(r.amount_cents, r.price_cents);

  // Confirmar não reescreve o preço; "Meus ingressos" mostra o valor pago em cada compra
  await deliverResponses(tickets.map((t) => t.id));
  assert.deepEqual((await ticketsOf(eventId)).map((t) => t.price_cents), [10000, 10000, 15000]);
  const mine = myTicketRows((await p1.get('/my-tickets')).text);
  assert.deepEqual(mine.map((r) => r.price), ['R$ 150,00', 'R$ 100,00']);
});
