// getDashboard (F08, R12) sem o worker do gateway: ingressos criados pelo serviço de vendas de F04 (vitrine e
// parceiro), respostas entregues pelo teste (deliverResponses) e efeitos de F06/F07 simulados por SQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp } from '../helpers/index.js';
import { createEvent, publishEvent, updateEvent, getEvent } from '../../src/modules/events/service.js';
import { getSeatAvailability, purchaseTicket } from '../../src/modules/sales/service.js';
import { getDashboard } from '../../src/modules/dashboard/service.js';
import { getDashboard as exportedFromModule } from '../../src/modules/dashboard/index.js';
import {
  CARD,
  cancelEvent,
  checkIn,
  deliverResponses,
  eventInput,
  holdResponses,
  setTicketStatus,
  ticketStatus,
} from './support.js';

const app = useTestApp({ workers: false });

async function onSaleEvent(overrides = {}) {
  const organizerId = app.users.organizerA.id;
  const { event } = await createEvent(organizerId, eventInput({ name: 'Painel F08', ...overrides }));
  await publishEvent(organizerId, event.id);
  return event.id;
}

function storefrontBuy(eventId, cardNumber) {
  const { id: userId, email } = app.users.participant;
  return purchaseTicket({ eventId, cardNumber, buyerEmail: email, userId, channel: 'storefront' });
}

function partnerBuy(eventId, cardNumber) {
  return purchaseTicket({ eventId, cardNumber, buyerEmail: 'ana@example.com', channel: 'partner' });
}

// Compra e devolve o id do ingresso (falha o teste se a compra não for aceita).
async function bought(promise) {
  const result = await promise;
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.ticket.id;
}

const ZERO = { confirmed: 0, pending: 0, checkins: 0, revenueCents: 0, refunded: 0 };

test('F08-CA01: evento sem ingressos → zeros, Vagas disponíveis = lotação, Receita 0', async () => {
  const eventId = await onSaleEvent({ capacity: '2', price: '100,00' });
  assert.deepEqual(await getDashboard(eventId), { ...ZERO, available: 2 });
  // aceita o objeto evento (seção da página de gestão) ou o id (PRD: getDashboard(eventId))
  assert.deepEqual(await getDashboard(await getEvent(eventId)), { ...ZERO, available: 2 });
  assert.equal(exportedFromModule, getDashboard);

  // rascunho também tem painel (sem vendas)
  const { event: draft } = await createEvent(app.users.organizerA.id, eventInput({ capacity: '7' }));
  assert.deepEqual(await getDashboard(draft), { ...ZERO, available: 7 });
});

test('getDashboard de evento inexistente ou id inválido → null', async () => {
  assert.equal(await getDashboard('evt_inexistente'), null);
  assert.equal(await getDashboard({ id: 'evt_inexistente' }), null);
  for (const invalid of [undefined, null, '', 42, {}]) assert.equal(await getDashboard(invalid), null);
});

test('R12: cada status conta só na sua métrica; check-in é atributo à parte (F08-CA02, F08-CA04)', async () => {
  const eventId = await onSaleEvent({ capacity: '10', price: '100,00' });
  const confirmedA = await bought(storefrontBuy(eventId, CARD.approve));
  const confirmedB = await bought(partnerBuy(eventId, CARD.approve));
  const checkedIn = await bought(storefrontBuy(eventId, CARD.approve));
  const pending = await bought(partnerBuy(eventId, CARD.approveSlow));
  const declined = await bought(storefrontBuy(eventId, CARD.decline));
  const cancelled = await bought(partnerBuy(eventId, CARD.approveSlow));
  const refunded = await bought(storefrontBuy(eventId, CARD.approve));
  const refundedCheckedIn = await bought(partnerBuy(eventId, CARD.approve));

  await holdResponses([pending, cancelled]);
  await deliverResponses([confirmedA, confirmedB, checkedIn, declined, refunded, refundedCheckedIn]);
  assert.equal(await ticketStatus(pending), 'pending');
  assert.equal(await ticketStatus(declined), 'declined'); // gateway recusou (R08)
  await checkIn(checkedIn); // F06
  await setTicketStatus(cancelled, 'cancelled'); // F07: pendente com o evento cancelado
  await checkIn(refundedCheckedIn);
  await setTicketStatus(refunded, 'refunded'); // F07: confirmado com o evento cancelado
  await setTicketStatus(refundedCheckedIn, 'refunded');

  assert.deepEqual(await getDashboard(eventId), {
    confirmed: 3, // inclui o que passou pelo check-in
    pending: 1,
    checkins: 1, // só confirmado com check-in (o estornado com check-in fica de fora)
    available: 10 - (3 + 1), // R05: recusado, cancelado e estornado não ocupam vaga
    revenueCents: 3 * 10000, // só confirmados
    refunded: 2,
  });
  assert.equal((await getDashboard(eventId)).available, (await getSeatAvailability(eventId)).available);
});

test('F08-CA05, X18: vitrine e API contam igual (o canal não filtra nada)', async () => {
  const scenario = async (buyer) => {
    const eventId = await onSaleEvent({ capacity: '5', price: '80,00' });
    const [c1, c2, p1, r1] = [
      await bought(buyer(eventId, CARD.approve)),
      await bought(buyer(eventId, CARD.approve)),
      await bought(buyer(eventId, CARD.approveSlow)),
      await bought(buyer(eventId, CARD.approve)),
    ];
    await holdResponses([p1]);
    await deliverResponses([c1, c2, r1]);
    await checkIn(c2);
    await setTicketStatus(r1, 'refunded');
    return getDashboard(eventId);
  };
  const expected = { confirmed: 2, pending: 1, checkins: 1, available: 2, revenueCents: 16000, refunded: 1 };
  assert.deepEqual(await scenario(storefrontBuy), expected);
  assert.deepEqual(await scenario(partnerBuy), expected);

  // as duas origens no mesmo evento somam
  const mixed = await onSaleEvent({ capacity: '4', price: '50,00' });
  const tickets = [
    await bought(storefrontBuy(mixed, CARD.approve)),
    await bought(partnerBuy(mixed, CARD.approve)),
    await bought(partnerBuy(mixed, CARD.approveSlow)),
    await bought(storefrontBuy(mixed, CARD.approveSlow)),
  ];
  await holdResponses(tickets.slice(2));
  await deliverResponses(tickets.slice(0, 2));
  assert.deepEqual(await getDashboard(mixed), {
    confirmed: 2,
    pending: 2,
    checkins: 0,
    available: 0,
    revenueCents: 10000,
    refunded: 0,
  });
});

test('F08-CA03, X18 (R03): Receita soma o preço gravado em cada ingresso, não o preço atual do evento', async () => {
  const organizerId = app.users.organizerA.id;
  const eventId = await onSaleEvent({ name: 'Receita', capacity: '2', price: '100,00' });
  const first = await bought(storefrontBuy(eventId, CARD.approve));
  await updateEvent(organizerId, eventId, eventInput({ name: 'Receita', capacity: '3', price: '150,00' }));
  const second = await bought(partnerBuy(eventId, CARD.approve));
  await updateEvent(organizerId, eventId, eventInput({ name: 'Receita', capacity: '4', price: '33,33' }));
  const third = await bought(storefrontBuy(eventId, CARD.approveSlow));
  await holdResponses([third]);
  await deliverResponses([first, second]);

  // 100 + 150 (o pendente de 33,33 ainda não é receita); o preço atual (33,33) não reescreve o passado
  assert.deepEqual(await getDashboard(eventId), {
    confirmed: 2,
    pending: 1,
    checkins: 0,
    available: 1,
    revenueCents: 25000,
    refunded: 0,
  });

  await deliverResponses([third]);
  assert.equal((await getDashboard(eventId)).revenueCents, 25000 + 3333);

  // estorno sai da receita
  await setTicketStatus(second, 'refunded');
  const after = await getDashboard(eventId);
  assert.equal(after.revenueCents, 10000 + 3333);
  assert.equal(after.refunded, 1);
  assert.equal(after.confirmed, 2);
});

test('F08-CA04 (R05): evento cancelado tem 0 vagas; estornados com check-in ficam só em Estornados (F08-CA02)', async () => {
  const eventId = await onSaleEvent({ capacity: '6', price: '100,00' });
  const [c1, c2, p1] = [
    await bought(storefrontBuy(eventId, CARD.approve)),
    await bought(partnerBuy(eventId, CARD.approve)),
    await bought(partnerBuy(eventId, CARD.approveSlow)),
  ];
  await holdResponses([p1]);
  await deliverResponses([c1, c2]);
  await checkIn(c1);
  assert.deepEqual(await getDashboard(eventId), {
    confirmed: 2,
    pending: 1,
    checkins: 1,
    available: 3,
    revenueCents: 20000,
    refunded: 0,
  });

  await cancelEvent(eventId); // F07 simulado
  assert.deepEqual(await getDashboard(eventId), { ...ZERO, available: 0, refunded: 2 });
  assert.equal((await getSeatAvailability(eventId)).available, 0);

  // cancelado sem nenhum ingresso também tem 0 vagas
  const empty = await onSaleEvent({ capacity: '3' });
  await cancelEvent(empty);
  assert.deepEqual(await getDashboard(empty), { ...ZERO, available: 0 });
});

test('X18: Vagas disponíveis do painel = getSeatAvailability de F04 em todo estado', async () => {
  const eventId = await onSaleEvent({ capacity: '3', price: '10,00' });
  const check = async () =>
    assert.equal((await getDashboard(eventId)).available, (await getSeatAvailability(eventId)).available);
  await check();
  const t1 = await bought(storefrontBuy(eventId, CARD.decline));
  await check();
  const t2 = await bought(partnerBuy(eventId, CARD.approve));
  await holdResponses([await bought(partnerBuy(eventId, CARD.approveSlow))]);
  await check();
  await deliverResponses([t1, t2]);
  await check();
  assert.equal((await getDashboard(eventId)).available, 1);
  await cancelEvent(eventId);
  await check();
});
