// Apoio dos testes (F09, robustez): deliverResponses entrega só as cobranças pedidas. Reproduz a falha intermitente
// de "X05 (R03, R05)…" sob carga: a cobrança lenta que o teste queria pendente já tinha vencido e saía junto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp } from '../helpers/index.js';
import { query } from '../../src/core/db.js';
import { createEvent, publishEvent } from '../../src/modules/events/service.js';
import { purchaseTicket } from '../../src/modules/sales/service.js';
import { CARD, deliverResponses, eventInput, ticketRow } from './support.js';

const app = useTestApp({ workers: false });

async function chargeOf(ticketId) {
  const { rows } = await query('SELECT respond_at, responded_at FROM gateway_charges WHERE ticket_id = $1', [ticketId]);
  return rows[0];
}

test('deliverResponses entrega só as cobranças pedidas, mesmo com outra já vencida, e preserva o instante das demais', async () => {
  const organizerId = app.users.organizerA.id;
  const { event } = await createEvent(organizerId, eventInput({ name: 'Entrega seletiva', capacity: '5' }));
  await publishEvent(organizerId, event.id);
  const buy = async (card) =>
    (await purchaseTicket({ eventId: event.id, cardNumber: card, buyerEmail: 'p@teste.dev', channel: 'partner' })).ticket;

  const fast = await buy(CARD.decline);
  const slow = await buy(CARD.approveSlow);
  const later = await buy(CARD.approveSlow);
  // Sob carga, o tempo do cartão lento já passou quando o teste pede a entrega do outro ingresso
  await query("UPDATE gateway_charges SET respond_at = now() - interval '5 seconds' WHERE ticket_id = $1", [slow.id]);
  const dueBefore = (await chargeOf(slow.id)).respond_at;
  const laterBefore = (await chargeOf(later.id)).respond_at;

  await deliverResponses([fast.id]);

  assert.equal((await ticketRow(fast.id)).status, 'declined');
  assert.equal((await ticketRow(slow.id)).status, 'pending', 'a cobrança vencida que não foi pedida não é entregue');
  assert.equal((await chargeOf(slow.id)).responded_at, null);
  assert.equal((await chargeOf(slow.id)).respond_at.getTime(), dueBefore.getTime(), 'instante sorteado restaurado');
  assert.equal((await chargeOf(later.id)).respond_at.getTime(), laterBefore.getTime(), 'instante sorteado restaurado');

  await deliverResponses([slow.id]);
  assert.equal((await ticketRow(slow.id)).status, 'confirmed');
  assert.equal((await ticketRow(later.id)).status, 'pending');
});
