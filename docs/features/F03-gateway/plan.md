# Plano F03 — Gateway de pagamento simulado

Branch `feature/F03-gateway` (worktree própria, em paralelo com F02). Um commit por etapa: `F03: ...`.

1. **Migração** `003_gateway.sql`.
2. **Simulador** `simulator.js` (`isValidCardNumber`, `simulateResponse`, `scaledDelay`) + testes unitários.
3. **Cobrança e entrega** `index.js`: `requestCharge`, `onGatewayResponse`, `processDueCharges` com
   `FOR UPDATE SKIP LOCKED` e reentrega em falha.
4. **Worker** `start()` com guarda de modo e parada limpa.
5. **Testes de integração** `test/F03/*.test.js` (assíncrono, entrega única, reentrega, worker no app — X02).
6. **Verificação**: `./scripts/gates.sh` verde; com `./scripts/up.sh`, inserir uma cobrança vencida via `psql` e
   ver `responded_at` preenchido; `./scripts/down.sh`.
