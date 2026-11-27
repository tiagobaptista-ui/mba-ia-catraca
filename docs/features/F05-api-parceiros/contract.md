# Contrato F05 — API de parceiros

## Pré-requisitos de ambiente

- Docker, Git, Node.js LTS, `curl`. Clone do commit avaliado numa pasta vazia; produto no ar com
  `./scripts/up.sh` (modo padrão). `API=http://localhost:3000`, `KEY=pk_test_catraca_parceiro`.
- Eventos criados e publicados pelo organizador A na interface (`POST /organizer/events`, `…/publish`), com data
  daqui a 30 dias. Cancelamento (F07) ainda não existe nesta branch: para "evento cancelado" use SQL
  `update events set status='cancelled', cancelled_at=now() where id='…'`.
- SQL: `docker compose -p catraca exec -T db psql -U catraca catraca -c "<sql>"`.

## Itens verificáveis

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C01 | 401 sem chave | `curl -s -w ' %{http_code}' $API/api/partner/events`; idem `POST …/events/x/purchases` e `GET …/tickets/x` | `{"error":"unauthorized"} 401` nas três |
| C02 | 401 com chave errada | as três rotas com `-H 'X-Api-Key: errada'` (o POST com corpo `{` malformado) | `401 unauthorized` nas três |
| C03 | Chave do harness aceita (X08) | `curl -s -w ' %{http_code}' -H "X-Api-Key: $KEY" $API/api/partner/events` logo após o `up.sh`; `docker compose -p catraca config \| grep PARTNER_API_KEY` | `200`; a chave é a documentada no README/AGENTS |
| C04 | Listagem: só publicados, formato do contrato (X09) | A cria E1 (lotação 2, `100,00`) sem publicar; listar; publicar; listar | E1 ausente e depois presente como `{"id":"evt_…","name":…,"startsAt":"AAAA-MM-DDTHH:MM:SS-03:00","priceCents":10000,"availableSeats":2}` (ids string, números inteiros) |
| C05 | priceCents acompanha o preço atual (X09) | A edita o preço de E1 para `150,00`; listar | `priceCents: 15000` |
| C06 | Compra 202 pendente | `curl -s -w ' %{http_code}' -X POST $API/api/partner/events/$E1/purchases -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' -d '{"buyerEmail":"t2@example.com","cardNumber":"4000000000000004"}'` | `202` com `{"ticketId":"tkt_…","code":"XXXXXXXX","status":"pending"}` |
| C07 | Pendente ocupa vaga (X10) | listar logo após C06 | E1 com `availableSeats` 1 |
| C08 | Consulta de ingresso | `curl -s -w ' %{http_code}' -H "X-Api-Key: $KEY" $API/api/partner/tickets/$T` (T de C06) | `200` `{"ticketId":…,"code":…,"eventId":"$E1","status":"pending","checkedIn":false}` |
| C09 | Confirmação aparece na API | comprar E1 com `4000000000000001` (T3); consultar após 5 s | `status: "confirmed"`; E1 com `availableSeats` 0 |
| C10 | 409 sem vaga | comprar E1 de novo com `4000000000000001` | `409 {"error":"sold_out"}` |
| C11 | Recusa lenta devolve a vaga (X10) | ~45 s após C06: consultar T e listar | T `declined`; E1 `availableSeats` 1 |
| C12 | 422 invalid_request | compras com `"cardNumber":"123"`, sem `buyerEmail`, `"buyerEmail":"x"`, `"cardNumber":4000000000000001` (número), corpo `{` malformado | `422 {"error":"invalid_request"}` em todos |
| C13 | Ordem: 422 antes de 404 | compra com `"cardNumber":"123"` em `evt_inexistente` | `422 invalid_request` |
| C14 | 404 event_not_available | corpo válido em `evt_inexistente`, num rascunho e num evento cancelado via SQL | `404 {"error":"event_not_available"}` nos três; o cancelado e o rascunho fora da listagem |
| C15 | 404 ticket_not_found | `GET /api/partner/tickets/tkt_inexistente` | `404 {"error":"ticket_not_found"}` |
| C16 | Ingresso da vitrine visível na API (X11) | participante compra um evento na vitrine com `4000000000000001`; pegar o id em `select id from tickets where channel='storefront' order by created_at desc limit 1`; consultar na API após 5 s | `200`, `status: "confirmed"`, `checkedIn: false` |
| C17 | Rajada concorrente (X10, R07) | duas vezes, cada uma num evento novo de lotação 5 publicado por A: `seq 30 \| xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/partner/events/$EV/purchases" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' \| sort \| uniq -c` | exatamente `5 202` e `25 409` nas duas; `availableSeats` 0 |
| C18 | Gates | `./scripts/gates.sh; echo $?` | `0`; testes de `test/F05` passam (inclui a rajada HTTP repetida) |

## Mapeamento critério → itens

| Critério (PRD) | Itens |
|---|---|
| F05-CA01 | C04, C07, C11 |
| F05-CA02 | C06 |
| F05-CA03 | C10, C12, C13, C14 |
| F05-CA04 | C08, C09, C15 |
| F05-CA05 | C01, C02 |
| X08 (F05 ← F01) | C02, C03 |
| X09 (F05 ← F02) | C04, C05, C14 |
| X10 (F05 ← F04) | C07, C11, C17 |
| X11 (F05 ← F04) | C09, C16 |
| (gates) | C18 |
