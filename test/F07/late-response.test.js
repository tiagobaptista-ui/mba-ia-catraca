// X16 (F07 ← F03), R11: resposta do gateway que chega depois do cancelamento não muda o ingresso. Sem o worker: o
// teste decide quando cada resposta é entregue (deliverResponses / processDueCharges).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { useTestApp, waitFor } from '../helpers/index.js';
import { config } from '../../src/core/config.js';
import { query } from '../../src/core/db.js';
import { onGatewayResponse, processDueCharges } from '../../src/modules/gateway/index.js';
import { getSeatAvailability } from '../../src/modules/sales/service.js';
import { cancelEvent } from '../../src/modules/cancellation/service.js';
import {
  CARD,
  activeTicketsOf,
  buyPartner,
  buyStorefront,
  chargeOf,
  countRows,
  deliverResponses,
  holdResponses,
  serviceEvent,
  statusesOf,
  ticketRow,
} from './support.js';

const app = useTestApp({ workers: false });

test('resposta tardia do gateway não altera ingresso cancelado', async () => {
  const organizerId = app.users.organizerA.id;
  const participant = app.users.participant;
  const eventId = await serviceEvent(organizerId, { name: 'Resposta tardia F07', capacity: '10' });

  // Já respondidos antes do cancelamento: um aprovado (vai a estornado) e um recusado (fica recusado)
  const confirmed = (await buyStorefront(eventId, CARD.approve, participant)).ticket;
  const declined = (await buyPartner(eventId, CARD.decline)).ticket;
  // Respostas lentas (aprovação 0003, recusa 0004), nos dois canais, ainda pendentes no cancelamento
  const slow = [
    (await buyStorefront(eventId, CARD.approveSlow, participant)).ticket,
    (await buyPartner(eventId, CARD.approveSlow)).ticket,
    (await buyStorefront(eventId, CARD.declineSlow, participant)).ticket,
    (await buyPartner(eventId, CARD.declineSlow)).ticket,
  ];
  await holdResponses(slow.map((t) => t.id));
  await deliverResponses([confirmed.id, declined.id]);

  const result = await cancelEvent(organizerId, eventId);
  assert.equal(result.refunded, 1);
  assert.equal(result.cancelled, 4);
  const afterCancel = await Promise.all(slow.map((t) => ticketRow(t.id)));
  assert.ok(afterCancel.every((row) => row.status === 'cancelled'));
  for (const t of slow) assert.equal((await chargeOf(t.id)).responded_at, null, 'gateway ainda não respondeu');

  // As respostas chegam depois do cancelamento (entregues pelo mesmo caminho do worker)
  await deliverResponses(slow.map((t) => t.id));

  for (const [i, t] of slow.entries()) {
    const charge = await chargeOf(t.id);
    assert.notEqual(charge.responded_at, null, 'a resposta foi entregue');
    assert.equal(charge.outcome, i < 2 ? 'approved' : 'declined');
    assert.equal(charge.attempts, 0, 'o handler não falhou');
    assert.deepEqual(await ticketRow(t.id), afterCancel[i], 'ingresso cancelado intocado (status e updated_at)');
  }
  assert.deepEqual(await statusesOf(eventId), {
    [confirmed.id]: 'refunded',
    [declined.id]: 'declined',
    ...Object.fromEntries(slow.map((t) => [t.id, 'cancelled'])),
  });

  // Resposta repetida/atrasada também não "reconfirma" o estornado
  await withResent(confirmed.id);
  assert.equal((await ticketRow(confirmed.id)).status, 'refunded');
  assert.deepEqual(await activeTicketsOf(eventId), []);
  assert.deepEqual(await getSeatAvailability(eventId), { capacity: 10, occupied: 0, available: 0 });
  assert.equal(await countRows('gateway_charges', 'responded_at IS NULL'), 0);
});

// Reentrega uma aprovação já respondida (como um webhook repetido): volta a cobrança para "não respondida" e entrega.
async function withResent(ticketId) {
  await query("UPDATE gateway_charges SET responded_at = NULL, respond_at = now() - interval '1 second' WHERE ticket_id = $1", [
    ticketId,
  ]);
  await processDueCharges({ log: () => {} });
  assert.notEqual((await chargeOf(ticketId)).responded_at, null);
}

test('X16 (R11): aprovação entregue no mesmo instante do cancelamento — a que commita antes é estornada, nunca fica confirmada', async () => {
  const organizerId = app.users.organizerA.id;
  const eventId = await serviceEvent(organizerId, { name: 'Mesmo instante F07', capacity: '5' });
  const { ticket } = await buyPartner(eventId, CARD.approve);
  const other = (await buyPartner(eventId, CARD.approveSlow)).ticket;
  await holdResponses([other.id]);
  await query("UPDATE gateway_charges SET respond_at = now() - interval '1 second' WHERE ticket_id = $1", [ticket.id]);

  // Handler extra, depois do de F04: a entrega já mudou o ingresso para 'confirmed' (linha travada, sem commit) e
  // fica parada aqui até o cancelamento estar esperando por essa linha.
  let entered;
  const inDelivery = new Promise((resolve) => {
    entered = resolve;
  });
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  const removeHandler = onGatewayResponse(async (client, { ticketId }) => {
    if (ticketId !== ticket.id) return;
    const { rows } = await client.query('SELECT status FROM tickets WHERE id = $1', [ticketId]);
    entered(rows[0].status);
    await released;
  });

  const watcher = new pg.Client({ connectionString: config.databaseUrl });
  await watcher.connect();
  try {
    const delivery = processDueCharges({ log: () => {} });
    assert.equal(await inDelivery, 'confirmed', 'F04 confirmou dentro da transação de entrega');

    const cancelling = cancelEvent(organizerId, eventId);
    // O cancelamento trava o evento, muda o status e fica esperando o lock da linha do ingresso
    await waitFor(
      async () => {
        const { rows } = await watcher.query(
          `SELECT count(*) AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%UPDATE tickets%refunded%'`,
        );
        return Number(rows[0].n) === 1;
      },
      { timeoutMs: 5000 },
    );
    assert.equal((await ticketRow(ticket.id)).status, 'pending', 'nada commitado ainda');

    release();
    assert.equal(await delivery, 1);
    const result = await cancelling;
    assert.equal(result.refunded, 1, 'a confirmação commitada antes foi estornada');
    assert.equal(result.cancelled, 1);
  } finally {
    release();
    removeHandler();
    await watcher.end();
  }

  assert.equal((await ticketRow(ticket.id)).status, 'refunded');
  assert.equal((await ticketRow(other.id)).status, 'cancelled');
  assert.notEqual((await chargeOf(ticket.id)).responded_at, null);
  assert.deepEqual(await activeTicketsOf(eventId), []);
});
