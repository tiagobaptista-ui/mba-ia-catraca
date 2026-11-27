// R07 sob concorrência real: rajadas de compras disparadas juntas (Promise.all, sem serializar), com o worker do
// gateway rodando ao lado, como no produto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { useTestApp, waitFor } from '../helpers/index.js';
import { config } from '../../src/core/config.js';
import { query } from '../../src/core/db.js';
import { toDateTimeLocalValue } from '../../src/core/time.js';
import { createEvent, publishEvent, updateEvent } from '../../src/modules/events/service.js';
import { getSeatAvailability, purchaseTicket } from '../../src/modules/sales/service.js';
import { CARD, buy, eventInput, salesExtraOf, signupParticipant, ticketsOf } from './support.js';

const app = useTestApp({ workers: true });

const BURST = 30;
const CAPACITY = 5;

async function onSaleEvent(name, capacity) {
  const organizerId = app.users.organizerA.id;
  const { event } = await createEvent(organizerId, eventInput({ name, capacity: String(capacity) }));
  await publishEvent(organizerId, event.id);
  return event.id;
}

// Cartões que aprovam (rápido e lento): nenhuma vaga é liberada durante a rajada, então o resultado é exato.
const burstCard = (i) => (i % 2 === 0 ? CARD.approve : CARD.approveSlow);

function partnerPurchase(eventId, i) {
  return purchaseTicket({ eventId, cardNumber: burstCard(i), buyerEmail: `rajada${i}@teste.dev`, channel: 'partner' });
}

async function assertBurstOutcome(eventId, results, label) {
  const accepted = results.filter((r) => r.ok);
  const soldOut = results.filter((r) => !r.ok && r.error === 'sold_out');
  assert.equal(accepted.length, CAPACITY, `${label}: aceitas`);
  assert.equal(soldOut.length, BURST - CAPACITY, `${label}: sold_out`);

  const tickets = await ticketsOf(eventId);
  assert.equal(tickets.length, CAPACITY, `${label}: ingressos no banco`);
  assert.deepEqual(new Set(tickets.map((t) => t.id)), new Set(accepted.map((r) => r.ticket.id)));
  assert.ok(tickets.every((t) => t.status === 'pending' || t.status === 'confirmed'));
  assert.equal(new Set(tickets.map((t) => t.code)).size, CAPACITY, `${label}: códigos distintos`);
  const { rows } = await query('SELECT count(*) AS n FROM gateway_charges WHERE ticket_id = ANY($1::text[])', [
    tickets.map((t) => t.id),
  ]);
  assert.equal(rows[0].n, CAPACITY, `${label}: uma cobrança por ingresso aceito`);
  assert.deepEqual(await getSeatAvailability(eventId), { capacity: CAPACITY, occupied: CAPACITY, available: 0 });
}

test('30 compras simultâneas em lotação 5 resultam em 5 aceitas e 25 sold_out (10 eventos)', async () => {
  const chargesBefore = (await query('SELECT count(*) AS n FROM gateway_charges')).rows[0].n;
  for (let round = 1; round <= 10; round += 1) {
    const eventId = await onSaleEvent(`Rajada ${round}`, CAPACITY);
    const results = await Promise.all(Array.from({ length: BURST }, (_, i) => partnerPurchase(eventId, i)));
    await assertBurstOutcome(eventId, results, `evento ${round}`);
  }
  const chargesAfter = (await query('SELECT count(*) AS n FROM gateway_charges')).rows[0].n;
  assert.equal(chargesAfter - chargesBefore, 10 * CAPACITY, 'compras recusadas não geram cobrança');
});

test('rajada com o evento travado no disparo: as compras ficam na fila do lock ao mesmo tempo e só 5 entram', async () => {
  // Uma conexão de fora segura o lock do evento enquanto a rajada é disparada: todas as transações que conseguem
  // conexão ficam esperando juntas no SELECT … FOR UPDATE e disputam a vaga quando o lock é solto.
  const holder = new pg.Client({ connectionString: config.databaseUrl });
  await holder.connect();
  try {
    for (let round = 1; round <= 3; round += 1) {
      const eventId = await onSaleEvent(`Fila ${round}`, CAPACITY);
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
      const burst = Promise.all(Array.from({ length: BURST }, (_, i) => partnerPurchase(eventId, i)));
      const waiting = await waitFor(async () => {
        // dentro de uma transação o pg_stat_activity é lido de um snapshot em cache: limpa antes de cada leitura
        await holder.query('SELECT pg_stat_clear_snapshot()');
        const { rows } = await holder.query(
          `SELECT count(*) AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM events WHERE id = $1 FOR UPDATE%'`,
        );
        return rows[0].n >= 10 ? rows[0].n : 0;
      }, { timeoutMs: 5000, intervalMs: 10 });
      assert.ok(waiting >= 10, `${waiting} compras esperando o lock ao mesmo tempo`);
      await holder.query('COMMIT');
      await assertBurstOutcome(eventId, await burst, `fila ${round}`);
    }
  } finally {
    await holder.query('ROLLBACK').catch(() => {});
    await holder.end();
  }
});

test('rajada pela vitrine: 30 POST simultâneos em lotação 5 → 5 × 302 e 25 × 409 com "Ingressos esgotados" (3 eventos)', async () => {
  const participant = await signupParticipant(app.baseUrl, 'Rajada Vitrine');
  for (let round = 1; round <= 3; round += 1) {
    const eventId = await onSaleEvent(`Rajada vitrine ${round}`, CAPACITY);
    const responses = await Promise.all(Array.from({ length: BURST }, (_, i) => buy(participant, eventId, burstCard(i))));
    const statuses = responses.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 302).length, CAPACITY, `vitrine ${round}: ${statuses}`);
    assert.equal(statuses.filter((s) => s === 409).length, BURST - CAPACITY, `vitrine ${round}: ${statuses}`);
    for (const r of responses.filter((x) => x.status === 409)) assert.match(salesExtraOf(r.text), /Ingressos esgotados/);
    assert.equal((await ticketsOf(eventId)).length, CAPACITY);
    assert.equal((await getSeatAvailability(eventId)).available, 0);
  }
});

test('compras simultâneas com redução de lotação na gestão: as vagas ocupadas nunca passam da lotação (R03, R07)', async () => {
  const organizerId = app.users.organizerA.id;
  for (let round = 1; round <= 5; round += 1) {
    const name = `Lotação disputada ${round}`;
    const eventId = await onSaleEvent(name, 10);
    const { rows } = await query('SELECT starts_at FROM events WHERE id = $1', [eventId]);
    const reduceTo4 = eventInput({ name, capacity: '4', startsAt: toDateTimeLocalValue(rows[0].starts_at) });

    // 15 compras e a redução 10 → 4 disparadas juntas; a redução entra numa posição diferente a cada rodada.
    const tasks = Array.from({ length: 15 }, (_, i) => partnerPurchase(eventId, i));
    tasks.splice(round * 2, 0, updateEvent(organizerId, eventId, reduceTo4));
    const results = await Promise.all(tasks);
    const update = results[round * 2];
    const accepted = results.filter((r, i) => i !== round * 2 && r.ok).length;

    const availability = await getSeatAvailability(eventId);
    assert.ok(availability.occupied <= availability.capacity, `rodada ${round}: ${JSON.stringify(availability)}`);
    assert.equal(accepted, availability.occupied);
    if (update.event) {
      // a redução passou antes de 5 compras: a lotação nova vale para as seguintes
      assert.equal(availability.capacity, 4);
      assert.equal(accepted, 4);
    } else {
      // o guard viu mais de 4 ocupadas e recusou com a mensagem de R03
      assert.equal(update.status, 409);
      const match = /^A lotação não pode ficar menor que as vagas ocupadas \((\d+)\)\.$/.exec(update.errors[0]);
      assert.ok(match && Number(match[1]) > 4, update.errors[0]);
      assert.equal(availability.capacity, 10);
      assert.equal(accepted, 10);
    }
  }
});
