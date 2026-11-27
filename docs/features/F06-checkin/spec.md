# Spec F06 — Check-in

Critérios do PRD: F06-CA01 … F06-CA07 e os cross-feature X12 (F06 ← F02) e X13 (F06 ← F04). Regra: R10
(e R04, R13 pela página de gestão).

## Consome

- F02: `loadOwnedEvent`, `addManagementSection`, `renderManagementPage`, status do evento (`events.status`).
- F04: tabela `tickets` (`code`, `event_id`, `status`, `checked_in_at`), normalização de código
  (`findTicketByCode` normaliza com `trim` + maiúsculas; use a mesma regra).

Sem tabela nova (escreve `tickets.checked_in_at`, coluna criada por F04). Módulo `src/modules/checkin/`
(`order: 60`).

## Regra (R10) — `checkIn(eventId, rawCode)` em `src/modules/checkin/service.js`

Retorna `{ key, message }`. A primeira situação verdadeira, na ordem, decide:

| # | Situação | key | message |
|---|---|---|---|
| 1 | código inexistente ou de outro evento | `invalid` | `Ingresso inválido para este evento` |
| 2 | evento cancelado | `event_cancelled` | `Evento cancelado` |
| 3 | ingresso não `confirmed` | `not_confirmed` | `Ingresso não confirmado` |
| 4 | `checked_in_at` preenchido | `already_used` | `Ingresso já utilizado` |
| 5 | nenhuma das anteriores → grava `checked_in_at = now()` | `released` | `Entrada liberada` |

Implementação numa transação, **na mesma ordem de locks da compra e do cancelamento (evento → ingresso)**, para
não haver deadlock com um cancelamento simultâneo:

1. `SELECT status FROM events WHERE id = $1 FOR SHARE` (espera um cancelamento em andamento terminar);
2. `SELECT … FROM tickets WHERE code = $1 AND event_id = $2 FOR UPDATE` → nada = situação 1;
3. avalia 2, 3, 4; na 5, `UPDATE tickets SET checked_in_at = now(), updated_at = now()`.

O `FOR UPDATE` no ingresso serializa dois check-ins do mesmo código: o segundo relê a linha já com
`checked_in_at` e cai na situação 4 (exatamente um `Entrada liberada`). Código vazio → situação 1.

## Interface

- Seção `checkin` (`order: 20`) na página de gestão: formulário `POST /organizer/events/{id}/checkin` com campo
  `code` ("Código do ingresso") e botão "Validar entrada"; abaixo, o resultado da última tentativa em
  `<p class="checkin-result" data-result="<key>">…mensagem…</p>` e o código informado. Em evento cancelado o
  campo continua disponível (vale a lista de R10) e a seção mostra a nota "Evento cancelado".
- `POST /organizer/events/:id/checkin` (com `loadOwnedEvent` → outro organizador recebe 404, R13): executa
  `checkIn` e responde **200** com `renderManagementPage(req, res, req.event, { results: { checkin: { key, message, code } } })`.

## Testes — `test/F06/`

Cada mensagem de R10 com ingressos criados pelo serviço de vendas de F04 (vitrine e canal `partner`) em cada
status (`pending`, `declined`, `cancelled`, `refunded` ajustados via SQL quando preciso); código de outro evento;
código em minúsculas/espaços; ordem das regras (outro evento + cancelado → inválido; já usado + cancelado →
`Evento cancelado`; estornado em evento cancelado → `Evento cancelado`); 20 check-ins simultâneos do mesmo código
→ 1 `Entrada liberada`; organizador B → 404; visitante/participante bloqueados.
