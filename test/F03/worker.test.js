// X02 (F03 ← F01): o app de teste montado pelo harness aplica a migração do gateway e inicia o worker;
// as respostas chegam sem nenhum passo manual (ninguém chama processDueCharges aqui).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp, waitFor } from '../helpers/index.js';
import { query, withTransaction } from '../../src/core/db.js';
import { requestCharge, onGatewayResponse } from '../../src/modules/gateway/index.js';

const app = useTestApp({ workers: true });

async function respondedAt(id) {
  const { rows } = await query('SELECT responded_at FROM gateway_charges WHERE id = $1', [id]);
  return rows[0]?.responded_at ?? null;
}

test('X02: o app sobe com o módulo gateway e a migração 003 aplicada', async () => {
  const gateway = app.modules.find((m) => m.name === 'gateway');
  assert.ok(gateway, 'módulo gateway carregado pelo carregador de F01');
  assert.equal(gateway.order, 30);
  assert.equal(typeof gateway.start, 'function');
  const { rows } = await query("SELECT name FROM schema_migrations WHERE name = '003_gateway.sql'");
  assert.equal(rows.length, 1);
});

test('X02: worker iniciado pelo app de teste entrega sozinho', async (t) => {
  const calls = [];
  t.after(onGatewayResponse((_client, response) => {
    calls.push(response);
  }));

  const approved = await withTransaction((client) =>
    requestCharge(client, { ticketId: 'tkt_x02_a', cardNumber: '4000000000000001', amountCents: 1000 }));
  const declined = await withTransaction((client) =>
    requestCharge(client, { ticketId: 'tkt_x02_b', cardNumber: '4000000000000002', amountCents: 1000 }));

  await waitFor(() => calls.length === 2, { timeoutMs: 5000 });
  const byTicket = Object.fromEntries(calls.map((c) => [c.ticketId, c]));
  assert.deepEqual(byTicket.tkt_x02_a, { chargeId: approved.chargeId, ticketId: 'tkt_x02_a', outcome: 'approved' });
  assert.deepEqual(byTicket.tkt_x02_b, { chargeId: declined.chargeId, ticketId: 'tkt_x02_b', outcome: 'declined' });
  assert.ok(await respondedAt(approved.chargeId));
  assert.ok(await respondedAt(declined.chargeId));
});

test('X02: cobrança inserida direto no banco também é respondida pelo worker', async () => {
  await query(`INSERT INTO gateway_charges (id, ticket_id, card_last4, amount_cents, outcome, respond_at)
               VALUES ('chg_x02sql', 'tkt_x02sql', '0001', 1000, 'approved', now())`);
  const at = await waitFor(() => respondedAt('chg_x02sql'), { timeoutMs: 3000 });
  assert.ok(at instanceof Date);
});
