# Catraca

Venda de ingressos para eventos pequenos (shows em bar, workshops, meetups): vitrine para participantes, API para
parceiros, check-in na porta, cancelamento com estorno e painel por evento.

Construído em modo agente a partir do [brief da fundadora](docs/brief.md), com Spec-Driven Development:
**PRD → spec, plano e contrato por feature → implementação por agentes (waves, duas delas em paralelo) →
avaliação por um agente separado → Fluxo do avaliador na `main` integrada.**

## Como rodar

Pré-requisitos: **Docker** (com Compose v2), **Git** e **Node.js LTS** (Node só é usado pelo script opcional do
fluxo; o produto e os gates rodam em containers). Linux ou macOS (no Windows, WSL).

| Ação | Comando |
|---|---|
| Subir tudo (build, migrações e seed — nenhum outro passo) | `./scripts/up.sh` |
| Derrubar tudo que a subida iniciou | `./scripts/down.sh` (`--purge` apaga também o volume do banco) |
| Gates: lint + testes automatizados | `./scripts/gates.sh` |
| Fluxo do avaliador automatizado (passos 2–16, com o produto no ar) | `node scripts/fluxo-avaliador.mjs` |
| Rajada do passo 15 repetida em eventos novos | `./scripts/rajada.sh 5` |

O modo padrão usa o **gateway simulado**, sem nenhuma chave de pagamento. Para testes locais mais rápidos dá para
acelerar o gateway (`GATEWAY_TIME_SCALE=0.1 ./scripts/up.sh`); o padrão, usado pelo avaliador, é `1` (tempos do
brief).

## Endereços

| | Endereço |
|---|---|
| Produto (`$WEB`) | http://localhost:3000 |
| API de parceiros (`$API`) | http://localhost:3000 (rotas em `/api/partner/...`) |

Porta alternativa: `CATRACA_PORT=3100 ./scripts/up.sh` (e o mesmo prefixo no `down.sh`). O fluxo e a rajada recebem os
endereços e a chave por variável (`WEB`, `API`, `KEY`), ex.: `WEB=http://localhost:3100 API=http://localhost:3100 ./scripts/rajada.sh 5`.

## Credenciais (seed)

| Conta | E-mail | Senha |
|---|---|---|
| Organizador A | `organizador.a@catraca.dev` | `catraca123` |
| Organizador B | `organizador.b@catraca.dev` | `catraca123` |
| Participante | `participante@catraca.dev` | `catraca123` |
| Chave de parceiro (`X-Api-Key`, `$KEY`) | `pk_test_catraca_parceiro` | |

A seed roda a cada subida e é idempotente (garante as três contas com essas senhas).

## Mapa dos artefatos

| Artefato | Onde |
|---|---|
| Brief (regras R01–R13) | [docs/brief.md](docs/brief.md) |
| PRD: features, provê/consome, grafo, waves, critérios (inclusive cross-feature), fora de escopo | [docs/PRD.md](docs/PRD.md) |
| Porta de entrada dos agentes (comandos, regras, mapa) | [AGENTS.md](AGENTS.md) (o [CLAUDE.md](CLAUDE.md) aponta para ele) |
| Arquivo de estado do projeto | [state.json](state.json) |
| Harness | [scripts/](scripts/), [docker-compose.yml](docker-compose.yml), [docker-compose.gates.yml](docker-compose.gates.yml), [Dockerfile](Dockerfile), seed em [src/seed.js](src/seed.js) |

Uma pasta por feature, com `spec.md`, `plan.md`, `contract.md` e `reports/` (relatórios de avaliação):

| ID | Feature | Wave | Pasta | PR |
|---|---|---|---|---|
| F01 | Fundação, contas e harness | 1 | [docs/features/F01-fundacao](docs/features/F01-fundacao) | [#1](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/1) |
| F02 | Eventos do organizador e vitrine | 2 ∥ | [docs/features/F02-eventos](docs/features/F02-eventos) | _pendente_ |
| F03 | Gateway de pagamento simulado | 2 ∥ | [docs/features/F03-gateway](docs/features/F03-gateway) | _pendente_ |
| F04 | Vendas: compra, vagas e "Meus ingressos" | 3 | [docs/features/F04-vendas](docs/features/F04-vendas) | _pendente_ |
| F05 | API de parceiros | 4 ∥ | [docs/features/F05-api-parceiros](docs/features/F05-api-parceiros) | _pendente_ |
| F06 | Check-in | 4 ∥ | [docs/features/F06-checkin](docs/features/F06-checkin) | _pendente_ |
| F07 | Cancelamento de evento | 4 ∥ | [docs/features/F07-cancelamento](docs/features/F07-cancelamento) | _pendente_ |
| F08 | Painel do evento | 4 ∥ | [docs/features/F08-painel](docs/features/F08-painel) | _pendente_ |
| F09 | Verificação integrada (Fluxo do avaliador) | 5 | [docs/features/F09-verificacao-integrada](docs/features/F09-verificacao-integrada) | _pendente_ |

∥ = wave implementada em paralelo (branches em worktrees separadas, agentes simultâneos, integração por PR).
