# Spec F05 — API de parceiros

Critérios do PRD: F05-CA01 … F05-CA05 e os cross-feature X08 (F05 ← F01), X09 (F05 ← F02), X10 e X11
(F05 ← F04). Contrato fixo: `docs/brief.md`, seção "API de parceiros".

## Consome

- F01: `config.partnerApiKey` (env `PARTNER_API_KEY`, padrão `pk_test_catraca_parceiro`), `toIsoOffset`,
  `EMAIL_RE` (`src/modules/accounts/service.js`), 404 JSON do app para `/api/*`.
- F02: `listOnSaleEvents()`.
- F03: `isValidCardNumber` (mesma regra da compra).
- F04: `purchaseTicket({ eventId, cardNumber, buyerEmail, channel: 'partner' })`, `getAvailabilityMap(ids)`,
  `getTicket(id)`.

Sem tabela nova. Módulo `src/modules/partner-api/index.js` (`order: 50`).

## Pipeline de uma requisição `/api/partner/*`

1. **Chave** (antes de tudo, inclusive do parse do corpo): `X-Api-Key` ausente ou diferente da configurada
   (comparação em tempo constante) → `401 {"error":"unauthorized"}`. Vale para qualquer caminho sob
   `/api/partner`.
2. **Corpo** (só no POST): `express.json()` dentro do router; JSON malformado → `422 invalid_request`.
3. **Validação**: corpo precisa ser objeto com `buyerEmail` string que casa `EMAIL_RE` e `cardNumber` string de
   16 dígitos (`isValidCardNumber`). Qualquer falha → `422 {"error":"invalid_request"}`.
4. **Compra** via `purchaseTicket` (o mesmo serviço da vitrine — mesma lotação, mesmo lock, R07):
   `event_not_available` → `404`, `sold_out` → `409`, sucesso → `202`.

## Rotas

| Rota | Resposta |
|---|---|
| `GET /api/partner/events` | `200` `[{ id, name, startsAt, priceCents, availableSeats }]` — eventos de `listOnSaleEvents()` (publicados e não cancelados, R02), `startsAt = toIsoOffset(startsAt)` (ex.: `2026-12-05T21:00:00-03:00`), `availableSeats` de `getAvailabilityMap` (R05). |
| `POST /api/partner/events/:eventId/purchases` | `202` `{ ticketId, code, status: "pending" }`; erros na ordem `422 invalid_request` → `404 event_not_available` → `409 sold_out`. |
| `GET /api/partner/tickets/:ticketId` | `200` `{ ticketId, code, eventId, status, checkedIn }` (qualquer canal); inexistente → `404 {"error":"ticket_not_found"}`. |

Respostas sempre `application/json`. Compras da API: `channel = 'partner'`, `user_id = null`,
`buyer_email` = `buyerEmail` informado.

## Testes — `test/F05/`

401 sem chave e com chave errada nas três rotas (inclusive com corpo malformado); listagem só com publicados e
campos/tipos do contrato; 202 pendente → confirmado (0001) consultando `GET /tickets`; 422 (campo faltando,
e-mail ruim, cartão `123`, cartão numérico, JSON malformado) mesmo para evento inexistente (ordem); 404 para
inexistente, rascunho e cancelado (status ajustado via SQL); 409 sem vaga; `availableSeats` caindo com compra
pendente e voltando com recusa; ingresso da vitrine consultável pela API; **rajada HTTP de 30 compras
simultâneas em lotação 5, repetida em 5 eventos** → 5 × 202 e 25 × 409.
