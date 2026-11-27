# Spec F02 — Eventos do organizador e vitrine

Critérios do PRD: F02-CA01 … F02-CA07 e o cross-feature X01 (F02 ← F01). Regras: R01, R02, R03 (ponto de
extensão), R04, R11 (bloqueio de edição), R13.

## Consome de F01

`withTransaction`/`query` (`src/core/db.js`), `html`/`raw`, `sendPage`, `req.user`, guarda de `/organizer`
(já montada por `accounts`: visitante → login, participante → 403), `parseLocalDateTime`, `formatDateTimeBR`,
`toDateTimeLocalValue`, `parseMoneyToCents`, `formatCents`, `centsToInput`, `newId('evt')`, helpers de teste.

## Modelo de dados — migração `src/db/migrations/002_events.sql`

```sql
CREATE TABLE events (
  id            text PRIMARY KEY,
  organizer_id  text NOT NULL REFERENCES users (id),
  name          text NOT NULL,
  starts_at     timestamptz NOT NULL,
  venue         text NOT NULL,
  capacity      integer NOT NULL CHECK (capacity >= 1),
  price_cents   integer NOT NULL CHECK (price_cents > 0),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  published_at  timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_organizer_idx ON events (organizer_id, starts_at);
CREATE INDEX events_status_idx ON events (status, starts_at);
```

`status` é a única fonte da verdade do ciclo de vida: `draft` → `published` → `cancelled` (F07 faz a última
transição). "À venda" = `status = 'published'`.

## Serviço — `src/modules/events/service.js`

Objeto evento (camelCase): `{ id, organizerId, name, startsAt: Date, venue, capacity, priceCents, status,
publishedAt, cancelledAt, createdAt, updatedAt }` (via `mapEvent(row)`, exportada).

| Função | Comportamento |
|---|---|
| `validateEventInput(input, { now })` | campos do formulário `name`, `startsAt` (`YYYY-MM-DDTHH:mm`), `venue`, `capacity`, `price` (`100,00`). Retorna `{ values: { name, startsAt, venue, capacity, priceCents }, errors: string[] }`. Erros: nome/local vazios; data inválida; **data não futura → `A data de início precisa estar no futuro.`** (R01); lotação não inteira ou < 1; preço inválido ou ≤ 0. |
| `createEvent(organizerId, input)` | valida e insere com `status = 'draft'` (R02). → `{ event }` ou `{ errors, values }` |
| `updateEvent(organizerId, eventId, input)` | numa transação: `lockEvent` (dono), evento cancelado → `{ errors: ['Evento cancelado não pode ser editado.'], status: 409 }` (R11); valida (data futura também ao editar, R01); se a lotação mudou, chama o **capacity guard** (R03) com o evento travado; grava. → `{ event }`, `{ errors, values, status }` ou `{ notFound: true }` |
| `publishEvent(organizerId, eventId)` | só `draft` → `published` (`published_at = now()`); cancelado → `Evento cancelado não pode ser republicado.` (409); já publicado → `Evento já está publicado.` (409). |
| `getEvent(id)` / `getOwnedEvent(organizerId, id)` | evento ou `null` |
| `listOrganizerEvents(organizerId)` | eventos do organizador, por `starts_at` |
| `listOnSaleEvents()` | só `published`, por `starts_at` (R02) |
| `isOnSale(event)` | `event.status === 'published'` |
| `lockEvent(client, eventId)` | `SELECT … FROM events WHERE id = $1 FOR UPDATE` → evento ou `null`. **Disciplina de lock compartilhada**: compra (F04), edição de lotação e cancelamento (F07) travam esta linha, o que serializa as operações que mexem em vagas. |

Rótulos: `EVENT_STATUS_LABELS = { draft: 'Rascunho', published: 'Publicado', cancelled: 'Cancelado' }`.

## Pontos de extensão — `src/modules/events/extensions.js`

- `setCapacityGuard(fn)` — `fn(client, event, newCapacity)` → `Promise<string | null>` (mensagem de erro ou null).
  Sem guard registrado, a redução é aceita (ainda não há ingressos). F04 registra o guard real.
- `addManagementSection({ key, order, render })` — `render({ event, user, result, req })` → `html` (pode ser
  async). `result` = `results[key]` passado ao `renderManagementPage`. Seções nativas de F02: `details` (0),
  `publish` (40), `edit` (50). Reservado: painel 10, check-in 20, cancelamento 90.
- `renderManagementPage(req, res, event, { status = 200, results = {} })` — renderiza a página de gestão com
  todas as seções ordenadas, cada uma em `<section data-section="<key>">`. Usado pelos POSTs das features para
  devolver o resultado na própria página (ex.: mensagem do check-in).
- `addStorefrontExtra({ key, order, render })` — `render({ event, user, variant: 'card' | 'page', req, result })`
  → `html`. Usado por F04 para vagas, formulário de compra e "Ingressos esgotados".
- `renderEventPage(req, res, event, { status = 200, results = {} })` — página pública do evento com extras.
- Middleware `loadOwnedEvent` — carrega `req.params.id` **do organizador logado**; se não existir ou for de outro
  → 404 "Evento não encontrado" sem nenhum dado (R13). Popula `req.event`.

## Rotas — `src/modules/events/index.js` (`order: 20`)

| Rota | Acesso | Comportamento |
|---|---|---|
| `GET /` | todos | vitrine: cards dos eventos à venda (nome com link, data `dd/mm/aaaa hh:mm`, local, preço `R$ x,yy`, extras `card`) |
| `GET /events/:id` | todos | página pública; evento fora de venda → 404 |
| `GET /organizer` | organizador | lista dos próprios eventos (nome → página de gestão, data, status) + "Novo evento" |
| `GET /organizer/events/new` | organizador | formulário |
| `POST /organizer/events` | organizador | cria → `302 /organizer/events/{id}`; erro → 422 com mensagens |
| `GET /organizer/events/:id` | dono | **página de gestão** (R04) |
| `POST /organizer/events/:id` | dono | edita → `302` para a gestão com aviso "Evento atualizado."; erro → 422/409 na própria página |
| `POST /organizer/events/:id/publish` | dono | publica → `302` com aviso "Evento publicado."; erro → 409 |

Formulário (criar e editar): `name` "Nome", `startsAt` "Data e hora de início" (`datetime-local`), `venue`
"Local", `capacity` "Lotação", `price` "Preço (R$)". Evento cancelado: a seção `edit` mostra "Evento cancelado:
edição e publicação bloqueadas." no lugar do formulário.

F02 remove o módulo provisório `src/modules/placeholders/` de F01 (as rotas `/` e `/organizer` passam a ser suas).

## Testes — `test/F02/`

Criação/validação (R01), rascunho fora da vitrine e publicação (R02), página de gestão com seção registrada no
teste (R04), capacity guard falso rejeitando/aceitando (R03), isolamento entre organizadores por lista, GET e
POST (R13), evento cancelado (via `UPDATE` direto no teste) sem edição nem publicação (R11).
