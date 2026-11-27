// Integração do gateway com o banco, sem o worker do app (cada teste chama processDueCharges ou start()).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { resetDb, closeDb, sleep, waitFor } from '../helpers/index.js';
import { query, withTransaction } from '../../src/core/db.js';
import { config } from '../../src/core/config.js';
import gateway, {
  requestCharge,
  onGatewayResponse,
  processDueCharges,
  InvalidCardError,
} from '../../src/modules/gateway/index.js';

const SERVER_JS = fileURLToPath(new URL('../../src/server.js', import.meta.url));
const MINUTE_AGO = () => new Date(Date.now() - 60_000);
const quiet = () => {};

before(async () => {
  await resetDb();
});

after(async () => {
  await closeDb();
});

beforeEach(async () => {
  await query('TRUNCATE gateway_charges');
});

// Pede uma cobrança numa transação própria (como a compra de F04 fará na dela).
function charge(cardNumber, { ticketId = 'tkt_teste', amountCents = 5000, ...options } = {}) {
  return withTransaction((client) => requestCharge(client, { ticketId, cardNumber, amountCents }, options));
}

async function getCharge(id) {
  const { rows } = await query('SELECT * FROM gateway_charges WHERE id = $1', [id]);
  return rows[0];
}

// Altera campos de config durante fn e restaura depois.
async function withConfig(patch, fn) {
  const saved = Object.fromEntries(Object.keys(patch).map((key) => [key, config[key]]));
  Object.assign(config, patch);
  try {
    return await fn();
  } finally {
    Object.assign(config, saved);
  }
}

// Registra um handler que anota cada entrega; removido ao fim do teste (nenhum handler fica pendurado).
function recordResponses(t, extra = async () => {}) {
  const calls = [];
  const remove = onGatewayResponse(async (client, response) => {
    calls.push(response);
    await extra(client, response);
  });
  t.after(remove);
  return calls;
}

// Contrato C03 (F03-CA03, R06).
test('requestCharge retorna sem esperar a resposta', async (t) => {
  recordResponses(t);
  await withConfig({ gatewayTimeScale: 1 }, async () => {
    // Escala real (1): a resposta do final 0003 está a ≥ 30,5 s; a chamada volta na hora.
    for (const card of ['4000000000000003', '4000000000000001']) {
      const result = await withTransaction(async (client) => {
        const started = performance.now();
        const res = await requestCharge(client, { ticketId: 'tkt_c03', cardNumber: card, amountCents: 12345 });
        const elapsed = performance.now() - started;
        assert.ok(elapsed < 100, `requestCharge levou ${elapsed.toFixed(1)} ms`);
        return res;
      });
      assert.deepEqual(Object.keys(result).sort(), ['chargeId', 'respondAt'], 'não revela o resultado ao chamador');
      assert.match(result.chargeId, /^chg_[a-z2-9]{10}$/);
      assert.ok(result.respondAt instanceof Date);
      const minAhead = card.endsWith('0003') ? 29_000 : 1_500;
      assert.ok(result.respondAt.getTime() - Date.now() > minAhead, `respondAt deveria estar no futuro (${card})`);

      const row = await getCharge(result.chargeId);
      assert.equal(row.ticket_id, 'tkt_c03');
      assert.equal(row.card_last4, card.slice(-4));
      assert.equal(row.amount_cents, 12345);
      assert.equal(row.responded_at, null);
      assert.equal(row.attempts, 0);
      const { rows } = await query('SELECT row_to_json(g)::text AS json FROM gateway_charges g WHERE id = $1', [result.chargeId]);
      assert.ok(!rows[0].json.includes(card), 'o número completo do cartão não pode ser gravado');
      assert.ok(!rows[0].json.includes(card.slice(0, 12)), 'nem o prefixo do cartão');
    }
    assert.equal(await processDueCharges(), 0, 'nada vence antes do instante sorteado');
  });
});

test('requestCharge grava na transação do chamador e rejeita cartão inválido', async () => {
  // Rollback da compra desfaz a cobrança (nunca cobrança sem ingresso).
  await assert.rejects(
    withTransaction(async (client) => {
      await requestCharge(client, { ticketId: 'tkt_rollback', cardNumber: '4000000000000001', amountCents: 1000 });
      throw new Error('compra abortada');
    }),
    /compra abortada/,
  );

  for (const card of ['400000000000001', '40000000000000001', '400000000000000a', 4000000000000001, undefined]) {
    await assert.rejects(charge(card), (err) => {
      assert.ok(err instanceof InvalidCardError);
      assert.equal(err.code, 'invalid_card');
      return true;
    });
  }
  await assert.rejects(charge('4000000000000001', { amountCents: 0 }), TypeError);
  await assert.rejects(charge('4000000000000001', { ticketId: '' }), TypeError);

  const { rows } = await query('SELECT count(*) AS n FROM gateway_charges');
  assert.equal(rows[0].n, 0);
});

// Contrato C04 (F03-CA03).
test('handler só recebe a resposta depois de respondAt', async (t) => {
  // O handler confere, no próprio banco e na transação de entrega, que o instante sorteado já passou.
  const calls = recordResponses(t, async (client, response) => {
    const { rows } = await client.query(
      'SELECT clock_timestamp() >= respond_at AS due FROM gateway_charges WHERE id = $1',
      [response.chargeId],
    );
    response.due = rows[0].due;
    response.at = Date.now();
  });

  // Escala dos gates (0,02): rápido 40–90 ms, lento 610–790 ms.
  const { fast, slow, other } = await withConfig({ gatewayTimeScale: 0.02 }, async () => ({
    fast: await charge('4000000000000001', { ticketId: 'tkt_fast', rng: () => 0.9999999999 }),
    slow: await charge('4000000000000004', { ticketId: 'tkt_slow', rng: () => 0 }),
    other: await charge('4000000000000009', { ticketId: 'tkt_other', rng: () => 0.5 }),
  }));

  assert.equal(await processDueCharges(), 0);
  assert.equal(calls.length, 0, 'nenhuma entrega antes do instante sorteado');

  // Varre continuamente (como o worker) até as três serem entregues.
  await waitFor(async () => {
    await processDueCharges();
    return calls.length === 3;
  }, { timeoutMs: 5000, intervalMs: 10 });

  const byId = Object.fromEntries(calls.map((c) => [c.chargeId, c]));
  const pick = ({ chargeId, ticketId, outcome }) => ({ chargeId, ticketId, outcome });
  assert.deepEqual(pick(byId[fast.chargeId]), { chargeId: fast.chargeId, ticketId: 'tkt_fast', outcome: 'approved' });
  assert.deepEqual(pick(byId[slow.chargeId]), { chargeId: slow.chargeId, ticketId: 'tkt_slow', outcome: 'declined' });
  assert.deepEqual(pick(byId[other.chargeId]), { chargeId: other.chargeId, ticketId: 'tkt_other', outcome: 'declined' });
  for (const { chargeId } of [fast, slow, other]) assert.equal(byId[chargeId].due, true, `${chargeId} entregue antes da hora`);
  for (const c of [fast, slow, other]) assert.ok(byId[c.chargeId].at >= c.respondAt.getTime());
  // A rápida (≤ 90 ms com a escala dos gates) sai antes da lenta (≥ 610 ms).
  assert.ok(byId[fast.chargeId].at < byId[slow.chargeId].at);

  const { rows } = await query('SELECT bool_and(responded_at >= respond_at) AS ok, count(*) AS n FROM gateway_charges');
  assert.deepEqual(rows[0], { ok: true, n: 3 });
  assert.equal(await processDueCharges(), 0, 'nada é entregue duas vezes');
  assert.equal(calls.length, 3);
});

// Contrato C05 (F03-CA04).
test('dois processDueCharges concorrentes entregam cada cobrança uma vez', async (t) => {
  const calls = recordResponses(t, async () => {
    await sleep(3); // segura a trava da cobrança para os dois workers se cruzarem
  });
  const cards = ['4000000000000001', '4000000000000002', '4000000000000003', '4000000000000004', '4000000000000005'];

  for (let round = 0; round < 3; round += 1) {
    calls.length = 0;
    const ids = [];
    for (let i = 0; i < 30; i += 1) {
      const { chargeId } = await charge(cards[i % cards.length], { ticketId: `tkt_${round}_${i}`, now: MINUTE_AGO() });
      ids.push(chargeId);
    }

    const [a, b] = await Promise.all([processDueCharges(), processDueCharges()]);
    assert.equal(a + b, ids.length, `rodada ${round}: ${a} + ${b}`);
    assert.ok(a > 0 && b > 0, `rodada ${round}: os dois workers trabalharam (${a}, ${b})`);

    const counts = new Map();
    for (const c of calls) counts.set(c.chargeId, (counts.get(c.chargeId) || 0) + 1);
    assert.equal(calls.length, ids.length);
    for (const id of ids) assert.equal(counts.get(id), 1, `${id} entregue ${counts.get(id) || 0} vezes`);

    assert.equal(await processDueCharges(), 0);
    const { rows } = await query('SELECT count(*) AS n FROM gateway_charges WHERE responded_at IS NULL');
    assert.equal(rows[0].n, 0);
    await query('TRUNCATE gateway_charges');
  }
});

// Contrato C06 (F03-CA04).
test('handler que falha é reentregue', async (t) => {
  const failing = await charge('4000000000000001', { ticketId: 'tkt_falha', now: MINUTE_AGO() });
  const healthy = await charge('4000000000000002', { ticketId: 'tkt_ok', now: MINUTE_AGO() });

  let failNext = true;
  const calls = recordResponses(t, async (client, response) => {
    if (response.chargeId === failing.chargeId && failNext) {
      failNext = false;
      // Efeito do handler antes da falha: precisa ser desfeito junto.
      await client.query("UPDATE gateway_charges SET ticket_id = 'tkt_alterado' WHERE id = $1", [response.chargeId]);
      throw new Error('falha simulada no handler');
    }
  });

  const logs = [];
  const first = await processDueCharges({ log: (msg) => logs.push(msg) });
  assert.equal(first, 1, 'a outra cobrança é entregue normalmente');
  assert.deepEqual(calls.map((c) => c.chargeId).sort(), [failing.chargeId, healthy.chargeId].sort(), 'uma tentativa por varredura');
  let row = await getCharge(failing.chargeId);
  assert.equal(row.responded_at, null);
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, 'falha simulada no handler');
  assert.equal(row.ticket_id, 'tkt_falha', 'o que o handler fez antes de falhar foi desfeito');
  assert.equal(logs.length, 1);
  assert.match(logs[0], new RegExp(failing.chargeId));
  assert.notEqual((await getCharge(healthy.chargeId)).responded_at, null);

  const second = await processDueCharges({ log: (msg) => logs.push(msg) });
  assert.equal(second, 1, 'segunda varredura entrega');
  row = await getCharge(failing.chargeId);
  assert.notEqual(row.responded_at, null);
  assert.equal(row.attempts, 1);
  assert.ok(row.last_error);
  assert.equal(calls.filter((c) => c.chargeId === failing.chargeId).length, 2);
  assert.equal(calls.filter((c) => c.chargeId === healthy.chargeId).length, 1);
  assert.equal(calls.at(-1).outcome, 'approved');

  assert.equal(await processDueCharges({ log: (msg) => logs.push(msg) }), 0);
  assert.equal(logs.length, 1);
});

test('vários handlers na ordem de registro; a função devolvida remove o handler', async (t) => {
  const order = [];
  const removeFirst = onGatewayResponse(async (client, response) => {
    assert.equal(typeof client.query, 'function');
    order.push(['primeiro', response.chargeId]);
  });
  t.after(removeFirst);
  const removeSecond = onGatewayResponse((_client, response) => {
    order.push(['segundo', response.chargeId]);
  });
  t.after(removeSecond);

  const c1 = await charge('4000000000000001', { now: MINUTE_AGO() });
  assert.equal(await processDueCharges(), 1);
  assert.deepEqual(order, [['primeiro', c1.chargeId], ['segundo', c1.chargeId]]);

  removeFirst();
  const c2 = await charge('4000000000000002', { now: MINUTE_AGO() });
  assert.equal(await processDueCharges(), 1);
  assert.deepEqual(order.slice(2), [['segundo', c2.chargeId]]);

  removeSecond();
  const c3 = await charge('4000000000000002', { now: MINUTE_AGO() });
  assert.equal(await processDueCharges(), 1, 'sem handler, a cobrança é marcada como respondida sem efeito');
  assert.equal(order.length, 3);
  assert.notEqual((await getCharge(c3.chargeId)).responded_at, null);
});

// Contrato C07 (F03-CA05).
test('GATEWAY_MODE diferente de simulated é recusado', async () => {
  for (const mode of ['real', 'stripe', 'Simulated', '']) {
    await withConfig({ gatewayMode: mode }, async () => {
      await assert.rejects(gateway.start(), (err) => {
        assert.match(err.message, /o MVP só tem o gateway simulado/);
        assert.ok(err.message.includes(`GATEWAY_MODE="${mode}"`));
        return true;
      });
    });
  }
  // O modo padrão (simulated) sobe sem chave nenhuma.
  assert.equal(config.gatewayMode, 'simulated');
  const stop = await gateway.start();
  assert.equal(typeof stop, 'function');
  await stop();
});

test('o servidor não sobe com GATEWAY_MODE diferente de simulated', async () => {
  const env = { ...process.env, GATEWAY_MODE: 'real', PORT: '0' };
  await assert.rejects(promisify(execFile)(process.execPath, [SERVER_JS], { env, timeout: 30_000 }), (err) => {
    assert.equal(err.code, 1);
    assert.match(err.stderr, /o MVP só tem o gateway simulado/);
    return true;
  });
});

test('worker entrega sozinho, sem varreduras sobrepostas, e stop() espera a varredura em andamento', async (t) => {
  let active = 0;
  let maxActive = 0;
  const finished = [];
  const remove = onGatewayResponse(async (_client, response) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await sleep(60); // bem mais que GATEWAY_POLL_MS: uma varredura sobreposta apareceria aqui
    active -= 1;
    finished.push(response.chargeId);
  });
  t.after(remove);

  const ids = [];
  for (let i = 0; i < 4; i += 1) ids.push((await charge('4000000000000001', { now: MINUTE_AGO() })).chargeId);

  const stop = await gateway.start();
  await waitFor(() => finished.length >= 1 && active === 1, { timeoutMs: 3000, intervalMs: 5 });
  await stop();
  assert.equal(active, 0, 'stop() esperou o handler em andamento');
  assert.equal(maxActive, 1, 'nenhuma varredura sobreposta');
  assert.deepEqual([...finished].sort(), [...ids].sort());

  // Depois de parado, nada mais é entregue.
  const late = await charge('4000000000000001', { now: MINUTE_AGO() });
  await sleep(Math.max(100, config.gatewayPollMs * 5));
  assert.equal((await getCharge(late.chargeId)).responded_at, null);
  assert.equal(finished.length, ids.length);
  assert.equal(await processDueCharges({ log: quiet }), 1);
});
