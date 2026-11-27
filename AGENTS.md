# AGENTS.md — porta de entrada dos agentes

Catraca: venda de ingressos para eventos pequenos (vitrine, API de parceiros, check-in, cancelamento, painel).
Leia este arquivo inteiro antes de agir. O PRD manda no escopo; o contrato da feature manda no "pronto".

## Comandos (só precisam de Docker, Git e Node.js LTS)

| Ação | Comando | Observação |
|---|---|---|
| Subir tudo (build + migrações + seed) | `./scripts/up.sh` | produto em `http://localhost:3000` (`CATRACA_PORT` muda a porta) |
| Derrubar tudo que a subida iniciou | `./scripts/down.sh` | mantém o volume do banco; `--purge` apaga os dados |
| Gates (lint + testes automatizados) | `./scripts/gates.sh` | roda em containers isolados; `./scripts/gates.sh 'test/F04/*.test.js'` filtra testes |
| Logs do app | `docker compose -p catraca logs -f app` | |
| SQL no banco do app | `docker compose -p catraca exec db psql -U catraca catraca` | |
| Rajada do passo 15 | `./scripts/rajada.sh [repetições]` | (F09) eventos novos, padrão 5; confere `5 202` e `25 409` |
| Fluxo do avaliador automatizado | `node scripts/fluxo-avaliador.mjs` | (F09) com o produto no ar; passos 2–16, tempos reais (~2 min) |

Vários ambientes ao mesmo tempo (worktrees): `COMPOSE_PROJECT_NAME=catraca-f05 CATRACA_PORT=3105 ./scripts/up.sh`
(e o mesmo prefixo no `down.sh`). Fluxo e rajada recebem os endereços e a chave por variável (`WEB`, `API`, `KEY`):
`WEB=http://localhost:3105 API=http://localhost:3105 node scripts/fluxo-avaliador.mjs`. Os gates já usam um projeto
Compose próprio por pasta (nome da pasta + hash do caminho).

Credenciais da seed (senha `catraca123` para todas): `organizador.a@catraca.dev`, `organizador.b@catraca.dev`,
`participante@catraca.dev`. Chave de parceiro: `pk_test_catraca_parceiro`.

## Regras do projeto

1. **Escopo**: só o que está no PRD (`docs/PRD.md`) e na spec da sua feature. Regras do brief = R01–R13; cite-as.
2. **Pronto = contrato verde**: a feature só está pronta quando o relatório de avaliação mais recente aprova todos os
   itens de `docs/features/<ID>-*/contract.md`. Quem implementa **não** avalia.
3. **Gates antes de PR**: `./scripts/gates.sh` precisa passar na sua branch. Nunca desligue teste para passar.
4. **Isolamento entre features** (para paralelizar sem conflito):
   - código em `src/modules/<modulo>/` (o carregador monta sozinho; não há arquivo central de rotas);
   - migração com o número reservado no PRD (`src/db/migrations/00N_<nome>.sql`), nunca edite migração de outra feature;
   - testes em `test/<ID>/*.test.js`;
   - integração só pelos pontos de extensão documentados (PRD seção 4, "Provê").
5. **Relatórios são imutáveis**: cada avaliação cria um arquivo novo em `docs/features/<ID>-*/reports/`; nunca edite
   nem apague um relatório commitado. Reprovou → corrige → nova avaliação → novo relatório.
6. **Estado**: `state.json` guarda status, branch, PR e caminho do relatório mais recente de cada feature. Atualize-o
   ao mudar o status de uma feature. Status possíveis: `pending`, `in_progress`, `in_review`, `done`.
7. **Branches e commits**: `feature/<ID>-<nome>`; commits pequenos, um por etapa do plano, mensagem
   `<ID>: <o que mudou>`. Integração na `main` sempre por PR (merge commit, sem squash).
8. **Gateway**: o modo padrão é o simulado e não usa chave nenhuma. `GATEWAY_TIME_SCALE` (ex.: `0.02`) só acelera
   testes; não mude o padrão (`1`).
9. **Mensagens exatas da interface** (o avaliador compara texto): `Ingressos esgotados`,
   `Ingresso inválido para este evento`, `Evento cancelado`, `Ingresso não confirmado`, `Ingresso já utilizado`,
   `Entrada liberada`. Status: pendente, confirmado, recusado, cancelado, estornado.

## Convenções de código

- Node.js 24, ESM (`import`), Express 5, `pg`. Sem framework de front-end: HTML no servidor com `html\`...\``
  (`src/core/html.js`), que escapa tudo por padrão (use `raw()` só para HTML já escapado).
- Dinheiro sempre em centavos (inteiro). Datas em `timestamptz`; entrada e exibição em America/Sao_Paulo (−03:00),
  via `src/core/time.js`.
- IDs com prefixo (`usr_`, `evt_`, `tkt_`, `chg_`) via `src/core/ids.js`.
- Acesso ao banco com SQL parametrizado (`$1`); transações com `withTransaction(async (client) => …)`.
- Testes com `node:test`; helpers em `test/helpers/` (`startTestServer`, `resetDb`, `createClient`).

## Mapa dos artefatos

| Artefato | Caminho |
|---|---|
| Brief (regras R01–R13) | `docs/brief.md` |
| PRD (features, grafo, waves, critérios) | `docs/PRD.md` |
| Spec, plano, contrato e relatórios da feature | `docs/features/<ID>-<nome>/{spec,plan,contract}.md`, `reports/` |
| Estado do projeto | `state.json` |
| Harness | `scripts/up.sh`, `scripts/down.sh`, `scripts/gates.sh`, `docker-compose.yml`, `docker-compose.gates.yml` |
| Seed | `src/seed.js` |
| Código | `src/core/` (fundação), `src/modules/<modulo>/` (uma pasta por feature) |
| Testes | `test/<ID>/`, helpers em `test/helpers/` |

Módulos por feature: F01 `accounts` + `src/core`, F02 `events`, F03 `gateway`, F04 `sales`, F05 `partner-api`,
F06 `checkin`, F07 `cancellation`, F08 `dashboard`, F09 `scripts/fluxo-avaliador.mjs`.

## Como avaliar uma feature (papel de avaliador)

1. Use uma sessão ou subagente **novo** (contexto vazio), que não implementou a feature.
2. Leia só: este arquivo, `docs/PRD.md` (critérios da feature) e `docs/features/<ID>-*/contract.md`.
3. Faça checkout do commit a avaliar, suba o ambiente com os pré-requisitos do contrato e execute **cada** item.
4. Escreva `docs/features/<ID>-*/reports/<AAAA-MM-DD>-avaliacao-<N>.md` com: data, commit avaliado, branch,
   ferramenta e modelo, veredito por item (APROVADO/REPROVADO) com evidência (comando + saída / resposta HTTP) e o
   veredito geral. Não corrija código: aponte.
