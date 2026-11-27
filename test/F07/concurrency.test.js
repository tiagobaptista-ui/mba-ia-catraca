// R11 sob concorrência real, com o worker do gateway rodando ao lado (como no produto): cancelamento disparado junto
// com compras (Promise.all) e respostas do gateway chegando antes, durante e depois do cancelamento.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp, waitFor, SEED } from '../helpers/index.js';
import { query } from '../../src/core/db.js';
import { cancelEvent } from '../../src/modules/cancellation/service.js';
import { getSeatAvailability } from '../../src/modules/sales/service.js';
import {
  CARD,
  activeTicketsOf,
  buy,
  buyPartner,
  buyStorefront,
  chargeOf,
  createEventVia,
  eventRow,
  loginAs,
  serviceEvent,
  signupParticipant,
  ticketRow,
  ticketsOf,
} from './support.js';

const app = useTestApp({ workers: true });

const ROUNDS = 6;
const BURST = 24;
const CAPACITY = 30;
const CARDS = [CARD.approve, CARD.decline, CARD.approveSlow, CARD.declineSlow];

function purchase(eventId, i) {
  const card = CARDS[i % CARDS.length];
  return i % 2 === 0 ? buyStorefront(eventId, card, app.users.participant) : buyPartner(eventId, card);
}

// Espera todas as cobranças do evento serem respondidas pelo worker (0003/0004 levam ~0,6–0,8 s nos gates).
async function waitAllResponded(eventId) {
  await waitFor(
    async () => {
      const { rows } = await query(
        `SELECT count(*) AS n FROM gateway_charges c JOIN tickets t ON t.id = c.ticket_id
          WHERE t.event_id = $1 AND c.responded_at IS NULL`,
        [eventId],
      );
      return rows[0].n === 0;
    },
    { timeoutMs: 10_000, intervalMs: 25 },
  );
}

test('cancelamento concorrente com compras não deixa ingresso ativo', async (t) => {
  const organizerId = app.users.organizerA.id;
  const totals = { ok: 0, eventNotAvailable: 0, soldOut: 0, refunded: 0, cancelled: 0, wonRace: 0, lostRace: 0 };

  for (let round = 1; round <= ROUNDS; round += 1) {
    const eventId = await serviceEvent(organizerId, { name: `Concorrência F07 ${round}`, capacity: String(CAPACITY) });
    // Antes da rajada: um confirmado e um recusado já respondidos, dois lentos pendentes…
    const warmup = await Promise.all([0, 1, 2, 3].map((i) => purchase(eventId, i)));
    await waitFor(async () => (await ticketRow(warmup[0].ticket.id)).status === 'confirmed', { timeoutMs: 5000 });
    await waitFor(async () => (await ticketRow(warmup[1].ticket.id)).status === 'declined', { timeoutMs: 5000 });
    // …e respostas rápidas (40–100 ms) que o worker entrega enquanto a rajada roda
    const inflight = await Promise.all([0, 1, 4, 5].map((i) => purchase(eventId, i)));

    // Rajada: compras e o cancelamento disparados juntos (Promise.all, sem serializar). A posição do cancelamento
    // na rajada muda a cada rodada, do começo ao fim.
    const cancelAt = (round * 5) % (BURST + 1);
    const ops = Array.from({ length: BURST }, (_, i) => () => purchase(eventId, i));
    ops.splice(cancelAt, 0, () => cancelEvent(organizerId, eventId));
    const settled = await Promise.all(ops.map((op) => op()));
    const [cancelled] = settled.splice(cancelAt, 1);
    const late = await Promise.all([0, 1].map((i) => purchase(eventId, i)));
    const all = [...warmup, ...inflight, ...settled, ...late];

    assert.equal(cancelled.event.status, 'cancelled', `rodada ${round}: cancelou`);
    for (const r of all) assert.ok(r.ok || ['event_not_available', 'sold_out'].includes(r.error), JSON.stringify(r));
    assert.ok(late.every((r) => !r.ok && r.error === 'event_not_available'), 'depois do cancelamento não vende');

    // Logo depois do cancelamento: nenhum ingresso ativo e cada compra aceita virou um ingresso
    const accepted = all.filter((r) => r.ok).map((r) => r.ticket.id);
    const tickets = await ticketsOf(eventId);
    assert.deepEqual(new Set(tickets.map((t) => t.id)), new Set(accepted), `rodada ${round}: ingressos = compras aceitas`);
    assert.ok(tickets.length <= CAPACITY, 'R07 continua valendo');
    assert.deepEqual(await activeTicketsOf(eventId), [], `rodada ${round}: nada pendente/confirmado`);
    const count = (status) => tickets.filter((t) => t.status === status).length;
    assert.equal(count('refunded'), cancelled.refunded);
    assert.equal(count('cancelled'), cancelled.cancelled);
    assert.ok(cancelled.refunded >= 1, 'o confirmado antes da rajada foi estornado');
    // Fora os convertidos pelo cancelamento, só sobram os recusados antes dele
    assert.equal(count('declined') + cancelled.refunded + cancelled.cancelled, tickets.length);

    // Depois que o worker entrega todas as respostas (inclusive as lentas): nada muda
    const snapshot = Object.fromEntries(tickets.map((t) => [t.id, t.status]));
    await waitAllResponded(eventId);
    const after = await ticketsOf(eventId);
    assert.deepEqual(Object.fromEntries(after.map((t) => [t.id, t.status])), snapshot, `rodada ${round}: respostas tardias`);
    assert.deepEqual(await activeTicketsOf(eventId), []);
    assert.deepEqual(await getSeatAvailability(eventId), { capacity: CAPACITY, occupied: 0, available: 0 });
    assert.equal((await eventRow(eventId)).status, 'cancelled');

    totals.ok += accepted.length;
    totals.eventNotAvailable += all.filter((r) => r.error === 'event_not_available').length;
    totals.soldOut += all.filter((r) => r.error === 'sold_out').length;
    totals.refunded += cancelled.refunded;
    totals.cancelled += cancelled.cancelled;
    // Disputa real: compra disparada depois do cancelamento que entrou antes dele, e vice-versa
    totals.wonRace += settled.slice(cancelAt).filter((r) => r.ok).length;
    totals.lostRace += settled.slice(0, cancelAt).filter((r) => r.error === 'event_not_available').length;
  }

  t.diagnostic(`compras: ${JSON.stringify(totals)}`);
  // A rajada exercitou os dois lados do cancelamento: compras que entraram antes (convertidas) e depois (recusadas)
  const burstOk = totals.ok - ROUNDS * 8;
  const burstRefused = totals.eventNotAvailable - ROUNDS * 2;
  assert.ok(burstOk > 0 && burstRefused > 0, JSON.stringify(totals));
});

test('X16 (R11): com o worker ligado, a aprovação lenta (0003) que chega depois do cancelamento não muda o ingresso', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Worker tardio F07', capacity: '5' });
  const participant = await signupParticipant(app.baseUrl, 'Téo');

  // T6: cartão 0001 confirmado pelo worker; T5: cartão 0003 comprado em seguida, ainda pendente no cancelamento
  assert.equal((await buy(participant, eventId, CARD.approve)).status, 302);
  const [t6] = await ticketsOf(eventId);
  await waitFor(async () => (await ticketRow(t6.id)).status === 'confirmed', { timeoutMs: 5000, intervalMs: 20 });
  assert.equal((await buy(participant, eventId, CARD.approveSlow)).status, 302);
  const t5 = (await ticketsOf(eventId)).find((t) => t.id !== t6.id);

  const res = await a.post(`/organizer/events/${eventId}/cancel`, {});
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Evento cancelado'));
  assert.equal((await chargeOf(t5.id)).responded_at, null, 'o cancelamento chegou antes da resposta lenta');
  assert.equal((await ticketRow(t6.id)).status, 'refunded');
  assert.equal((await ticketRow(t5.id)).status, 'cancelled');

  await waitFor(async () => (await chargeOf(t5.id)).responded_at !== null, { timeoutMs: 5000, intervalMs: 20 });
  const charge = await chargeOf(t5.id);
  assert.equal(charge.outcome, 'approved');
  assert.ok(charge.responded_at > (await eventRow(eventId)).cancelled_at, 'resposta entregue depois do cancelamento');
  assert.equal((await ticketRow(t5.id)).status, 'cancelled');
  assert.equal((await ticketRow(t6.id)).status, 'refunded');
});
