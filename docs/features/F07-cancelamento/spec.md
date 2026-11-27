# Spec F07 — Cancelamento de evento

Critérios do PRD: F07-CA01 … F07-CA06 e os cross-feature X14 (F07 ← F02), X15 (F07 ← F04) e X16 (F07 ← F03).
Regra: R11 (e R05: vagas 0 em cancelado; R13).

## Consome

- F02: `lockEvent`, `loadOwnedEvent`, `addManagementSection`, `renderManagementPage`, bloqueio de edição e
  republicação de evento `cancelled` (já em `updateEvent`/`publishEvent`), `listOnSaleEvents` (só `published`).
- F03: entrega assíncrona das respostas (pode chegar depois do cancelamento).
- F04: tabela `tickets`; handler do gateway que só altera ingresso `pending` (garante "resposta tardia não muda
  status"); `purchaseTicket` recusa evento não publicado; `availableSeats` devolve 0 para cancelado.

Sem tabela nova. Módulo `src/modules/cancellation/` (`order: 70`).

## `cancelEvent(organizerId, eventId)` — `src/modules/cancellation/service.js`

Numa única transação:

1. `lockEvent(client, eventId)` — mesma linha travada pela compra (F04): uma compra em andamento termina antes,
   e nenhuma compra começa depois do cancelamento sem ver `cancelled`.
2. Dono diferente ou inexistente → `{ notFound: true }`; status `draft` → erro
   `Só eventos publicados podem ser cancelados.`; `cancelled` → `Evento já está cancelado.` (cancelamento é
   irreversível e único).
3. `UPDATE events SET status = 'cancelled', cancelled_at = now(), updated_at = now()`.
4. `UPDATE tickets SET status = CASE status WHEN 'confirmed' THEN 'refunded' WHEN 'pending' THEN 'cancelled' END,
   updated_at = now() WHERE event_id = $1 AND status IN ('pending', 'confirmed') RETURNING status`.
5. Retorna `{ event, refunded, cancelled }` (contagens).

Como o passo 4 acontece no mesmo commit do passo 3, "em até 10 segundos" vira "imediatamente". Uma resposta do
gateway que chega depois encontra o ingresso `cancelled`/`refunded` e o `UPDATE … WHERE status = 'pending'` de
F04 não o altera. Se a resposta chega no mesmo instante, os locks de linha do Postgres ordenam: ou a confirmação
commita antes (e o cancelamento a converte em `refunded`), ou depois (e não faz nada) — nunca um ingresso
confirmado em evento cancelado.

## Interface

- Seção `cancel` (`order: 90`) na página de gestão:
  - `published`: formulário `POST /organizer/events/{id}/cancel` com botão "Cancelar evento" (confirmação no
    navegador via `onclick="return confirm(…)"`) e o aviso de que é irreversível;
  - `draft`: "Só eventos publicados podem ser cancelados.";
  - `cancelled`: "Evento cancelado em dd/mm/aaaa hh:mm." (o texto `Evento cancelado` aparece na página).
- `POST /organizer/events/:id/cancel` (com `loadOwnedEvent` → 404 para outro organizador, R13): sucesso → 200
  com `renderManagementPage` e o resultado "Evento cancelado. N ingresso(s) estornado(s) e M cancelado(s)."
  (já sem formulário de edição, que F02 esconde para cancelados); erro → 409 com a mensagem.

## Testes — `test/F07/`

Cancelar publicado converte confirmados → `refunded` e pendentes → `cancelled` (ingressos da vitrine e do canal
parceiro, criados pelo serviço de F04) e preserva `declined`; rascunho e já cancelado não são cancelados; evento
sai da vitrine e de `listOnSaleEvents`; nova compra → `event_not_available`; `getSeatAvailability` → 0; edição e
publicação bloqueadas na gestão; **resposta tardia**: compra com cartão `…0003` (aprovação lenta), cancelar antes
da resposta, esperar a entrega do gateway (`processDueCharges`) e ver o ingresso continuar `cancelled` (idem
`…0004`); cancelamento concorrente com compras (nenhum ingresso `pending`/`confirmed` sobra); organizador B → 404.
