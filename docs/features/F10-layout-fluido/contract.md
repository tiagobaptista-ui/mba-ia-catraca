# Contrato F10 — Layout fluido em azul e roxo

## Pré-requisitos de ambiente

- Docker, Git, Node.js LTS, `curl`; Google Chrome (para capturas headless) ou um navegador controlável que permita
  mudar a largura da janela e o esquema de cores.
- Clone do commit avaliado numa pasta vazia; produto no ar com `./scripts/up.sh` (modo padrão).
  `WEB=http://localhost:3000`.
- Dados: pelo menos 3 eventos publicados pelo organizador A (para a grade da vitrine), um deles com ingressos vendidos
  (para o painel e "Meus ingressos"), criados pela interface como nos outros contratos, ou rodando antes
  `node scripts/fluxo-avaliador.mjs` (que cria eventos e vendas).
- Capturas headless (páginas sem login):
  `"<chrome>" --headless=new --hide-scrollbars --window-size=375,900 --screenshot=out.png "$WEB/"`
  (`<chrome>` no macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`). Para páginas com login e para
  medir rolagem horizontal, use um navegador controlável e
  `document.documentElement.scrollWidth <= window.innerWidth`.

## Itens verificáveis

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C01 | Folha de estilo servida | `curl -s -D - -o /tmp/f10.css $WEB/assets/catraca.css \| head -5`; `grep -cE '#2563eb\|#7c3aed\|prefers-color-scheme: dark' /tmp/f10.css` | `200`, `Content-Type: text/css`; tokens azul e roxo e bloco de modo escuro presentes |
| C02 | Páginas referenciam a folha e não embutem CSS (X23) | `curl -s $WEB/`, `curl -s $WEB/login` e, logado como A, `GET /organizer`: procurar `<link rel="stylesheet" href="/assets/catraca.css?v=` e `<style` | link presente nas três; nenhum `<style` |
| C03 | Desktop: identidade azul/roxo e grade (X24) | captura da vitrine com 1280 px de largura | faixa do cabeçalho em gradiente azul → roxo; eventos em cards numa grade com mais de uma coluna |
| C04 | Celular sem rolagem horizontal | com 375 px: vitrine, página de um evento, "Meus ingressos" (participante com ingressos) e página de gestão (organizador A); medir `scrollWidth` e capturar | `scrollWidth <= innerWidth` nas quatro; vitrine em uma coluna; tabelas rolam por dentro |
| C05 | Modo escuro | vitrine e página de gestão com `prefers-color-scheme: dark` (ex.: Chrome `--force-dark-mode` ou emulação do navegador) | fundo escuro, texto claro, acentos azul/roxo legíveis |
| C06 | Painel em cards com os mesmos marcadores (X25) | logado como A, `GET /organizer/events/{id}` de um evento com vendas: `grep -o 'class="metric"><dt>[^<]*</dt><dd data-metric="[a-z]*">[^<]*'` e captura | 6 blocos `.metric` (Confirmados, Pendentes, Check-ins, Vagas disponíveis, Receita, Estornados), cada um com seu `data-metric`; valores coerentes com os ingressos |
| C07 | Marcação da vitrine preservada (X24) | `curl -s $WEB/ \| grep -o '<div class="cards"><article class="card" data-event-id="evt_[a-z0-9]*">'`; seções da gestão: `grep -o 'data-section="[a-z]*"'` na página de gestão | `<article class="card" data-event-id=…>` dentro de `.cards`; seções `details`, `dashboard`, `checkin`, `publish`, `edit`, `cancel` presentes |
| C08 | Página negada sem dados (X23, R13) | logado como B, `GET /organizer/events/{id de A}`: `grep -c 'data-metric\|data-result\|data-section'` e nome do evento | `404`; contagem `0`; nome ausente |
| C09 | Estados com cor | check-in de um código válido e de um inválido na gestão; "Meus ingressos" com status diferentes; captura | `Entrada liberada` destacada em verde; mensagens de recusa em âmbar/vermelho; status com cores distintas; textos iguais aos de R10 |
| C10 | Comportamento intacto: Fluxo do avaliador (X26) | `node scripts/fluxo-avaliador.mjs; echo $?` (modo padrão) | todas as verificações `✔`, código `0` |
| C11 | Gates | `./scripts/gates.sh; echo $?` | `0`; testes de `test/F10` passam |

## Mapeamento critério → itens

| Critério (PRD) | Itens |
|---|---|
| F10-CA01 | C01, C02, C03 |
| F10-CA02 | C03, C04 |
| F10-CA03 | C05 |
| F10-CA04 | C07, C09, C10, C11 |
| X23 (F10 ← F01) | C02, C08 |
| X24 (F10 ← F02) | C03, C07 |
| X25 (F10 ← F08) | C06 |
| X26 (F10 ← F09) | C10 |
