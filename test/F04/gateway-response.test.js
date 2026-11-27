// Handler do gateway (R08, R11) e códigos de ingresso (R09), sem o worker: as respostas são entregues pelo teste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp } from '../helpers/index.js';
import { query, withTransaction } from '../../src/core/db.js';
import { createEvent, publishEvent } from '../../src/modules/events/service.js';
import {
  applyGatewayResponse,
  findTicketByCode,
  getSeatAvailability,
  getTicket,
  purchaseTicket,
} from '../../src/modules/sales/service.js';
import { CARD, countRows, deliverResponses, eventInput, ticketRow, ticketsOf } from './support.js';

const app = useTestApp({ workers: false });

async function onSaleEvent(overrides = {}) {
  const organizerId = app.users.organizerA.id;
  const { event } = await createEvent(organizerId, eventInput(overrides));
  await publishEvent(organizerId, event.id);
  return event.id;
}

function buyAsPartner(eventId, cardNumber, options) {
  return purchaseTicket({ eventId, cardNumber, buyerEmail: 'parceiro@teste.dev', channel: 'partner' }, options);
}

const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

test('resposta do gateway não altera ingresso que não está pendente', async () => {
  const eventId = await onSaleEvent({ name: 'Resposta tardia', capacity: '20' });
  const past = new Date('2026-01-01T12:00:00Z');

  // Cada status que não é pendente recebe uma aprovação e uma recusa atrasadas (ex.: cancelamento de F07 antes da
  // resposta, ou resposta repetida para ingresso já respondido).
  const cases = [];
  for (const status of ['confirmed', 'declined', 'cancelled', 'refunded']) {
    for (const card of [CARD.approveSlow, CARD.declineSlow]) {
      const { ticket } = await buyAsPartner(eventId, card);
      await query('UPDATE tickets SET status = $2, updated_at = $3 WHERE id = $1', [ticket.id, status, past]);
      cases.push({ id: ticket.id, status, card });
    }
  }
  // Controle: pendentes mudam normalmente (R08)
  const approved = (await buyAsPartner(eventId, CARD.approveSlow)).ticket;
  const declined = (await buyAsPartner(eventId, CARD.declineSlow)).ticket;

  await deliverResponses([...cases.map((c) => c.id), approved.id, declined.id]);

  for (const c of cases) {
    const row = await ticketRow(c.id);
    assert.equal(row.status, c.status, `${c.status} com cartão ${c.card.slice(-4)} não pode mudar`);
    assert.equal(row.updated_at.getTime(), past.getTime(), `${c.status}: linha intocada`);
  }
  assert.equal((await ticketRow(approved.id)).status, 'confirmed');
  assert.equal((await ticketRow(declined.id)).status, 'declined');
  assert.equal(await countRows('gateway_charges', 'responded_at IS NULL'), 0, 'todas as respostas foram consumidas');

  // Direto no handler: só pendente muda; resposta repetida não desfaz a anterior
  await withTransaction(async (client) => {
    assert.equal(await applyGatewayResponse(client, { ticketId: approved.id, outcome: 'declined' }), false);
    assert.equal(await applyGatewayResponse(client, { ticketId: declined.id, outcome: 'approved' }), false);
    assert.equal(await applyGatewayResponse(client, { ticketId: 'tkt_inexistente', outcome: 'approved' }), false);
    await assert.rejects(applyGatewayResponse(client, { ticketId: approved.id, outcome: 'talvez' }), /desconhecida/);
  });
  assert.equal((await ticketRow(approved.id)).status, 'confirmed');
  assert.equal((await ticketRow(declined.id)).status, 'declined');
});

test('X07 (R05, R08): aprovação confirma e recusa libera a vaga pelo handler registrado no gateway', async () => {
  const eventId = await onSaleEvent({ name: 'Handler', capacity: '2' });
  const first = (await buyAsPartner(eventId, CARD.approve)).ticket;
  const second = (await buyAsPartner(eventId, CARD.decline)).ticket;
  assert.deepEqual(await getSeatAvailability(eventId), { capacity: 2, occupied: 2, available: 0 });
  assert.deepEqual(await buyAsPartner(eventId, CARD.approve), { ok: false, error: 'sold_out' });

  await deliverResponses([first.id, second.id]);
  assert.equal((await getTicket(first.id)).status, 'confirmed');
  assert.equal((await getTicket(second.id)).status, 'declined');
  assert.deepEqual(await getSeatAvailability(eventId), { capacity: 2, occupied: 1, available: 1 });

  const third = await buyAsPartner(eventId, CARD.approve);
  assert.equal(third.ok, true, 'a vaga liberada pela recusa volta a ser vendida');
  assert.deepEqual(await buyAsPartner(eventId, CARD.approve), { ok: false, error: 'sold_out' });
});

test('códigos de ingresso são únicos (8 caracteres), mesmo quando o gerador repete um código', async () => {
  const eventId = await onSaleEvent({ name: 'Códigos', capacity: '60' });
  for (let i = 0; i < 40; i += 1) assert.equal((await buyAsPartner(eventId, CARD.approveSlow)).ok, true);
  const { rows } = await query('SELECT count(*) AS total, count(DISTINCT code) AS distinct_codes FROM tickets');
  assert.equal(rows[0].total, rows[0].distinct_codes);
  for (const t of await ticketsOf(eventId)) assert.match(t.code, CODE_RE);

  // Colisão: o gerador devolve um código já usado duas vezes; a compra tenta de novo, sem abortar a transação.
  const taken = (await ticketsOf(eventId))[0].code;
  const sequence = [taken, taken, 'ZZZZ2345'];
  const collided = await buyAsPartner(eventId, CARD.approveSlow, { generateCode: () => sequence.shift() });
  assert.equal(collided.ok, true);
  assert.equal(collided.ticket.code, 'ZZZZ2345');
  assert.equal(sequence.length, 0, 'três tentativas');
  assert.equal(await countRows('gateway_charges', 'ticket_id = $1', [collided.ticket.id]), 1);

  // Gerador que só repete: a compra falha inteira (nem ingresso nem cobrança) e a vaga não é consumida.
  const ticketsBefore = await countRows('tickets');
  const chargesBefore = await countRows('gateway_charges');
  const availableBefore = (await getSeatAvailability(eventId)).available;
  await assert.rejects(buyAsPartner(eventId, CARD.approveSlow, { generateCode: () => taken }), /código de ingresso único/);
  assert.equal(await countRows('tickets'), ticketsBefore);
  assert.equal(await countRows('gateway_charges'), chargesBefore);
  assert.equal((await getSeatAvailability(eventId)).available, availableBefore);

  // O banco também garante a unicidade
  await assert.rejects(
    query(
      `INSERT INTO tickets (id, event_id, code, channel, buyer_email, price_cents)
       VALUES ('tkt_duplicado', $1, $2, 'partner', 'x@teste.dev', 100)`,
      [eventId, taken],
    ),
    (err) => err.code === '23505',
  );

  // findTicketByCode normaliza (espaços e minúsculas) — mesma regra que o check-in (F06) usa
  const found = await findTicketByCode('  zzzz2345 ');
  assert.equal(found.id, collided.ticket.id);
  assert.equal(await findTicketByCode('ZZZZ2346'), null);
  assert.equal(await findTicketByCode(''), null);
  assert.equal(await findTicketByCode(12345678), null);
});
