# Plano F06 — Check-in

Branch `feature/F06-checkin` (worktree própria; wave 4 em paralelo com F05, F07 e F08). Um commit por etapa:
`F06: ...`.

1. **Serviço** `service.js`: `checkIn(eventId, code)` com a ordem de R10 e locks evento → ingresso.
2. **Seção e rota**: seção `checkin` na página de gestão e `POST /organizer/events/:id/checkin`.
3. **Testes** `test/F06/*.test.js` (mensagens, ordem, concorrência, R13, X12, X13).
4. **Verificação**: gates verdes; no produto, check-in pela página de gestão com códigos reais.
