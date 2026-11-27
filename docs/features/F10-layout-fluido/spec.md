# Spec F10 — Layout fluido em azul e roxo

Critérios do PRD: F10-CA01 … F10-CA04 e os cross-feature X23 (F10 ← F01), X24 (F10 ← F02), X25 (F10 ← F08) e
X26 (F10 ← F09).

> **Registro retroativo.** O pedido ("crie um layout fluido utilizando as cores azul e roxo como base") chegou depois
> da entrega do MVP e foi implementado por uma sessão de agente própria, integrada pelo
> [PR #10](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/10). Esta spec descreve as decisões tomadas lá;
> o contrato e a avaliação independente foram feitos depois do merge e atestam o commit da `main` que contém F10.

## Objetivo e limites

Dar ao produto uma aparência coesa e responsiva, com azul e roxo como base, **sem mudar comportamento**: nenhuma rota,
nenhum texto visível e nenhum marcador `data-*` (lidos pelos testes, pelo Fluxo do avaliador e pelo avaliador humano)
muda. O brief não avalia design; F10 é melhoria de apresentação.

## Decisões técnicas

| Tema | Decisão | Por quê |
|---|---|---|
| Onde fica o CSS | `src/core/style.js` exporta `STYLE`, `STYLE_PATH` (`/assets/catraca.css`) e `STYLE_HREF` (`?v=<hash do conteúdo>`); o app serve a folha em `GET /assets/catraca.css` com `Cache-Control: public, max-age=86400` | Com o CSS embutido no `<head>`, seletores como `[data-metric]` e `[data-result]` apareciam no HTML de páginas negadas e quebravam testes de isolamento de R13. O hash no `?v=` invalida o cache quando a folha muda. |
| Paleta | tokens em `:root`: azul `#2563eb`/`#1d4ed8`/`#1e40af`, roxo `#7c3aed`/`#6d28d9`/`#5b21b6`, gradiente azul → roxo na faixa do cabeçalho, nos títulos e nos botões principais | pedido do usuário |
| Fluidez | tipografia, espaçamentos e raios com `clamp()`; contêiner com `min()`/`max()` em vez de largura fixa; grades com `repeat(auto-fit/auto-fill, minmax(min(100%, Xrem), 1fr))` | o layout se reorganiza sozinho, sem pontos de quebra fixos para o essencial |
| Grades | vitrine: cards de evento (várias colunas → 1 no celular); página de gestão: seções lado a lado conforme a largura; painel: um card por número | leitura rápida em qualquer tela |
| Telas estreitas | abaixo de 44rem, tabelas viram blocos com `overflow-x: auto` (rolam por dentro) | a página nunca ganha rolagem horizontal |
| Modo escuro | `@media (prefers-color-scheme: dark)` troca só os tokens (fundo `#0d0b22`, texto claro, azul/roxo mais claros) | segue a preferência do sistema |
| Estados com cor | status em "Meus ingressos" (`data-status`), resultado do check-in (`data-result`: liberada em verde, demais em âmbar/vermelho), selo de vagas e `Ingressos esgotados`, botão "Cancelar evento" em vermelho | reforça o significado sem mudar o texto |
| Acessibilidade | foco visível, `prefers-reduced-motion` respeitado, contraste dos tokens | — |

## Markup alterado (mínimo)

- `src/core/layout.js` (`page()`): `<link rel="stylesheet" href="${STYLE_HREF}">` no lugar do `<style>`, links do
  cabeçalho dentro de `<nav aria-label="Navegação principal">`, `<meta name="theme-color">` e um `<footer>`.
- `src/modules/events/views.js` (vitrine): os `<article class="card" data-event-id="…">` passam a ficar dentro de
  `<div class="cards">` — o `<article>` não muda (os testes de F04 o leem por regex).
- `src/modules/dashboard/views.js` (painel): cada par `<dt>`/`<dd data-metric>` dentro de `<div class="metric">`.
- `src/app.js`: rota `GET /assets/catraca.css`.

## Testes — `test/F10/layout.test.js`

A folha é servida como `text/css` no endereço versionado e contém os tokens azul/roxo e o modo escuro; as páginas
(vitrine, login, área do organizador) apontam para ela, não embutem `<style>` e têm `<main>` e o `<nav>`.
