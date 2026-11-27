// checkIn(eventId, code) (R10) com ingressos criados pelo serviço de vendas de F04 — vitrine e canal parceiro —
// em cada status (X13). Worker desligado: as respostas do gateway são entregues na mão (deliverResponses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp } from '../helpers/index.js';
import { CHECKIN_KEYS, CHECKIN_MESSAGES, checkIn } from '../../src/modules/checkin/service.js';
import { getTicket } from '../../src/modules/sales/service.js';
import {
  CARD,
  R10,
  cancelLikeF07,
  deliverResponses,
  expected,
  holdGatewayResponse,
  onSaleEvent,
  sell,
  setTicketStatus,
  ticketRow,
} from './support.js';

const app = useTestApp({ workers: false });

const CHANNELS = ['storefront', 'partner'];

const organizerA = () => app.users.organizerA.id;
const organizerB = () => app.users.organizerB.id;

// Ingresso de um canal já com a resposta do gateway aplicada pelo handler de F04 (confirmed/declined) ou pendente.
async function ticketIn(eventId, channel, status) {
  const card = { confirmed: CARD.approve, declined: CARD.decline, pending: CARD.approveSlow }[status];
  const ticket = await sell(eventId, { card, channel, userId: app.users.participant.id });
  if (status === 'pending') await holdGatewayResponse([ticket.id]);
  else await deliverResponses([ticket.id]);
  const row = await ticketRow(ticket.id);
  assert.equal(row.status, status, `ingresso ${channel} deveria estar ${status}`);
  assert.equal(row.channel, channel);
  return row;
}

test('mensagens e chaves de R10, na ordem da lista', () => {
  assert.deepEqual(CHECKIN_MESSAGES, R10);
  assert.deepEqual(CHECKIN_KEYS, ['invalid', 'event_cancelled', 'not_confirmed', 'already_used', 'released']);
});

test('F06-CA04 (R10, X13): confirmado sem check-in → Entrada liberada e passa a checkedIn; de novo → Ingresso já utilizado', async () => {
  const eventId = await onSaleEvent(organizerA(), { name: 'Liberada' });
  for (const channel of CHANNELS) {
    const ticket = await ticketIn(eventId, channel, 'confirmed');
    assert.equal(ticket.checked_in_at, null);
    assert.equal((await getTicket(ticket.id)).checkedIn, false);

    assert.deepEqual(await checkIn(eventId, ticket.code), expected('released'), channel);
    const after = await ticketRow(ticket.id);
    assert.ok(after.checked_in_at instanceof Date, `${channel}: checked_in_at preenchido`);
    assert.equal(after.status, 'confirmed', 'check-in não é status');
    assert.equal((await getTicket(ticket.id)).checkedIn, true);

    assert.deepEqual(await checkIn(eventId, ticket.code), expected('already_used'), channel);
    assert.deepEqual(await checkIn(eventId, ticket.code), expected('already_used'), channel);
    const again = await ticketRow(ticket.id);
    assert.equal(again.checked_in_at.getTime(), after.checked_in_at.getTime(), 'o segundo check-in não regrava');
    assert.equal(again.status, 'confirmed');
  }
});

test('F06-CA03 (R10, X13): pendente, recusado, cancelado ou estornado → Ingresso não confirmado (vitrine e parceiro)', async () => {
  const eventId = await onSaleEvent(organizerA(), { name: 'Não confirmados' });
  for (const channel of CHANNELS) {
    const pending = await ticketIn(eventId, channel, 'pending');
    const declined = await ticketIn(eventId, channel, 'declined');
    // cancelado/estornado num evento ainda publicado só existem ajustados via SQL (F07 cancela o evento junto)
    const cancelled = await ticketIn(eventId, channel, 'pending');
    await setTicketStatus(cancelled.id, 'cancelled');
    const refunded = await ticketIn(eventId, channel, 'confirmed');
    await setTicketStatus(refunded.id, 'refunded');

    for (const ticket of [pending, declined, cancelled, refunded]) {
      const { status } = await ticketRow(ticket.id);
      assert.deepEqual(await checkIn(eventId, ticket.code), expected('not_confirmed'), `${channel} ${status}`);
      const after = await ticketRow(ticket.id);
      assert.equal(after.checked_in_at, null, `${channel} ${status}: nada gravado`);
      assert.equal(after.status, status);
    }
  }
});

test('X13: o pendente que o gateway confirma depois passa a liberar a entrada', async () => {
  const eventId = await onSaleEvent(organizerA(), { name: 'Confirma depois' });
  for (const channel of CHANNELS) {
    const ticket = await ticketIn(eventId, channel, 'pending');
    assert.deepEqual(await checkIn(eventId, ticket.code), expected('not_confirmed'));
    await deliverResponses([ticket.id]); // cartão 0003: aprovado
    assert.equal((await ticketRow(ticket.id)).status, 'confirmed');
    assert.deepEqual(await checkIn(eventId, ticket.code), expected('released'), channel);
  }
});

test('F06-CA01 (R10, X13): código inexistente, vazio ou de outro evento → Ingresso inválido para este evento', async () => {
  const eventA = await onSaleEvent(organizerA(), { name: 'Evento A' });
  const otherOfA = await onSaleEvent(organizerA(), { name: 'Outro de A' });
  const eventB = await onSaleEvent(organizerB(), { name: 'Evento de B' });
  const fromOtherOfA = await ticketIn(otherOfA, 'storefront', 'confirmed');
  const fromB = await ticketIn(eventB, 'partner', 'confirmed');

  for (const code of ['ZZZZZZZZ', 'ABC', '', '   ', undefined, null, 42, ['ZZZZZZZZ'], { code: 'X' }]) {
    assert.deepEqual(await checkIn(eventA, code), expected('invalid'), JSON.stringify(code));
  }
  assert.deepEqual(await checkIn(eventA, fromOtherOfA.code), expected('invalid'), 'outro evento do mesmo organizador');
  assert.deepEqual(await checkIn(eventA, fromB.code), expected('invalid'), 'evento de outro organizador');
  assert.deepEqual(await checkIn('evt_naoexiste', fromB.code), expected('invalid'), 'evento inexistente');
  assert.deepEqual(await checkIn('', fromB.code), expected('invalid'));
  assert.deepEqual(await checkIn(undefined, fromB.code), expected('invalid'));

  // nenhuma tentativa inválida gravou check-in, e o ingresso continua valendo no evento dele
  assert.equal((await ticketRow(fromOtherOfA.id)).checked_in_at, null);
  assert.equal((await ticketRow(fromB.id)).checked_in_at, null);
  assert.deepEqual(await checkIn(eventB, fromB.code), expected('released'));
  assert.deepEqual(await checkIn(otherOfA, fromOtherOfA.code), expected('released'));
});

test('F06-CA04 (R10): o código é normalizado como em F04 (espaços nas pontas e minúsculas)', async () => {
  const eventId = await onSaleEvent(organizerA(), { name: 'Normalizado' });
  const ticket = await ticketIn(eventId, 'partner', 'confirmed');
  assert.deepEqual(await checkIn(eventId, `  ${ticket.code.toLowerCase()}  `), expected('released'));
  assert.deepEqual(await checkIn(eventId, `\t${ticket.code}\n`), expected('already_used'));
  assert.deepEqual(await checkIn(eventId, ticket.code.toLowerCase()), expected('already_used'));
  // espaço no meio não é normalizado: outro código
  assert.deepEqual(await checkIn(eventId, `${ticket.code.slice(0, 4)} ${ticket.code.slice(4)}`), expected('invalid'));
});

test('F06-CA02 (R10): evento cancelado → Evento cancelado, para estornados e cancelados (como F07 deixa)', async () => {
  const eventId = await onSaleEvent(organizerA(), { name: 'Cancelado' });
  const tickets = [];
  for (const channel of CHANNELS) {
    tickets.push(await ticketIn(eventId, channel, 'confirmed'));
    tickets.push(await ticketIn(eventId, channel, 'pending'));
    tickets.push(await ticketIn(eventId, channel, 'declined'));
  }
  await cancelLikeF07(eventId);

  for (const ticket of tickets) {
    const { status } = await ticketRow(ticket.id);
    assert.ok(['refunded', 'cancelled', 'declined'].includes(status));
    assert.deepEqual(await checkIn(eventId, ticket.code), expected('event_cancelled'), `${ticket.channel} ${status}`);
    assert.equal((await ticketRow(ticket.id)).checked_in_at, null);
  }
});

test('F06-CA05 (R10): a primeira situação verdadeira da lista vence', async () => {
  const cancelledEvent = await onSaleEvent(organizerA(), { name: 'Ordem cancelado' });
  const otherEvent = await onSaleEvent(organizerA(), { name: 'Ordem outro' });
  const usedThenCancelled = await ticketIn(cancelledEvent, 'storefront', 'confirmed');
  assert.deepEqual(await checkIn(cancelledEvent, usedThenCancelled.code), expected('released'));
  const fromOther = await ticketIn(otherEvent, 'partner', 'confirmed');
  await cancelLikeF07(cancelledEvent);

  // 1 antes de 2: código de outro evento (ou inexistente) num evento cancelado → inválido
  assert.deepEqual(await checkIn(cancelledEvent, fromOther.code), expected('invalid'));
  assert.deepEqual(await checkIn(cancelledEvent, 'ZZZZZZZZ'), expected('invalid'));
  // 2 antes de 3 e 4: já usado (agora estornado) num evento cancelado → Evento cancelado
  const used = await ticketRow(usedThenCancelled.id);
  assert.equal(used.status, 'refunded');
  assert.ok(used.checked_in_at instanceof Date);
  assert.deepEqual(await checkIn(cancelledEvent, used.code), expected('event_cancelled'));

  // 3 antes de 4: já passou pelo check-in mas não está confirmado (ajuste via SQL) → não confirmado
  const live = await onSaleEvent(organizerA(), { name: 'Ordem 3 antes de 4' });
  const usedRefunded = await ticketIn(live, 'partner', 'confirmed');
  assert.deepEqual(await checkIn(live, usedRefunded.code), expected('released'));
  await setTicketStatus(usedRefunded.id, 'refunded');
  assert.deepEqual(await checkIn(live, usedRefunded.code), expected('not_confirmed'));

  // o ingresso de outro evento continua liberando no próprio evento
  assert.deepEqual(await checkIn(otherEvent, fromOther.code), expected('released'));
});
