import { config } from '../../core/config.js';
import { withTransaction } from '../../core/db.js';
import { newId } from '../../core/ids.js';
import { isValidCardNumber, simulateResponse, scaledDelay } from './simulator.js';

// Gateway de pagamento simulado, assíncrono e persistente (F03).
// A compra chama requestCharge(client, …) na própria transação: a cobrança é gravada com o resultado e o instante
// sorteados e a chamada volta na hora (R06). Depois, processDueCharges() — chamado pelo worker do módulo — entrega
// cada resposta vencida, uma única vez, aos handlers registrados com onGatewayResponse (F04 aplica R08/R11).
// Num gateway real, a mesma interface seria uma chamada HTTP (requestCharge) + webhook (onGatewayResponse).

export { isValidCardNumber, simulateResponse, scaledDelay } from './simulator.js';

export class InvalidCardError extends Error {
  constructor() {
    super('Número de cartão inválido: informe exatamente 16 dígitos.');
    this.name = 'InvalidCardError';
    this.code = 'invalid_card';
  }
}

// Registra uma cobrança na transação do chamador e retorna { chargeId, respondAt } sem esperar a resposta e sem
// revelar o resultado. Guarda só os 4 últimos dígitos do cartão.
// Opções (para testes): rng (sorteio, padrão Math.random) e now (Date base de respondAt; padrão: relógio do banco).
export async function requestCharge(client, { ticketId, cardNumber, amountCents } = {}, { rng = Math.random, now } = {}) {
  if (!isValidCardNumber(cardNumber)) throw new InvalidCardError();
  if (typeof ticketId !== 'string' || ticketId === '') throw new TypeError('requestCharge: ticketId é obrigatório');
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new TypeError('requestCharge: amountCents deve ser um inteiro positivo (centavos)');
  }
  const { outcome, delayMs } = simulateResponse(cardNumber, rng);
  const chargeId = newId('chg');
  const { rows } = await client.query(
    `INSERT INTO gateway_charges (id, ticket_id, card_last4, amount_cents, outcome, respond_at)
     VALUES ($1, $2, $3, $4, $5,
             COALESCE($6::timestamptz, clock_timestamp()) + $7::double precision * interval '1 millisecond')
     RETURNING respond_at`,
    [chargeId, ticketId, cardNumber.slice(-4), amountCents, outcome, now ?? null, scaledDelay(delayMs)],
  );
  return { chargeId, respondAt: rows[0].respond_at };
}

// Handlers de resposta: handler(client, { chargeId, ticketId, outcome }) roda dentro da transação de entrega
// (use o client recebido). Pode haver vários; são chamados na ordem de registro. Retorna a função que o remove.
const handlers = new Set();

export function onGatewayResponse(handler) {
  if (typeof handler !== 'function') throw new TypeError('onGatewayResponse espera uma função');
  const entry = { handler };
  handlers.add(entry);
  return function removeGatewayHandler() {
    handlers.delete(entry);
  };
}

function errorMessage(err) {
  const text = err instanceof Error ? err.message || err.name : String(err);
  return text.slice(0, 1000);
}

// Próxima cobrança vencida e ainda não respondida. SKIP LOCKED: outro worker (ou processo) que já travou uma
// cobrança faz esta varredura pular para a seguinte, então cada resposta é entregue uma única vez.
const NEXT_DUE_SQL = `
  SELECT id, ticket_id, outcome
    FROM gateway_charges
   WHERE responded_at IS NULL
     AND respond_at <= now()
     AND NOT (id = ANY($1::text[]))
   ORDER BY respond_at, id
   LIMIT 1
   FOR UPDATE SKIP LOCKED`;

// Entrega uma cobrança numa transação própria. Se um handler falha, desfaz o que os handlers fizeram (savepoint),
// conta a falha (attempts + 1, last_error) e deixa a cobrança pendente para a próxima varredura.
function deliverNextDue(skipIds) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(NEXT_DUE_SQL, [skipIds]);
    if (rows.length === 0) return null;
    const { id: chargeId, ticket_id: ticketId, outcome } = rows[0];
    await client.query('SAVEPOINT gateway_delivery');
    try {
      for (const { handler } of [...handlers]) await handler(client, { chargeId, ticketId, outcome });
      await client.query('UPDATE gateway_charges SET responded_at = clock_timestamp() WHERE id = $1', [chargeId]);
      return { chargeId, delivered: true };
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT gateway_delivery');
      const failed = await client.query(
        'UPDATE gateway_charges SET attempts = attempts + 1, last_error = $2 WHERE id = $1 RETURNING attempts',
        [chargeId, errorMessage(err)],
      );
      return { chargeId, delivered: false, attempts: failed.rows[0].attempts, error: err };
    }
  });
}

// Entrega as respostas vencidas (até `limit` cobranças por chamada) e retorna quantas foram entregues.
// Sem handler registrado, a cobrança é marcada como respondida sem efeito. Uma cobrança cujo handler falhou não é
// tentada de novo na mesma chamada.
export async function processDueCharges({ limit = 100, log = console.error } = {}) {
  const failedIds = [];
  let delivered = 0;
  while (delivered + failedIds.length < limit) {
    const result = await deliverNextDue(failedIds);
    if (!result) break;
    if (result.delivered) {
      delivered += 1;
    } else {
      failedIds.push(result.chargeId);
      log(`[gateway] handler falhou na cobrança ${result.chargeId} (falha nº ${result.attempts}); `
        + `nova entrega na próxima varredura: ${errorMessage(result.error)}`);
    }
  }
  return delivered;
}

// O MVP só tem o gateway simulado: qualquer outro GATEWAY_MODE impede a subida (nenhuma chave de pagamento existe).
export function assertSimulatedMode(mode = config.gatewayMode) {
  if (mode !== 'simulated') {
    throw new Error(`GATEWAY_MODE="${mode}" não é suportado: o MVP só tem o gateway simulado (GATEWAY_MODE=simulated).`);
  }
}

// Worker: varre as cobranças vencidas a cada pollMs (GATEWAY_POLL_MS, padrão 200), sem varreduras sobrepostas.
// Retorna stop(), que para o timer e espera a varredura em andamento terminar.
export function startWorker({ pollMs = config.gatewayPollMs, log = console.error } = {}) {
  if (!Number.isFinite(pollMs) || pollMs <= 0) throw new Error(`GATEWAY_POLL_MS inválido: ${pollMs}`);
  let running = null;
  let stopped = false;
  const sweep = () => {
    if (stopped || running) return;
    running = processDueCharges({ log })
      .catch((err) => log(`[gateway] falha na varredura: ${errorMessage(err)}`))
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(sweep, pollMs);
  sweep(); // entrega já na subida o que venceu enquanto o app estava fora do ar
  return async function stopWorker() {
    stopped = true;
    clearInterval(timer);
    const current = running;
    if (current) await current;
  };
}

export default {
  name: 'gateway',
  order: 30,
  // Gateway é interno: nenhuma rota.
  register() {},
  // Chamado pelo carregador de módulos na subida (server.js e startTestServer({ workers: true })).
  async start() {
    assertSimulatedMode();
    if (!Number.isFinite(config.gatewayTimeScale) || config.gatewayTimeScale <= 0) {
      throw new Error(`GATEWAY_TIME_SCALE inválido: ${config.gatewayTimeScale} (use 1; os testes usam 0.02)`);
    }
    return startWorker();
  },
};
