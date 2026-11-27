# Contrato F08 — Painel do evento

## Pré-requisitos de ambiente

- Docker, Git, Node.js LTS, `curl`. Clone do commit avaliado numa pasta vazia; produto no ar com
  `./scripts/up.sh` (modo padrão). `WEB=http://localhost:3000`.
- Cookies `a.txt` (organizador A), `b.txt` (organizador B), `p.txt` (participante da seed).
- Compras pela vitrine com `p.txt` (`POST /events/{id}/purchase`, `cardNumber=…`); a API de parceiros, o check-in
  e o cancelamento podem não existir nesta branch — quando preciso, simule o efeito via SQL
  (`docker compose -p catraca exec -T db psql -U catraca catraca -c "<sql>"`).
- Ler o painel: `curl -b a.txt -s $WEB/organizer/events/{E} | grep -o 'data-metric="[a-z]*">[^<]*'`.

## Itens verificáveis

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C01 | Painel na gestão (X17) | A cria e publica E (lotação 2, `100,00`); `GET /organizer/events/{E}` | seção "Painel" com Confirmados 0, Pendentes 0, Check-ins 0, Vagas disponíveis 2, Receita `R$ 0,00`, Estornados 0 |
| C02 | Pendente conta | `p.txt` compra E com `4000000000000003`; ler o painel logo depois | Pendentes 1, Vagas disponíveis 1, Receita `R$ 0,00` |
| C03 | Confirmado conta e gera receita | `p.txt` compra E com `4000000000000001`; após 5 s | Confirmados 1, Pendentes 1, Vagas 0, Receita `R$ 100,00` |
| C04 | Receita com preço vigente na compra (X18) | A aumenta a lotação para 3 e muda o preço para `150,00`; `p.txt` compra com `…0001`; após 5 s | Confirmados 2, Receita `R$ 250,00` (100 + 150) |
| C05 | Cenário do passo 9 | após a aprovação lenta do primeiro ingresso (~40 s da compra de C02) | Confirmados 3, Pendentes 0, Check-ins 0, Vagas 0, Receita `R$ 350,00`, Estornados 0 |
| C06 | Check-in conta sem mudar Confirmados | `update tickets set checked_in_at = now() where id = (select id from tickets where event_id='{E}' and status='confirmed' limit 1)` | Check-ins 1, Confirmados 3 |
| C07 | Recusado não conta | `p.txt` não consegue comprar (esgotado); A aumenta para 4; compra com `…0002`; após 5 s | Confirmados 3, Pendentes 0, Vagas 1, Receita `R$ 350,00` |
| C08 | Estorno fora da receita (cancelado) | simular o cancelamento de F07 via SQL: `update events set status='cancelled', cancelled_at=now() where id='{E}'; update tickets set status = case status when 'confirmed' then 'refunded' when 'pending' then 'cancelled' else status end where event_id='{E}'` | Confirmados 0, Pendentes 0, Check-ins 0, Vagas 0, Receita `R$ 0,00`, Estornados 3 |
| C09 | Vitrine e API contam igual (X18) | teste de `test/F08` com ingressos dos canais `storefront` e `partner` criados pelo serviço de vendas | passa |
| C10 | Organizador B não vê o painel de A (R13, X17) | `GET /organizer/events/{E}` com `b.txt` | `404`; nenhum `data-metric` nem nome de E |
| C11 | Gates | `./scripts/gates.sh; echo $?` | `0`; testes de `test/F08` passam |

## Mapeamento critério → itens

| Critério (PRD) | Itens |
|---|---|
| F08-CA01 | C01 |
| F08-CA02 | C03, C06, C08 |
| F08-CA03 | C04, C05, C08 |
| F08-CA04 | C02, C03, C07, C08 |
| F08-CA05 | C09 |
| F08-CA06 | C10 |
| X17 (F08 ← F02) | C01, C10 |
| X18 (F08 ← F04) | C04, C09 |
| (gates) | C11 |
