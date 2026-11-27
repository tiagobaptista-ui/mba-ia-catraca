# Spec F03 — Gateway de pagamento simulado

Critérios do PRD: F03-CA01 … F03-CA05 e o cross-feature X02 (F03 ← F01). Regras: R06 (compra respondida sem
esperar o gateway), R08 (resposta muda o ingresso — aplicada por F04), R11 (resposta tardia — garantida pelo
handler condicional de F04; aqui garantimos entrega única e assíncrona).

## Consome de F01

`withTransaction`, `query` (`src/core/db.js`), `config.gatewayMode`, `config.gatewayTimeScale`,
`config.gatewayPollMs`, `newId('chg')`, carregador de módulos (`start()` para o worker), helpers de teste.

## Por que persistente

Um `setTimeout` em memória perderia respostas se o app reiniciasse e não aguentaria dois processos. Aqui o
"gateway" grava a cobrança com o instante sorteado da resposta, **na mesma transação da compra** (sem ingresso
sem cobrança e vice-versa), e um worker entrega as respostas vencidas. Num gateway real, a mesma interface
(`requestCharge` + `onGatewayResponse`) seria implementada com chamada HTTP + webhook.

## Modelo de dados — migração `src/db/migrations/003_gateway.sql`

```sql
CREATE TABLE gateway_charges (
  id            text PRIMARY KEY,
  ticket_id     text NOT NULL,          -- sem FK: a tabela tickets é de F04 (wave 3)
  card_last4    text NOT NULL,          -- nunca guardamos o número completo
  amount_cents  integer NOT NULL,
  outcome       text NOT NULL CHECK (outcome IN ('approved', 'declined')),
  respond_at    timestamptz NOT NULL,
  responded_at  timestamptz,
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gateway_charges_due_idx ON gateway_charges (respond_at) WHERE responded_at IS NULL;
CREATE INDEX gateway_charges_ticket_idx ON gateway_charges (ticket_id);
```

## Simulador — `src/modules/gateway/simulator.js`

- `isValidCardNumber(card)` → `typeof card === 'string' && /^\d{16}$/.test(card)`.
- `simulateResponse(cardNumber, rng = Math.random)` → `{ outcome, delayMs }`, pelo final (últimos 4 dígitos):

| Final | outcome | delayMs sorteado (uniforme) | Faixa do brief |
|---|---|---|---|
| `0001` | approved | 2000 – 4500 | 2–5 s |
| `0002` | declined | 2000 – 4500 | 2–5 s |
| `0003` | approved | 30500 – 39500 | 30–40 s |
| `0004` | declined | 30500 – 39500 | 30–40 s |
| outro | declined | 2000 – 4500 | 2–5 s |

  As faixas ficam **dentro** das do brief com folga para o intervalo de varredura do worker (200 ms): o
  observável continua dentro do brief (confirmado em ≤ 5 s; ainda pendente aos 30 s).
- `scaledDelay(delayMs)` = `delayMs × GATEWAY_TIME_SCALE` (padrão 1; os gates usam 0,02).

## API do módulo — `src/modules/gateway/index.js` (`order: 30`)

| Export | Comportamento |
|---|---|
| `requestCharge(client, { ticketId, cardNumber, amountCents }, { rng, now })` | valida o cartão (lança `InvalidCardError` se inválido), sorteia a resposta, insere em `gateway_charges` usando o `client` da transação do chamador e retorna `{ chargeId, respondAt }` **imediatamente** (não revela o resultado ao chamador). |
| `onGatewayResponse(handler)` | registra `handler(client, { chargeId, ticketId, outcome })`, chamado dentro da transação de entrega. Pode haver vários. |
| `processDueCharges({ limit })` | entrega as cobranças vencidas e ainda não respondidas, uma transação por cobrança: `SELECT … WHERE responded_at IS NULL AND respond_at <= now() ORDER BY respond_at LIMIT 1 FOR UPDATE SKIP LOCKED`, chama os handlers, marca `responded_at`. Se um handler lança erro: ROLLBACK, `attempts + 1`, `last_error`, e a cobrança fica para a próxima varredura. Retorna o número entregue. |
| `default.start()` | valida `GATEWAY_MODE === 'simulated'` (outro valor → erro na subida: "o MVP só tem o gateway simulado") e inicia o worker: `setInterval(processDueCharges, GATEWAY_POLL_MS)` sem execuções sobrepostas. Retorna `stop()` que espera a varredura em andamento. |
| `register(app)` | nenhuma rota (gateway é interno). |

`FOR UPDATE SKIP LOCKED` garante entrega única mesmo com dois workers (ou dois processos) varrendo ao mesmo
tempo. Sem handler registrado (antes de F04), a cobrança é marcada como respondida sem efeito.

## Testes — `test/F03/`

- Tabela do simulador com `rng` nos extremos (0 e 0,999…) para cada final; cartão inválido (15/17 dígitos,
  letras, número JS).
- `requestCharge` retorna rápido e grava `card_last4`, nunca o número inteiro.
- Handler não é chamado antes de `respondAt` e é chamado depois, com `outcome` certo.
- Dois `processDueCharges` concorrentes sobre N cobranças → cada uma entregue exatamente uma vez.
- Handler que falha uma vez → reentregue na varredura seguinte (`attempts = 1`).
- Worker iniciado pelo app de teste (`startTestServer({ workers: true })`) entrega sozinho (X02).
- `GATEWAY_MODE` diferente de `simulated` → `start()` rejeita.
