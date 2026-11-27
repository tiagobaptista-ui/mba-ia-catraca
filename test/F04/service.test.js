// API do serviço de vendas consumida por F05–F08: vagas (R05), consultas e mapeamento do ingresso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp } from '../helpers/index.js';
import { query, withTransaction } from '../../src/core/db.js';
import { createEvent, publishEvent } from '../../src/modules/events/service.js';
import {
  OCCUPYING_STATUSES,
  TICKET_STATUS_LABELS,
  availableSeats,
  countOccupiedSeats,
  getAvailabilityMap,
  getSeatAvailability,
  getTicket,
  listUserTickets,
  purchaseTicket,
} from '../../src/modules/sales/service.js';
import { CARD, countRows, eventInput } from './support.js';

const app = useTestApp({ workers: false });

async function onSaleEvent(overrides = {}) {
  const organizerId = app.users.organizerA.id;
  const { event } = await createEvent(organizerId, eventInput(overrides));
  await publishEvent(organizerId, event.id);
  return event.id;
}

function partnerBuy(eventId, buyerEmail = 'ana@example.com') {
  return purchaseTicket({ eventId, cardNumber: CARD.approveSlow, buyerEmail, channel: 'partner' });
}

async function setStatus(ticketId, status) {
  await query('UPDATE tickets SET status = $2 WHERE id = $1', [ticketId, status]);
}

test('rótulos de status e status que ocupam vaga', () => {
  assert.deepEqual(TICKET_STATUS_LABELS, {
    pending: 'pendente',
    confirmed: 'confirmado',
    declined: 'recusado',
    cancelled: 'cancelado',
    refunded: 'estornado',
  });
  assert.deepEqual([...OCCUPYING_STATUSES], ['pending', 'confirmed']);
});

test('R05: availableSeats = lotação − (pendentes + confirmados), nunca negativo, 0 em evento cancelado', () => {
  assert.equal(availableSeats({ capacity: 5, status: 'published' }, 2), 3);
  assert.equal(availableSeats({ capacity: 5, status: 'published' }, 5), 0);
  assert.equal(availableSeats({ capacity: 3, status: 'published' }, 4), 0);
  assert.equal(availableSeats({ capacity: 5, status: 'cancelled' }, 0), 0);
  assert.equal(availableSeats(null, 0), 0);
});

test('R05: getSeatAvailability e getAvailabilityMap (uma query) contam só pendentes e confirmados', async () => {
  const mixed = await onSaleEvent({ name: 'Mistura', capacity: '6' });
  const statuses = ['pending', 'confirmed', 'declined', 'cancelled', 'refunded', 'confirmed'];
  for (const status of statuses) {
    const { ticket } = await partnerBuy(mixed);
    await setStatus(ticket.id, status);
  }
  const empty = await onSaleEvent({ name: 'Vazio', capacity: '2' });
  const full = await onSaleEvent({ name: 'Cheio', capacity: '1' });
  await partnerBuy(full);
  const cancelled = await onSaleEvent({ name: 'Cancelado', capacity: '5' });
  await query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [cancelled]);

  assert.deepEqual(await getSeatAvailability(mixed), { capacity: 6, occupied: 3, available: 3 });
  assert.deepEqual(await getSeatAvailability(empty), { capacity: 2, occupied: 0, available: 2 });
  assert.deepEqual(await getSeatAvailability(full), { capacity: 1, occupied: 1, available: 0 });
  assert.deepEqual(await getSeatAvailability(cancelled), { capacity: 5, occupied: 0, available: 0 });
  assert.equal(await getSeatAvailability('evt_inexistente'), null);
  assert.equal(await getSeatAvailability(undefined), null);

  const map = await getAvailabilityMap([mixed, empty, full, cancelled, 'evt_inexistente', mixed]);
  assert.ok(map instanceof Map);
  assert.deepEqual(Object.fromEntries(map), { [mixed]: 3, [empty]: 2, [full]: 0, [cancelled]: 0 });
  assert.equal((await getAvailabilityMap([])).size, 0);
  assert.equal((await getAvailabilityMap(undefined)).size, 0);

  await withTransaction(async (client) => {
    assert.equal(await countOccupiedSeats(client, mixed), 3);
  });
});

test('mapTicket/getTicket: formato do ingresso, checkedIn como atributo à parte; canal parceiro sem conta', async () => {
  const eventId = await onSaleEvent({ name: 'Formato', capacity: '3', price: '80,00' });
  const result = await partnerBuy(eventId, 'ana@example.com');
  assert.equal(result.ok, true);
  const { ticket } = result;
  assert.deepEqual(Object.keys(ticket).sort(), [
    'buyerEmail', 'channel', 'checkedIn', 'checkedInAt', 'code', 'createdAt', 'eventId', 'id', 'priceCents',
    'status', 'updatedAt', 'userId',
  ]);
  assert.match(ticket.id, /^tkt_[a-z2-9]{10}$/);
  assert.equal(ticket.eventId, eventId);
  assert.equal(ticket.status, 'pending');
  assert.equal(ticket.channel, 'partner');
  assert.equal(ticket.userId, null);
  assert.equal(ticket.buyerEmail, 'ana@example.com');
  assert.equal(ticket.priceCents, 8000);
  assert.equal(ticket.checkedIn, false);
  assert.equal(ticket.checkedInAt, null);
  assert.ok(ticket.createdAt instanceof Date);
  assert.deepEqual(await getTicket(ticket.id), ticket);

  await query('UPDATE tickets SET checked_in_at = now() WHERE id = $1', [ticket.id]);
  const checked = await getTicket(ticket.id);
  assert.equal(checked.checkedIn, true);
  assert.ok(checked.checkedInAt instanceof Date);
  assert.equal(checked.status, 'pending', 'check-in não é status');

  assert.equal(await getTicket('tkt_inexistente'), null);
  assert.equal(await getTicket(''), null);
  assert.equal(await getTicket(undefined), null);
});

test('listUserTickets: só os do participante, mais recentes primeiro, com nome e data do evento', async () => {
  const first = await onSaleEvent({ name: 'Primeiro', capacity: '3' });
  const second = await onSaleEvent({ name: 'Segundo', capacity: '3' });
  const participant = app.users.participant;
  const buyAs = (eventId) =>
    purchaseTicket({
      eventId,
      cardNumber: CARD.approveSlow,
      buyerEmail: participant.email,
      userId: participant.id,
      channel: 'storefront',
    });
  const t1 = (await buyAs(first)).ticket;
  const t2 = (await buyAs(second)).ticket;
  await partnerBuy(first); // canal parceiro: sem conta, fora de "Meus ingressos"

  const list = await listUserTickets(participant.id);
  assert.deepEqual(list.map((t) => t.id), [t2.id, t1.id]);
  assert.equal(list[0].eventName, 'Segundo');
  assert.equal(list[1].eventName, 'Primeiro');
  assert.ok(list[0].eventStartsAt instanceof Date);
  assert.equal(list[0].eventStatus, 'published');
  assert.equal(list[0].userId, participant.id);
  assert.equal(list[0].channel, 'storefront');

  assert.deepEqual(await listUserTickets(app.users.organizerB.id), []);
  assert.deepEqual(await listUserTickets(undefined), []);
});

test('purchaseTicket: canal e e-mail do comprador são obrigatórios (erro de programação, nada é gravado)', async () => {
  const eventId = await onSaleEvent({ name: 'Argumentos', capacity: '3' });
  const before = await countRows('tickets');
  await assert.rejects(
    purchaseTicket({ eventId, cardNumber: CARD.approve, buyerEmail: 'a@b.dev', channel: 'balcao' }),
    TypeError,
  );
  await assert.rejects(purchaseTicket({ eventId, cardNumber: CARD.approve, buyerEmail: 'a@b.dev' }), TypeError);
  await assert.rejects(purchaseTicket({ eventId, cardNumber: CARD.approve, buyerEmail: '  ', channel: 'partner' }), TypeError);
  assert.equal(await countRows('tickets'), before);
  assert.deepEqual(
    await purchaseTicket({ eventId: undefined, cardNumber: CARD.approve, buyerEmail: 'a@b.dev', channel: 'partner' }),
    { ok: false, error: 'event_not_available' },
  );
});
