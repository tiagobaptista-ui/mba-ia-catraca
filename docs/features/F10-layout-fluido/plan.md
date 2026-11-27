# Plano F10 — Layout fluido em azul e roxo

Implementação na branch `feature/F10-layout-fluido` (sessão de agente própria), integrada pelo
[PR #10](https://github.com/tiagobaptista-ui/mba-ia-catraca/pull/10). Registro no processo na branch
`feature/F10-registro`.

1. **Folha de estilo** `src/core/style.js` com tokens azul/roxo, tipografia e espaçamentos fluidos, grades e modo
   escuro; rota `GET /assets/catraca.css` em `src/app.js`. *(PR #10)*
2. **Markup mínimo** em `page()` (link da folha, `<nav>`, rodapé), vitrine (`.cards`) e painel (`.metric`), sem
   mudar textos nem `data-*`. *(PR #10)*
3. **Testes** `test/F10/layout.test.js`; gates completos verdes (154/154). *(PR #10)*
4. **Conferência visual** no navegador: desktop e 375 px, claro e escuro, nas páginas principais. *(PR #10)*
5. **Registro no processo**: F10 no PRD (feature, arestas, wave 6, X23–X26), spec, plano e contrato.
   *(branch `feature/F10-registro`)*
6. **Avaliação independente** do commit da `main` com F10 por um subagente de contexto vazio; relatório em
   `reports/`; `state.json` e README atualizados. *(branch `feature/F10-registro`)*
