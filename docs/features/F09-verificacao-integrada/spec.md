# Spec F09 — Verificação integrada (Fluxo do avaliador automatizado)

Critérios do PRD: F09-CA01 … F09-CA03 e os cross-feature X19 (F09 ← F05), X20 (F09 ← F06), X21 (F09 ← F07) e
X22 (F09 ← F08). É onde as quatro features da wave 4, implementadas em paralelo, se encontram.

## Consome

O produto inteiro pela borda, como o avaliador: páginas HTML e formulários (F01, F02, F04, F06, F07, F08) e a API
de parceiros (F05). Nenhum import de `src/` — o script só fala HTTP.

## `scripts/fluxo-avaliador.mjs`

Script Node.js sem dependências (`fetch` nativo), executável no host com Node LTS:

```
WEB=http://localhost:3000 API=http://localhost:3000 KEY=pk_test_catraca_parceiro node scripts/fluxo-avaliador.mjs
```

- Cada "ator" (organizador A, organizador B, participante novo, participante da seed, visitante) é um cliente com
  cookie jar próprio; os passos de interface são os mesmos `GET`/`POST` de formulário que o navegador faria.
- Executa os passos **2 a 16** do Fluxo do avaliador (`docs/brief.md` + enunciado), na ordem e com os **tempos
  reais** do gateway (espera de verdade os 30–45 s dos cartões lentos), usando nomes únicos por execução
  (pode rodar várias vezes no mesmo banco).
- Cada verificação imprime `✔`/`✘`, o passo e a evidência (status HTTP, trecho do corpo, número do painel). No fim,
  um resumo; código de saída 0 só se tudo passou.
- Leitura de HTML por marcadores estáveis: `data-metric="…"` (painel), `data-result="…"` (check-in), textos
  exatos (`Ingressos esgotados`, mensagens de R10), `data-section`.
- Passos 1, 17 e 18 (clone, gates, derrubar/subir, artefatos) ficam fora do script: são comandos do harness e
  conferência de documentos (itens C03–C05 do contrato).

## `scripts/rajada.sh [repetições]`

Para cada repetição (padrão 5): entra como organizador A, cria e publica um evento novo (lotação 5, `10,00`,
daqui a 30 dias), dispara exatamente o comando do passo 15
(`seq 30 | xargs -P 30 -I{} curl … | sort | uniq -c`) e confere `5 202` e `25 409`. Sai com 0 só se todas as
repetições baterem. Variáveis: `WEB`, `API`, `KEY`.

## Correções

Se o fluxo revelar falha de integração, a correção é feita na feature dona do comportamento (no código do módulo
dela), com teste que reproduz a falha, nesta mesma branch — e registrada no relatório de avaliação de F09.
