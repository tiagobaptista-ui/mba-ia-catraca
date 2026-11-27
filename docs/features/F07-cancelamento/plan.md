# Plano F07 — Cancelamento de evento

Branch `feature/F07-cancelamento` (worktree própria; wave 4 em paralelo com F05, F06 e F08). Um commit por
etapa: `F07: ...`.

1. **Serviço** `service.js`: `cancelEvent` transacional (lock do evento, status, conversão dos ingressos).
2. **Seção e rota**: seção `cancel` na página de gestão e `POST /organizer/events/:id/cancel`.
3. **Testes** `test/F07/*.test.js` (conversão, irreversibilidade, saída da vitrine, resposta tardia,
   concorrência, R13, X14–X16).
4. **Verificação**: gates verdes; no produto, cancelar com um ingresso confirmado e um pendente lento
   (`…0003`) e conferir os status antes e depois da resposta do gateway.
