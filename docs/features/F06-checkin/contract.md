# Contrato F06 — Check-in

## Pré-requisitos de ambiente

- Docker, Git, Node.js LTS, `curl`. Clone do commit avaliado numa pasta vazia; produto no ar com
  `./scripts/up.sh` (modo padrão). `WEB=http://localhost:3000`, `KEY=pk_test_catraca_parceiro`.
- Cookies `a.txt` (organizador A), `b.txt` (organizador B), `p.txt` (participante da seed).
- Eventos de A: E1 (lotação 3, publicado) e E2 (lotação 2, publicado); evento de B: EB (publicado). Criados pela
  área do organizador.
- Ingressos: comprados pela API de parceiros se ela já existir na branch, senão pela vitrine com `p.txt`
  (`POST /events/{id}/purchase`, `cardNumber=…`). Códigos lidos em "Meus ingressos" ou via SQL
  `select code, status from tickets where event_id='…'`.
  - C1: E1, cartão `4000000000000001` (confirmado em ≤ 5 s);
  - C2: E1, cartão `4000000000000004` (fica pendente ~30 s);
  - C3: EB, cartão `4000000000000001`;
  - C4: E1, cartão `4000000000000002` (recusado).
- Cancelamento (F07) não existe nesta branch: "evento cancelado" via SQL
  `update events set status='cancelled', cancelled_at=now() where id='…'` (e os ingressos como F07 faria:
  `update tickets set status = case status when 'confirmed' then 'refunded' when 'pending' then 'cancelled' else status end where event_id='…'`).
- Check-in: `curl -b a.txt -s -d "code=<CÓDIGO>" $WEB/organizer/events/{E}/checkin | grep -o 'data-result="[a-z_]*">[^<]*'`.

## Itens verificáveis

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C01 | Campo de check-in na gestão (X12) | `GET /organizer/events/{E1}` com `a.txt` | `200`; formulário com campo `code` |
| C02 | Entrada liberada | check-in de C1 em E1 | `Entrada liberada`; `checked_in_at` preenchido |
| C03 | Ingresso já utilizado | C1 de novo | `Ingresso já utilizado` |
| C04 | Não confirmado (pendente) | C2 em E1 (antes de 30 s da compra) | `Ingresso não confirmado` |
| C05 | Não confirmado (recusado) | C4 em E1 | `Ingresso não confirmado` |
| C06 | Código inexistente | `ZZZZZZZZ` em E1 | `Ingresso inválido para este evento` |
| C07 | Código de outro evento (X13) | C3 (de EB) em E1 | `Ingresso inválido para este evento` |
| C08 | Código normalizado | C1 em minúsculas com espaços (`code=%20<c1 minúsculo>%20`) em E1 | `Ingresso já utilizado` (reconhecido) |
| C09 | Evento cancelado | compre C5 em E2 (`0001`), cancele E2 via SQL (pré-requisitos); check-in de C5 em E2 | `Evento cancelado` (campo continua disponível) |
| C10 | Ordem das regras | em E2 cancelado: C3 → inválido; C1 (de E1) → inválido | `Ingresso inválido para este evento` nos dois |
| C11 | Concorrência | teste "check-ins simultâneos do mesmo código liberam uma única entrada" em `test/F06` | passa |
| C12 | Só o dono faz check-in (R13, X12) | com `b.txt`: `GET /organizer/events/{E1}` e `POST /organizer/events/{E1}/checkin` com o código de C1 | `404` nos dois, sem dados de E1; `checked_in_at` de C1 inalterado |
| C13 | Participante e visitante bloqueados | `POST /organizer/events/{E1}/checkin` com `p.txt` e sem cookie | `403`; `302` para o login |
| C14 | Mensagens por status vindas de F04 (X13) | testes de `test/F06` que criam ingressos pelo serviço de vendas (vitrine e canal parceiro) em cada status | passam |
| C15 | Gates | `./scripts/gates.sh; echo $?` | `0`; testes de `test/F06` passam |

## Mapeamento critério → itens

| Critério (PRD) | Itens |
|---|---|
| F06-CA01 | C06, C07 |
| F06-CA02 | C09 |
| F06-CA03 | C04, C05 |
| F06-CA04 | C02, C03, C08 |
| F06-CA05 | C10 |
| F06-CA06 | C11 |
| F06-CA07 | C12, C13 |
| X12 (F06 ← F02) | C01, C09, C12 |
| X13 (F06 ← F04) | C07, C14 |
| (gates) | C15 |
