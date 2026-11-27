# Contrato F04 — Vendas: compra, vagas e "Meus ingressos"

## Pré-requisitos de ambiente

- Docker, Git, Node.js LTS, `curl`. Clone do commit avaliado numa pasta vazia.
- Produto no ar a partir do clone, **modo padrão** (tempos reais do gateway): `./scripts/up.sh`;
  `WEB=http://localhost:3000`.
- Cookies: `a.txt` = organizador A; `p1.txt` = participante novo criado em C01; `p2.txt` = outro participante novo.
- Eventos criados e publicados por A pela área do organizador (F02): `POST /organizer/events` com
  `name, startsAt (daqui a 30 dias), venue, capacity, price` e `POST /organizer/events/{id}/publish`.
- SQL: `docker compose -p catraca exec -T db psql -U catraca catraca -c "<sql>"`.

## Itens verificáveis

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C01 | Participante novo compra na vitrine (X03) | criar participante via `POST /signup` (`p1.txt`); A cria e publica E (lotação 2, `100,00`); `GET /events/{E}` com `p1.txt` mostra o formulário; `time curl -b p1.txt -s -o /dev/null -w '%{http_code} %{redirect_url}' -d 'cardNumber=4000000000000001' $WEB/events/{E}/purchase` | formulário "Comprar ingresso" presente; `302` para `/my-tickets` em < 1 s (não espera o gateway) |
| C02 | Nasce pendente em "Meus ingressos" | logo após C01: `curl -b p1.txt -s $WEB/my-tickets` | linha com o nome de E, status `pendente` e código de 8 caracteres |
| C03 | Confirmado em até 5 s | recarregar `/my-tickets` a cada 1 s por até 5 s | status `confirmado`; mesmo código |
| C04 | "Meus ingressos" só mostra os próprios | `GET /my-tickets` com `p2.txt` | não mostra o ingresso de C01 |
| C05 | Pendente ocupa vaga e esgota (R05, R07) | A cria e publica F (lotação 1); `p1.txt` compra F com `4000000000000004`; `GET /events/{F}` com `p2.txt` e `GET /` | página de F e card da vitrine exibem `Ingressos esgotados`, sem formulário |
| C06 | Tentativa sem vaga é recusada | `curl -b p2.txt -s -w '%{http_code}' -d 'cardNumber=4000000000000001' $WEB/events/{F}/purchase`; `select count(*) from tickets where event_id='{F}'` | `409` com `Ingressos esgotados`; `1` ingresso |
| C07 | Recusa lenta libera a vaga (X07) | ~40 s após a compra de C05: `/my-tickets` de `p1.txt` e `GET /events/{F}` com `p2.txt` | ingresso `recusado`; formulário de compra de volta (1 vaga) |
| C08 | Recusa rápida (X07) | `p2.txt` compra F com `4000000000000002`; após 5 s, `/my-tickets` de `p2.txt` | `recusado`; F volta a ter vaga |
| C09 | Cartão inválido não cria ingresso | `POST /events/{E}/purchase` com `cardNumber=123`; contar ingressos de E antes/depois | `422` com "Número do cartão deve ter 16 dígitos."; contagem igual |
| C10 | Visitante e organizador não compram | `POST /events/{E}/purchase` sem cookie; com `a.txt` | `302` para `/login?next=/events/{E}`; `403` |
| C11 | Rascunho não aceita compra (X04) | A cria G sem publicar; `POST /events/{G}/purchase` com `p1.txt` | `404`; nenhum ingresso em G |
| C12 | Capacity guard na gestão (X05) | E tem 1 ingresso confirmado (C03); `p2.txt` compra E com `4000000000000003` (fica pendente); A edita E com `capacity=1` e depois `capacity=3` (demais campos iguais) | `409` com "A lotação não pode ficar menor que as vagas ocupadas (2)."; depois `302` e `capacity = 3` |
| C13 | Preço vigente por compra (X06) | A muda o preço de E para `150,00`; `p1.txt` compra E com `4000000000000001`; `select price_cents from tickets where event_id='{E}' order by created_at` | `10000, 10000, 15000` |
| C14 | Rajada concorrente (R07) | teste "30 compras simultâneas em lotação 5 resultam em 5 aceitas e 25 sold_out (10 eventos)" em `test/F04` (saída dos gates) | passa nas 10 repetições |
| C15 | Resposta tardia não altera ingresso não pendente | teste "resposta do gateway não altera ingresso que não está pendente" | passa |
| C16 | Códigos únicos | `select count(*), count(distinct code) from tickets` e teste de unicidade | contagens iguais; teste passa |
| C17 | Gates | `./scripts/gates.sh; echo $?` | `0`; testes de `test/F04` passam |

## Mapeamento critério → itens

| Critério (PRD) | Itens |
|---|---|
| F04-CA01 | C01, C02, C03 |
| F04-CA02 | C05, C07, C08 |
| F04-CA03 | C05, C06 |
| F04-CA04 | C14 |
| F04-CA05 | C13 |
| F04-CA06 | C02, C16 |
| F04-CA07 | C09 |
| F04-CA08 | C10 |
| X03 (F04 ← F01) | C01, C04, C10 |
| X04 (F04 ← F02) | C01, C11 |
| X05 (F04 ← F02) | C12 |
| X06 (F04 ← F02) | C13 |
| X07 (F04 ← F03) | C03, C07, C08, C15 |
| (gates) | C17 |
