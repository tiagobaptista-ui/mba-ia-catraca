# Spec F04 — Vendas: compra, vagas e "Meus ingressos"

Critérios do PRD: F04-CA01 … F04-CA08 e os cross-feature X03 (F04 ← F01), X04, X05, X06 (F04 ← F02) e
X07 (F04 ← F03). Regras: R03, R05, R06, R07, R08, R09 (e R02 na compra).

## Consome

- F01: `withTransaction`, `query`, `html`, `sendPage`, `req.user`, `requireRole`, `newId('tkt')`, `newTicketCode()`,
  `formatCents`, `formatDateTimeBR`, helpers de teste.
- F02: `lockEvent(client, id)`, `getEvent`, `isOnSale`, `setCapacityGuard`, `addStorefrontExtra`,
  `renderEventPage`, rotas `/` e `/events/:id`.
- F03: `isValidCardNumber`, `requestCharge(client, …)`, `onGatewayResponse(handler)`.

## Modelo de dados — migração `src/db/migrations/004_sales.sql`

```sql
CREATE TABLE tickets (
  id             text PRIMARY KEY,
  event_id       text NOT NULL REFERENCES events (id),
  code           text NOT NULL UNIQUE,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'refunded')),
  channel        text NOT NULL CHECK (channel IN ('storefront', 'partner')),
  user_id        text REFERENCES users (id),       -- null nas compras pela API (R06/brief)
  buyer_email    text NOT NULL,
  price_cents    integer NOT NULL CHECK (price_cents > 0), -- preço vigente na compra (R03)
  checked_in_at  timestamptz,                      -- escrito por F06; "checkedIn" na API
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_event_status_idx ON tickets (event_id, status);
CREATE INDEX tickets_user_idx ON tickets (user_id, created_at);
```

## Garantia de lotação sob concorrência (R07)

`purchaseTicket` roda numa transação **READ COMMITTED** que começa com `lockEvent(client, eventId)`
(`SELECT … FOR UPDATE` na linha do evento). Enquanto uma compra segura o lock, as outras compras do mesmo evento
esperam; cada uma, ao entrar, **reconta** as vagas ocupadas (`pending` + `confirmed`) já com os ingressos
commitados pelas anteriores. Logo `ocupadas ≤ lotação` sempre. Edição de lotação (F02, via capacity guard,
chamado com o evento travado) e cancelamento (F07) travam a mesma linha, então não há corrida entre "reduzir
lotação" e "comprar". Eventos diferentes não disputam o mesmo lock.

Alternativas descartadas: contador `occupied` com `UPDATE … WHERE occupied < capacity` (exige manter o contador
coerente em recusa/cancelamento — dois lugares para errar); `SERIALIZABLE` (exige retry de falhas de
serialização em todo chamador).

## Serviço — `src/modules/sales/service.js`

| Export | Comportamento |
|---|---|
| `TICKET_STATUS_LABELS` | `{ pending: 'pendente', confirmed: 'confirmado', declined: 'recusado', cancelled: 'cancelado', refunded: 'estornado' }` |
| `OCCUPYING_STATUSES` | `['pending', 'confirmed']` (R05) |
| `countOccupiedSeats(client, eventId)` | `count(*)` dos status que ocupam vaga |
| `availableSeats(event, occupied)` | `cancelled` → 0; senão `max(0, capacity − occupied)` (R05) |
| `getSeatAvailability(eventId)` | `{ capacity, occupied, available }` ou `null` |
| `getAvailabilityMap(eventIds)` | `Map(eventId → available)` numa query só |
| `purchaseTicket({ eventId, cardNumber, buyerEmail, userId = null, channel })` | 1) cartão inválido → `{ ok: false, error: 'invalid_card' }` (antes de criar ingresso); 2) transação: `lockEvent`; inexistente ou não publicado → `event_not_available`; 3) ocupadas ≥ lotação → `sold_out`; 4) insere ingresso `pending` com `price_cents` = preço atual do evento e código novo (`INSERT … ON CONFLICT (code) DO NOTHING` + nova tentativa, sem abortar a transação); 5) `requestCharge(client, { ticketId, cardNumber, amountCents })` na mesma transação; 6) `{ ok: true, ticket }`. Nunca espera o gateway (R06). |
| `getTicket(id)`, `findTicketByCode(code)` | ingresso ou `null`; código normalizado (`trim` + maiúsculas) |
| `listUserTickets(userId)` | ingressos do participante com nome e data do evento, mais recentes primeiro |
| `mapTicket(row)` | `{ id, eventId, code, status, channel, userId, buyerEmail, priceCents, checkedIn, checkedInAt, createdAt, updatedAt }` |

## Integrações registradas por `src/modules/sales/index.js` (`order: 40`)

- **Gateway (R08, R11)**: `onGatewayResponse(handler)` com
  `UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1 AND status = 'pending'` (`approved` →
  `confirmed`, `declined` → `declined`). O `AND status = 'pending'` é o que faz a resposta tardia não mudar um
  ingresso já cancelado/estornado (R11, usado por F07). Recusa libera a vaga porque `declined` não ocupa (R05).
- **Capacity guard (R03)**: `setCapacityGuard` → se `novaLotação < ocupadas`, erro
  `A lotação não pode ficar menor que as vagas ocupadas (N).`
- **Extras da vitrine** (`addStorefrontExtra`, R07):
  - `card`: `N vagas disponíveis` ou `Ingressos esgotados`;
  - `page`: sem vaga → `Ingressos esgotados` no lugar do formulário; participante → formulário
    (`cardNumber`, "Número do cartão (16 dígitos)", botão "Comprar ingresso"); visitante → link "Entre como
    participante para comprar" (`/login?next=/events/{id}`); organizador → "Organizadores não compram ingressos.";
  - `result` (resposta à tentativa): `Ingressos esgotados` / `Número do cartão deve ter 16 dígitos.`

## Rotas

| Rota | Acesso | Comportamento |
|---|---|---|
| `POST /events/:id/purchase` | participante | sucesso → `302 /my-tickets` (aviso "Compra registrada: ingresso pendente, aguardando o pagamento."); `sold_out` → 409 na página do evento com `Ingressos esgotados`; `invalid_card` → 422 com a mensagem; `event_not_available` → 404. Visitante → `302 /login?next=/events/{id}`; organizador → 403. |
| `GET /my-tickets` | participante | "Meus ingressos": tabela Evento, Data, Status (rótulo), Código, Valor pago (R09). Só os do próprio usuário. |

## Testes — `test/F04/`

Compra pela vitrine pendente → confirmada (cartão 0001) e "Meus ingressos" (X03, R09); recusa libera vaga (0002,
X07); pendente ocupa vaga e esgota (R05, R07); cartão inválido sem ingresso; visitante/organizador; rascunho
recusa compra (X04); capacity guard na página de gestão de F02 (X05); preço vigente por compra (X06);
**rajada de 30 compras simultâneas em lotação 5, repetida em 10 eventos novos** (R07); resposta tardia do
gateway não altera ingresso não pendente; códigos únicos.
