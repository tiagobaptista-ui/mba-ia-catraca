# Catraca

Venda de ingressos para eventos pequenos (shows em bar, workshops, meetups): vitrine para participantes, API para
parceiros, check-in na porta, cancelamento com estorno e painel por evento.

Construído em modo agente a partir do [brief da fundadora](docs/brief.md), com Spec-Driven Development:
**PRD → spec, plano e contrato por feature → implementação por agentes (waves, duas delas em paralelo) →
avaliação por um agente separado → Fluxo do avaliador na `main` integrada.**

## Como rodar

Pré-requisitos: **Docker** (com Compose v2), **Git** e **Node.js LTS** (o Node só roda o script do fluxo; o produto e
os gates rodam em containers). Linux ou macOS (no Windows, WSL).

| Ação | Comando |
|---|---|
| Subir tudo (build, migrações e seed — nenhum outro passo) | `./scripts/up.sh` |
| Derrubar tudo que a subida iniciou | `./scripts/down.sh` (`--purge` apaga também o volume do banco) |
| Gates: lint + testes automatizados | `./scripts/gates.sh` |
| Fluxo do avaliador automatizado (passos 2–16, com o produto no ar; ~2 min) | `node scripts/fluxo-avaliador.mjs` |
| Rajada do passo 15 repetida em eventos novos | `./scripts/rajada.sh 5` |

O modo padrão usa o **gateway simulado**, sem nenhuma chave de pagamento. Os testes automatizados aceleram o gateway
(`GATEWAY_TIME_SCALE=0.02`, só no ambiente efêmero dos gates); o produto subido por `up.sh` usa sempre os tempos do
brief.

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
| Brief (regras R01–R13) e Fluxo do avaliador | [docs/brief.md](docs/brief.md), [docs/fluxo-avaliador.md](docs/fluxo-avaliador.md) |
| PRD: features, provê/consome, grafo, waves, critérios (inclusive cross-feature), rastreabilidade R01–R13, fora de escopo | [docs/PRD.md](docs/PRD.md) |
| Porta de entrada dos agentes (comandos, regras, mapa) | [AGENTS.md](AGENTS.md) (o [CLAUDE.md](CLAUDE.md) aponta para ele) |
| Arquivo de estado do projeto | [state.json](state.json) |
| Harness | [scripts/](scripts/) (`up.sh`, `down.sh`, `gates.sh`, `fluxo-avaliador.mjs`, `rajada.sh`), [docker-compose.yml](docker-compose.yml), [docker-compose.gates.yml](docker-compose.gates.yml), [Dockerfile](Dockerfile), seed em [src/seed.js](src/seed.js) |

Uma pasta por feature, com `spec.md`, `plan.md`, `contract.md` e `reports/` (relatórios de avaliação):

| ID | Feature | Wave | Pasta (spec, plano, contrato, relatórios) | PR |
|---|---|---|---|---|
| F01 | Fundação, contas e harness | 1 | [docs/features/F01-fundacao](docs/features/F01-fundacao) | [#1](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/1) |
| F02 | Eventos do organizador e vitrine | 2 ∥ | [docs/features/F02-eventos](docs/features/F02-eventos) | [#3](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/3) |
| F03 | Gateway de pagamento simulado | 2 ∥ | [docs/features/F03-gateway](docs/features/F03-gateway) | [#2](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/2) |
| F04 | Vendas: compra, vagas e "Meus ingressos" | 3 | [docs/features/F04-vendas](docs/features/F04-vendas) | [#4](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/4) |
| F05 | API de parceiros | 4 ∥ | [docs/features/F05-api-parceiros](docs/features/F05-api-parceiros) | [#8](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/8) |
| F06 | Check-in | 4 ∥ | [docs/features/F06-checkin](docs/features/F06-checkin) | [#6](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/6) |
| F07 | Cancelamento de evento | 4 ∥ | [docs/features/F07-cancelamento](docs/features/F07-cancelamento) | [#7](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/7) |
| F08 | Painel do evento | 4 ∥ | [docs/features/F08-painel](docs/features/F08-painel) | [#5](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/5) |
| F09 | Verificação integrada (Fluxo do avaliador) | 5 | [docs/features/F09-verificacao-integrada](docs/features/F09-verificacao-integrada) | [#9](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/9) |
| F10 | Layout fluido em azul e roxo | 6 | [docs/features/F10-layout-fluido](docs/features/F10-layout-fluido) | [#10](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/10) (registro: [#11](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/11)) |

### PRs das waves paralelas

∥ = implementada em paralelo: cada feature numa branch própria, numa git worktree própria, por um agente próprio,
ao mesmo tempo; integração na `main` por PR com merge commit. Datas (UTC) do primeiro e do último commit de cada PR,
como o GitHub lista:

| Wave | PR | Feature | Primeiro commit | Último commit |
|---|---|---|---|---|
| 2 | [#2](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/2) | F03 | 2026-11-27 04:40:54 | 2026-11-27 04:50:04 |
| 2 | [#3](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/3) | F02 | 2026-11-27 04:40:18 | 2026-11-27 04:50:35 |
| 4 | [#5](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/5) | F08 | 2026-11-27 05:14:26 | 2026-11-27 05:24:00 |
| 4 | [#6](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/6) | F06 | 2026-11-27 05:14:11 | 2026-11-27 05:27:53 |
| 4 | [#7](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/7) | F07 | 2026-11-27 05:14:56 | 2026-11-27 05:30:35 |
| 4 | [#8](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/8) | F05 | 2026-11-27 05:16:12 | 2026-11-27 05:31:00 |

Em cada wave, o primeiro commit de cada PR é anterior ao último commit dos outros.

## Decisões

### Stack: Node.js 24 + Express 5 + PostgreSQL 17, HTML no servidor, tudo em Docker Compose

- A máquina do avaliador tem só Docker, Git e Node LTS: o produto e os gates rodam em containers, e o único script no
  host (o do fluxo) é Node puro, sem dependências.
- PostgreSQL dá o que R07 e R11 precisam sem infraestrutura extra: transações, lock de linha (`SELECT … FOR UPDATE`),
  `FOR UPDATE SKIP LOCKED` para o worker do gateway.
- HTML renderizado no servidor, formulários `POST` e nenhum build de front-end: o brief não avalia design, e menos
  peças significam menos lugares para as features se desencontrarem. Marcadores estáveis (`data-metric`,
  `data-result`, `data-section`) servem ao avaliador e aos testes.
- Express 5 + `pg` + ESLint são as únicas dependências. Testes com `node:test`, contra o app real em HTTP e um
  Postgres efêmero (`docker-compose.gates.yml`).
- Para paralelizar sem conflito, cada feature é um módulo carregado automaticamente (`src/modules/<nome>/`), com
  migração de número reservado e testes em `test/<ID>/`, e se pluga por pontos de extensão (seções da página de
  gestão, extras da vitrine, capacity guard, handler do gateway).

### Como R07 foi garantida sob concorrência

Toda compra — vitrine ou API, o serviço é um só (`purchaseTicket` em `src/modules/sales/service.js`) — roda numa
transação que começa travando a linha do evento (`SELECT … FROM events WHERE id = $1 FOR UPDATE`), reconta as vagas
ocupadas (`pending` + `confirmed`) e só então insere o ingresso pendente e a cobrança. Compras simultâneas do mesmo
evento esperam o lock e cada uma reconta já vendo as anteriores commitadas, então ocupadas ≤ lotação sempre.
Editar a lotação (capacity guard, R03) e cancelar (R11) travam a mesma linha, então não há corrida entre "reduzir
lotação" ou "cancelar" e "comprar". Check-in e cancelamento seguem a mesma ordem de locks (evento → ingresso), sem
deadlock. Descartei um contador `occupied` (precisaria ser mantido em recusa e cancelamento) e `SERIALIZABLE` (exige
retry em todo chamador).

Como foi provado — "teste de concorrência que passa uma vez não prova nada":
- `test/F04/concurrency.test.js`: 30 compras disparadas juntas (`Promise.all`) em lotação 5, repetido em 10 eventos
  novos → sempre 5 aceitas e 25 `sold_out`; uma variante comprova via `pg_stat_activity` que as compras de fato
  esperam o lock ao mesmo tempo; outra mistura compras com redução de lotação. Teste de mutação: trocando o lock por
  um `SELECT` simples, a rajada vende 6 e 8 ingressos — o teste pega.
- `test/F05/burst.test.js`: a mesma rajada por HTTP na API de parceiros, em vários eventos.
- `test/F07/concurrency.test.js`: cancelamento disparado no meio de rajadas de compra não deixa ingresso ativo.
- `scripts/rajada.sh 5`: o comando exato do passo 15 (`xargs -P 30`) em 5 eventos novos contra o produto no ar.

### Como a resposta assíncrona do gateway foi implementada

O gateway simulado (`src/modules/gateway/`) é persistente: na mesma transação da compra, `requestCharge` grava em
`gateway_charges` a cobrança com o resultado e o instante sorteados pelo final do cartão (2–5 s ou 30–40 s, como no
brief), e a compra responde na hora (R06). Um worker do próprio app varre a cada 200 ms as cobranças vencidas
(`FOR UPDATE SKIP LOCKED`, uma transação por cobrança: entrega única mesmo com vários workers; reentrega se o
handler falhar) e chama o handler de vendas, que faz `UPDATE tickets SET status = … WHERE id = $1 AND status =
'pending'`. Esse `AND status = 'pending'` é o que garante R11: a resposta que chega depois do cancelamento encontra o
ingresso `cancelled`/`refunded` e não muda nada. Por ser persistido, reiniciar o app não perde respostas. Um gateway
real trocaria só a implementação (`requestCharge` + webhook), mantendo a interface. Nenhuma chave de pagamento existe
no produto; `GATEWAY_MODE` diferente de `simulated` falha na subida.

### Como a avaliação foi isolada do implementador

- Papéis separados: o orquestrador (sessão principal do Claude Code, Claude Opus 5.5) escreveu PRD, specs, planos e
  contratos, implementou a fundação (F01) e integrou os PRs; F02–F09 foram implementadas cada uma por um subagente
  próprio (Claude Opus 5.5) numa worktree, e F10 por uma sessão própria do Claude Code; **toda** avaliação,
  inclusive a de F01, foi feita por outro subagente,
  novo e de contexto vazio, **com outro modelo** (Claude Sonnet 5.5), que só recebeu o repositório público, o commit
  e o caminho do contrato — nunca o relato do implementador.
- O avaliador clona o commit numa pasta vazia, sobe o ambiente com os tempos reais do gateway, executa cada item do
  contrato e escreve o relatório (data, commit, ferramenta, modelo, veredito por item com evidência). Ele não edita
  código, não commita e não faz push.
- O relatório é commitado uma única vez pelo orquestrador e nunca editado (verificável com
  `git log --format="%h %ad" --date=iso -- docs/features/<ID>-*/reports/*.md`). Reprovação geraria correção e um novo
  relatório, nunca a edição do antigo.
- Depois do último merge, o Fluxo do avaliador roda inteiro contra a `main` a partir de um clone limpo (F09), porque
  é quando as features se encontram que as falhas aparecem.

### Layout (F10)

Depois da entrega do MVP veio o pedido de um layout fluido com azul e roxo como base. Ele foi implementado por uma
sessão de agente própria (PR #10), sem mudar comportamento: rotas, textos visíveis e marcadores `data-*` são os
mesmos. Tokens de cor em `:root`, tipografia e espaçamentos com `clamp()`, grades `auto-fit` (vitrine, página de
gestão, painel), tabelas que rolam por dentro em telas estreitas e modo escuro por `prefers-color-scheme`; a folha
fica em `src/core/style.js`. O registro no processo (PRD, spec, plano, contrato) veio depois do merge, no PR #11,
e a avaliação independente atestou o commit com o layout: 11/11, com o Fluxo do avaliador ainda 94/94.

### O que apareceu quando as features se encontraram

- Os testes de F02 exigiam a lista exata de seções da página de gestão e quebravam assim que F06, F07 ou F08
  registravam a sua. F08 corrigiu primeiro e o mesmo commit foi aplicado (cherry-pick) em F06 e F07, para o merge não
  conflitar.
- F06 mantém o campo de check-in em evento cancelado (R10 permite); F02 e F07 tinham testes que proibiam qualquer
  formulário nessa página. Os dois passavam sozinhos e falhavam juntos; a asserção foi restrita aos formulários de
  edição, publicação e cancelamento (o que R11 exige) — F06 no teste de F02, e o orquestrador no merge de F07
  (PR #7).
- O helper de testes que entrega respostas do gateway entregava todas as vencidas, o que deixava um teste de F04
  intermitente sob carga; e dois clones com o mesmo nome de pasta colidiam nos gates. Ambos corrigidos em F09.
- No layout (F10), o CSS embutido no `<head>` levava seletores como `[data-metric]` para páginas negadas, e os
  testes de isolamento de R13 (que procuram marcadores de dados numa página 404) quebraram. A folha passou a ser
  servida à parte (`/assets/catraca.css`) e os testes ficaram como estavam.
