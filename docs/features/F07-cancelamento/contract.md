# Contrato F07 — Cancelamento de evento

## Pré-requisitos de ambiente

- Docker, Git, Node.js LTS, `curl`. Clone do commit avaliado numa pasta vazia; produto no ar com
  `./scripts/up.sh` (modo padrão: tempos reais do gateway). `WEB=http://localhost:3000`.
- Cookies `a.txt` (organizador A), `b.txt` (organizador B), `p.txt` (participante da seed).
- E3: evento de A, lotação 5, `50,00`, publicado pela área do organizador.
- Ingressos comprados na vitrine com `p.txt` (`POST /events/{E3}/purchase`, `cardNumber=…`) — a API de parceiros
  pode não existir nesta branch. T5: cartão `4000000000000003` (aprovação lenta, 30–40 s); T6: logo depois,
  `4000000000000001` (confirmado em ≤ 5 s). Ids/status via SQL
  `select id, code, status from tickets where event_id='{E3}' order by created_at`.
- SQL: `docker compose -p catraca exec -T db psql -U catraca catraca -c "<sql>"`.

## Itens verificáveis

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C01 | Botão de cancelar na gestão | `GET /organizer/events/{E3}` com `a.txt` | seção com "Cancelar evento" |
| C02 | Cancelar evento publicado | com T6 `confirmed` e T5 ainda `pending` (< 30 s da compra de T5): `curl -b a.txt -s -w '%{http_code}' -X POST $WEB/organizer/events/{E3}/cancel` e anotar o horário | `200` com "Evento cancelado"; `events.status = 'cancelled'` |
| C03 | Ingressos convertidos em até 10 s (X15) | consultar os status em até 10 s após C02 | T6 `refunded`; T5 `cancelled` |
| C04 | Resposta tardia não muda nada (X16) | 45 s após a compra de T5: status de T5 e `select responded_at is not null, outcome from gateway_charges where ticket_id='{T5}'` | T5 continua `cancelled`, embora a cobrança tenha sido respondida (`t`, `approved`) |
| C05 | Sai da vitrine (X14) | `curl -s $WEB/ \| grep -c '<nome de E3>'`; `GET /events/{E3}` | `0`; `404` |
| C06 | Não vende mais (X15) | `POST /events/{E3}/purchase` com `p.txt` e `cardNumber=4000000000000001`; contar ingressos de E3 | `404`; contagem inalterada |
| C07 | Sem edição nem republicação (X14) | `GET` da gestão de E3; `POST /organizer/events/{E3}` com campos válidos; `POST …/publish` | página sem formulário de edição e sem botão de cancelar; `409` "Evento cancelado não pode ser editado."; `409` "…republicado." |
| C08 | Irreversível / único | `POST /organizer/events/{E3}/cancel` de novo | `409` "Evento já está cancelado."; ingressos inalterados |
| C09 | Rascunho não é cancelado | A cria E9 sem publicar; `POST …/cancel` | `409` "Só eventos publicados podem ser cancelados."; E9 continua `draft` |
| C10 | Vagas 0 em cancelado (R05, X15) | teste "evento cancelado tem 0 vagas disponíveis" em `test/F07` | passa |
| C11 | Só o dono cancela (R13) | A cria e publica E10; com `b.txt`: `POST /organizer/events/{E10}/cancel` | `404` sem dados; E10 continua `published` |
| C12 | Participante e visitante bloqueados | `POST /organizer/events/{E10}/cancel` com `p.txt` e sem cookie | `403`; `302` login |
| C13 | Concorrência e resposta tardia nos testes | testes de `test/F07` "resposta tardia do gateway não altera ingresso cancelado" e "cancelamento concorrente com compras não deixa ingresso ativo" | passam |
| C14 | Gates | `./scripts/gates.sh; echo $?` | `0`; testes de `test/F07` passam |

## Mapeamento critério → itens

| Critério (PRD) | Itens |
|---|---|
| F07-CA01 | C01, C02, C08, C09 |
| F07-CA02 | C03 |
| F07-CA03 | C05, C06, C10 |
| F07-CA04 | C07 |
| F07-CA05 | C04, C13 |
| F07-CA06 | C11, C12 |
| X14 (F07 ← F02) | C05, C07 |
| X15 (F07 ← F04) | C03, C06, C10 |
| X16 (F07 ← F03) | C04, C13 |
| (gates) | C14 |
