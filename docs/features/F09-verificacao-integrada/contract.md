# Contrato F09 — Verificação integrada (Fluxo do avaliador automatizado)

## Pré-requisitos de ambiente

- Docker, Git, Node.js LTS, `curl`, `xargs`. Nada do projeto `catraca` rodando; porta 3000 livre.
- Clone do commit avaliado numa pasta **vazia** (é o passo 1 do Fluxo do avaliador).
- `WEB=http://localhost:3000`, `API=http://localhost:3000`, `KEY=pk_test_catraca_parceiro`.

## Itens verificáveis

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C01 | Passo 1: subida em clone limpo | no clone: `./scripts/up.sh; echo $?`; `curl -s $WEB/healthz` | `0`; `ok` |
| C02 | Passos 2–16 automatizados | `node scripts/fluxo-avaliador.mjs; echo $?` (modo padrão, tempos reais) | todas as verificações `✔`, código `0` |
| C03 | Rajada repetida (passo 15) | `./scripts/rajada.sh 5; echo $?` | 5 repetições, cada uma com `5 202` e `25 409`; código `0` |
| C04 | Passo 17: gates, derrubar, subir | `./scripts/gates.sh; echo $?`; `./scripts/down.sh`; `curl -s -m 3 $WEB/healthz; echo $?`; `docker ps --filter label=com.docker.compose.project=catraca -q \| wc -l`; `./scripts/up.sh`; login do organizador A | gates `0`; curl falha; `0` containers; sobe sem erro; login `302` |
| C05 | Conferência manual de interface | com o produto no ar, seguir na mão (curl ou navegador) os passos 5 (Meus ingressos pendente → confirmado), 10 (check-in) e 14 (painel de E3) | mesmos resultados do script |
| C06 | X19 — API integrada | na saída de C02, as verificações dos passos 2, 4, 6, 7, 8, 15 e 16 | todas `✔` |
| C07 | X20 — check-in integrado | na saída de C02, passos 10, 11 (C3 de outro organizador → inválido) e 14 (`Evento cancelado`) | todas `✔` |
| C08 | X21 — cancelamento integrado | na saída de C02, passos 12–14 (T6 `refunded`, T5 `cancelled` e ainda `cancelled` após 45 s) | todas `✔` |
| C09 | X22 — painel integrado | na saída de C02, painel nos passos 9, 10, 14 e 15 | todas `✔` |

## Mapeamento critério → itens

| Critério (PRD) | Itens |
|---|---|
| F09-CA01 | C02, C05 |
| F09-CA02 | C03 |
| F09-CA03 | C01, C04 |
| X19 (F09 ← F05) | C06 |
| X20 (F09 ← F06) | C07 |
| X21 (F09 ← F07) | C08 |
| X22 (F09 ← F08) | C09 |
