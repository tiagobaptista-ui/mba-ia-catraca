// F06-CA06 (R10) sob concorrência real: check-ins disparados juntos (Promise.all, sem serializar), contra o mesmo
// código e contra um cancelamento (F07) em andamento — locks na ordem evento → ingresso, sem deadlock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { useTestApp, waitFor } from '../helpers/index.js';
import { config } from '../../src/core/config.js';
import { checkIn } from '../../src/modules/checkin/service.js';
import {
  CARD,
  R10,
  cancelLikeF07,
  checkinVia,
  deliverResponses,
  expected,
  loginAs,
  onSaleEvent,
  sell,
  ticketRow,
} from './support.js';

const app = useTestApp({ workers: false });

const BURST = 20;

async function confirmedTickets(eventId, n) {
  const tickets = [];
  for (let i = 0; i < n; i += 1) {
    tickets.push(await sell(eventId, { card: CARD.approve, channel: i % 2 === 0 ? 'partner' : 'storefront', userId: app.users.participant.id }));
  }
  await deliverResponses(tickets.map((t) => t.id));
  for (const t of tickets) assert.equal((await ticketRow(t.id)).status, 'confirmed');
  return tickets;
}

// O mesmo código digitado de jeitos diferentes (todos normalizam para ele).
const spelling = (code, i) => [code, code.toLowerCase(), ` ${code} `, `${code.toLowerCase()}\t`][i % 4];

function burstOf(eventId, code) {
  return Promise.all(Array.from({ length: BURST }, (_, i) => checkIn(eventId, spelling(code, i))));
}

async function assertSingleEntry(results, ticketId, label) {
  const keys = results.map((r) => r.key);
  assert.equal(keys.filter((k) => k === 'released').length, 1, `${label}: ${keys}`);
  assert.equal(keys.filter((k) => k === 'already_used').length, BURST - 1, `${label}: ${keys}`);
  for (const r of results) assert.equal(r.message, R10[r.key]);
  const row = await ticketRow(ticketId);
  assert.ok(row.checked_in_at instanceof Date, `${label}: checked_in_at gravado`);
  assert.equal(row.status, 'confirmed');
}

// Quantas conexões estão esperando lock numa query que contém `fragment` (pg_stat_activity, sem snapshot em cache).
async function waitingOnLock(holder, fragment) {
  await holder.query('SELECT pg_stat_clear_snapshot()');
  const { rows } = await holder.query(
    `SELECT count(*) AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND position($1 in query) > 0`,
    [fragment],
  );
  return rows[0].n;
}

async function withHolder(fn) {
  const holder = new pg.Client({ connectionString: config.databaseUrl });
  await holder.connect();
  try {
    return await fn(holder);
  } finally {
    await holder.query('ROLLBACK').catch(() => {});
    await holder.end();
  }
}

test('check-ins simultâneos do mesmo código liberam uma única entrada', async () => {
  const eventId = await onSaleEvent(app.users.organizerA.id, { name: 'Porta concorrida' });
  const tickets = await confirmedTickets(eventId, 13);

  // 10 códigos, 20 check-ins de cada disparados juntos
  for (const [i, ticket] of tickets.slice(0, 10).entries()) {
    await assertSingleEntry(await burstOf(eventId, ticket.code), ticket.id, `rajada ${i + 1}`);
  }

  // 3 códigos com a rajada represada: uma conexão de fora segura o lock do evento (como um cancelamento ou compra em
  // andamento), os 20 check-ins ficam esperando juntos e disputam o ingresso quando o lock é solto.
  await withHolder(async (holder) => {
    for (const [i, ticket] of tickets.slice(10).entries()) {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
      const burst = burstOf(eventId, ticket.code);
      const waiting = await waitFor(
        async () => {
          const n = await waitingOnLock(holder, 'FROM events WHERE id = $1 FOR SHARE');
          return n >= BURST ? n : 0;
        },
        { timeoutMs: 5000, intervalMs: 10 },
      );
      assert.equal(waiting, BURST, 'os 20 check-ins esperando o lock ao mesmo tempo');
      await holder.query('COMMIT');
      await assertSingleEntry(await burst, ticket.id, `rajada represada ${i + 1}`);
    }
  });
});

test('check-ins simultâneos do mesmo código pela página de gestão: um 200 "Entrada liberada" e o resto "Ingresso já utilizado"', async () => {
  const organizer = await loginAs(app.baseUrl);
  const eventId = await onSaleEvent(app.users.organizerA.id, { name: 'Porta concorrida na web' });
  const tickets = await confirmedTickets(eventId, 3);
  for (const ticket of tickets) {
    const responses = await Promise.all(
      Array.from({ length: BURST }, (_, i) => checkinVia(organizer, eventId, spelling(ticket.code, i))),
    );
    assert.deepEqual([...new Set(responses.map((r) => r.status))], [200]);
    const messages = responses.map((r) => r.result && r.result.message);
    assert.equal(messages.filter((m) => m === R10.released).length, 1, messages.join(' | '));
    assert.equal(messages.filter((m) => m === R10.already_used).length, BURST - 1, messages.join(' | '));
    assert.ok((await ticketRow(ticket.id)).checked_in_at instanceof Date);
  }
});

test('check-in que espera um cancelamento em andamento responde Evento cancelado (lock evento → ingresso)', async () => {
  const eventId = await onSaleEvent(app.users.organizerA.id, { name: 'Cancelando na porta' });
  const [ticket] = await confirmedTickets(eventId, 1);

  await withHolder(async (holder) => {
    // o "F07" de fora trava o evento e ainda não commitou
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
    const pending = checkIn(eventId, ticket.code);
    await waitFor(async () => (await waitingOnLock(holder, 'FROM events WHERE id = $1 FOR SHARE')) >= 1, {
      timeoutMs: 5000,
      intervalMs: 10,
    });
    // o check-in espera no evento sem segurar o ingresso: o cancelamento atualiza os ingressos sem travar
    await holder.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [eventId]);
    await holder.query(
      `UPDATE tickets SET status = CASE status WHEN 'confirmed' THEN 'refunded' WHEN 'pending' THEN 'cancelled'
                                             ELSE status END WHERE event_id = $1`,
      [eventId],
    );
    await holder.query('COMMIT');
    assert.deepEqual(await pending, expected('event_cancelled'));
  });
  const row = await ticketRow(ticket.id);
  assert.equal(row.status, 'refunded');
  assert.equal(row.checked_in_at, null);
});

test('check-ins e cancelamento disparados juntos: sem deadlock e cada resposta coerente com o cancelamento', async () => {
  for (let round = 0; round < 6; round += 1) {
    const eventId = await onSaleEvent(app.users.organizerA.id, { name: `Corrida ${round + 1}` });
    const tickets = await confirmedTickets(eventId, 8);
    const tasks = tickets.map((t) => checkIn(eventId, t.code));
    tasks.splice(round, 0, cancelLikeF07(eventId)); // o cancelamento entra numa posição diferente a cada rodada
    const settled = await Promise.allSettled(tasks);
    const failures = settled.filter((s) => s.status === 'rejected').map((s) => s.reason.message);
    assert.deepEqual(failures, [], `rodada ${round + 1}: nenhuma transação falhou (deadlock)`);

    const results = settled.filter((_, i) => i !== round).map((s) => s.value);
    for (const [i, ticket] of tickets.entries()) {
      const row = await ticketRow(ticket.id);
      assert.equal(row.status, 'refunded', 'o cancelamento estornou todos os confirmados');
      if (results[i].key === 'released') {
        assert.ok(row.checked_in_at instanceof Date, 'liberado antes do cancelamento: check-in gravado');
      } else {
        assert.deepEqual(results[i], expected('event_cancelled'));
        assert.equal(row.checked_in_at, null, 'depois do cancelamento nada é gravado');
      }
    }
  }
});
