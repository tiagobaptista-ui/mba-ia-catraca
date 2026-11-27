# Plano F05 — API de parceiros

Branch `feature/F05-api-parceiros` (worktree própria; wave 4 em paralelo com F06, F07 e F08). Um commit por
etapa: `F05: ...`.

1. **Autenticação**: middleware de `X-Api-Key` em `/api/partner` (401 antes de qualquer coisa).
2. **Listagem** `GET /api/partner/events`.
3. **Compra** `POST /api/partner/events/:eventId/purchases` com parse/validação (422) e mapeamento de erros.
4. **Consulta** `GET /api/partner/tickets/:ticketId`.
5. **Testes** `test/F05/*.test.js` (contrato, ordem de erros, rajada HTTP, X08–X11).
6. **Verificação**: gates verdes; no produto, os `curl` do contrato (inclusive a rajada com `xargs -P 30`).
