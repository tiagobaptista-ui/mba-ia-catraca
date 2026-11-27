# Spec F08 — Painel do evento

Critérios do PRD: F08-CA01 … F08-CA06 e os cross-feature X17 (F08 ← F02) e X18 (F08 ← F04). Regra: R12
(com R03 na receita, R05 nas vagas e R13 no acesso).

## Consome

- F02: `addManagementSection`, `loadOwnedEvent` (indireto: a página de gestão já é do dono), objeto evento.
- F04: tabela `tickets` (`status`, `price_cents`, `checked_in_at`), `availableSeats(event, occupied)` /
  `getSeatAvailability(eventId)` (definição única de R05).

Sem tabela nova e sem rota nova. Módulo `src/modules/dashboard/` (`order: 80`).

## `getDashboard(event)` — `src/modules/dashboard/service.js`

Uma query agregada sobre os ingressos do evento (vitrine **e** API — o canal não filtra nada):

```sql
SELECT count(*) FILTER (WHERE status = 'confirmed')                              AS confirmed,
       count(*) FILTER (WHERE status = 'pending')                                AS pending,
       count(*) FILTER (WHERE status = 'confirmed' AND checked_in_at IS NOT NULL) AS checkins,
       count(*) FILTER (WHERE status = 'refunded')                               AS refunded,
       COALESCE(sum(price_cents) FILTER (WHERE status = 'confirmed'), 0)         AS revenue_cents
  FROM tickets WHERE event_id = $1
```

`available = availableSeats(event, confirmed + pending)` (0 se cancelado). Retorna
`{ confirmed, pending, checkins, available, revenueCents, refunded }`.

| Métrica | Definição (R12) | Armadilha evitada |
|---|---|---|
| Confirmados | `confirmed`, com ou sem check-in | check-in não é status |
| Pendentes | `pending` | — |
| Check-ins | `confirmed` com `checked_in_at` | estornado que tinha feito check-in não conta |
| Vagas disponíveis | R05 via F04 | cancelado = 0 |
| Receita | soma de `price_cents` **gravado em cada ingresso** `confirmed` | estorno não é receita; mudança de preço não reescreve o passado |
| Estornados | `refunded` | — |

## Interface

Seção `dashboard` (`order: 10`, topo da página de gestão), título "Painel", uma lista com rótulo e valor:

```html
<dl class="dashboard">
  <dt>Confirmados</dt><dd data-metric="confirmed">3</dd>
  <dt>Pendentes</dt><dd data-metric="pending">0</dd>
  <dt>Check-ins</dt><dd data-metric="checkins">0</dd>
  <dt>Vagas disponíveis</dt><dd data-metric="available">0</dd>
  <dt>Receita</dt><dd data-metric="revenue">R$ 350,00</dd>
  <dt>Estornados</dt><dd data-metric="refunded">0</dd>
</dl>
```

Receita com `formatCents` (`R$ 350,00`, espaço comum). Calculado a cada carregamento (recarregar basta).

## Testes — `test/F08/`

Painel vazio; mistura de status criada pelo serviço de vendas (vitrine e canal parceiro) e ajustes via SQL
(`checked_in_at`, `refunded`, `cancelled`, `declined`); receita com preços diferentes (compra, mudança de preço,
compra); estornado com check-in fora de Confirmados/Check-ins/Receita; cancelado com Vagas 0; cenário do passo 9
do Fluxo do avaliador (3 confirmados a 100 + 100 + 150 → `R$ 350,00`, vagas 0); organizador B → 404 sem números.
