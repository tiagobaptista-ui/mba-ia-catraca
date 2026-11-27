# Contrato F02 — Eventos do organizador e vitrine

## Pré-requisitos de ambiente

- Docker, Git, Node.js LTS, `curl`. Clone do commit avaliado numa pasta vazia.
- Produto no ar a partir do clone: `./scripts/up.sh` (`WEB=http://localhost:3000`; outra porta via `CATRACA_PORT`).
- Cookies: `A` = organizador A logado (`curl -c a.txt -d 'email=organizador.a@catraca.dev&password=catraca123' $WEB/login`),
  `B` = organizador B, `P` = participante da seed.
- Datas: `FUT` = valor `datetime-local` daqui a ~30 dias (ex.: `2026-12-27T21:00`), `PAST` = ontem.
- SQL: `docker compose -p catraca exec -T db psql -U catraca catraca -c "<sql>"`.

## Itens verificáveis

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C01 | Criar evento válido | `curl -b a.txt -s -o /dev/null -w '%{http_code} %{redirect_url}' -d "name=Jazz+F02&startsAt=$FUT&venue=Porão&capacity=2&price=100,00" $WEB/organizer/events` | `302` para `/organizer/events/evt_…` |
| C02 | Nasce rascunho e aparece na lista do dono | `curl -b a.txt -s $WEB/organizer` e `select status, price_cents, capacity from events where name='Jazz F02'` | lista mostra "Jazz F02" com "Rascunho"; `draft`, `10000`, `2` |
| C03 | Data no passado rejeitada ao criar | POST de C01 com `startsAt=$PAST` | `422` com "A data de início precisa estar no futuro."; nenhum evento novo no banco |
| C04 | Data no passado rejeitada ao editar | `POST /organizer/events/{id}` (do C01) com todos os campos e `startsAt=$PAST` | `422` com a mesma mensagem; `starts_at` inalterado |
| C05 | Lotação/preço/campos inválidos | POST de criação com `capacity=0`; com `price=0`; com `name=` | `422` com mensagem para cada caso |
| C06 | Rascunho fora da vitrine | `curl -s $WEB/ \| grep -c 'Jazz F02'`; `curl -s -o /dev/null -w '%{http_code}' $WEB/events/{id}` | `0`; `404` |
| C07 | Publicar | `curl -b a.txt -s -o /dev/null -w '%{http_code}' -X POST $WEB/organizer/events/{id}/publish`; depois `GET /` e `GET /events/{id}` | `302`; vitrine lista "Jazz F02" com "R$ 100,00" e data `dd/mm/aaaa hh:mm`; página pública `200` |
| C08 | Página de gestão com endereço próprio | `curl -b a.txt -s $WEB/organizer/events/{id}` | `200`; mostra nome, status "Publicado", formulário de edição e `data-section` das seções |
| C09 | Seções de outras features entram na gestão | teste `test/F02` "seções registradas por outras features aparecem na página de gestão" (saída dos gates) | passa |
| C10 | Aumentar lotação aceito | `POST /organizer/events/{id}` com `capacity=3` (demais campos iguais) | `302`; `capacity = 3` |
| C11 | Capacity guard rejeita redução | teste `test/F02` do capacity guard (guard falso que acusa vagas ocupadas) | redução rejeitada com a mensagem do guard; aumento aceito |
| C12 | Organizador B não vê A na lista | `curl -b b.txt -s $WEB/organizer \| grep -c 'Jazz F02'` | `0` |
| C13 | Organizador B não abre nem opera a gestão de A | com `b.txt`: `GET /organizer/events/{id}`, `POST /organizer/events/{id}` (edição) e `POST /organizer/events/{id}/publish` | `404` nos três, sem "Jazz F02" nem números no corpo; evento inalterado no banco |
| C14 | Participante e visitante fora da área (X01) | `GET /organizer/events/new` com `p.txt` e sem cookie | `403` e `302` para `/login?next=…` |
| C15 | Organizador da seed usa a área (X01) | login de A (`302 /organizer`) e `GET /organizer` | `200`, lista só eventos de A |
| C16 | Evento cancelado sem edição nem republicação | `update events set status='cancelled', cancelled_at=now() where id='{id}'`; `POST /organizer/events/{id}` (edição) e `POST …/publish`; `GET` da gestão | `409` "Evento cancelado não pode ser editado." / "…republicado."; gestão sem formulário de edição; evento fora da vitrine |
| C17 | Gates | `./scripts/gates.sh; echo $?` | `0`; testes de `test/F02` passam |

## Mapeamento critério → itens

| Critério (PRD) | Itens |
|---|---|
| F02-CA01 | C01, C02 |
| F02-CA02 | C03, C04, C05 |
| F02-CA03 | C06, C07 |
| F02-CA04 | C08, C09 |
| F02-CA05 | C10, C11 |
| F02-CA06 | C12, C13 |
| F02-CA07 | C16 |
| X01 (F02 ← F01) | C14, C15 |
| (gates) | C17 |
