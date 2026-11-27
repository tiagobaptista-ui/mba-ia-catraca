# Contrato F03 — Gateway de pagamento simulado

## Pré-requisitos de ambiente

- Docker, Git, Node.js LTS. Clone do commit avaliado numa pasta vazia.
- Para C08–C10: produto no ar a partir do clone com `./scripts/up.sh` (modo padrão, sem variáveis extras).
- SQL: `docker compose -p catraca exec -T db psql -U catraca catraca -c "<sql>"`.
- Para C01–C07: `./scripts/gates.sh 'test/F03/*.test.js'` (e a suíte completa em C11).

## Itens verificáveis

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C01 | Tabela do simulador | teste "simulateResponse segue a tabela do brief" em `test/F03` + leitura de `src/modules/gateway/simulator.js` | 0001 aprovado e 0002 recusado em [2000, 5000] ms; 0003 aprovado e 0004 recusado em [30000, 40000] ms; outro final recusado em [2000, 5000] ms (inclusive nos extremos do `rng`) |
| C02 | Validação do cartão | teste "isValidCardNumber" | só string de exatamente 16 dígitos é válida (15, 17, letras, número JS → inválido) |
| C03 | Compra não espera o gateway | teste "requestCharge retorna sem esperar a resposta" | retorna em < 100 ms com `chargeId` e `respondAt` futuro; banco guarda só `card_last4` |
| C04 | Resposta só depois do instante sorteado | teste "handler só recebe a resposta depois de respondAt" | nenhuma entrega antes; entrega com `outcome` correto depois |
| C05 | Entrega única com workers concorrentes | teste "dois processDueCharges concorrentes entregam cada cobrança uma vez" | cada cobrança entregue exatamente 1 vez |
| C06 | Reentrega após falha do handler | teste "handler que falha é reentregue" | segunda varredura entrega; `attempts = 1`, `last_error` preenchido |
| C07 | Só modo simulado | teste "GATEWAY_MODE diferente de simulated é recusado" | `start()` rejeita com mensagem clara |
| C08 | Subida padrão sem chave de pagamento | `docker compose -p catraca config \| grep -iE 'GATEWAY\|KEY\|SECRET'` e `docker compose -p catraca logs app` | só `GATEWAY_MODE: simulated`, `GATEWAY_TIME_SCALE: "1"` e a chave de parceiro de teste; app sobe sem erro |
| C09 | Migração do gateway aplicada na subida (X02) | `select name from schema_migrations order by name` | inclui `003_gateway.sql` |
| C10 | Worker do app no ar entrega sozinho (X02) | `insert into gateway_charges (id, ticket_id, card_last4, amount_cents, outcome, respond_at) values ('chg_eval1','tkt_eval1','0001',1000,'approved', now())`; esperar 2 s; `select responded_at is not null from gateway_charges where id='chg_eval1'` | `t` |
| C11 | Gates | `./scripts/gates.sh; echo $?` | `0`; testes de `test/F03` passam |

## Mapeamento critério → itens

| Critério (PRD) | Itens |
|---|---|
| F03-CA01 | C01 |
| F03-CA02 | C02 |
| F03-CA03 | C03, C04 |
| F03-CA04 | C05, C06 |
| F03-CA05 | C07, C08 |
| X02 (F03 ← F01) | C09, C10 |
| (gates) | C11 |
