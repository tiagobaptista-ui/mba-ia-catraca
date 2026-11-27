# Plano F02 — Eventos do organizador e vitrine

Branch `feature/F02-eventos` (worktree própria, em paralelo com F03). Um commit por etapa: `F02: ...`.

1. **Migração** `002_events.sql`.
2. **Serviço** `service.js`: validação (R01), criar, editar (lock + guard), publicar, consultas, `lockEvent`.
3. **Extensões** `extensions.js`: capacity guard, seções da gestão, extras da vitrine, `loadOwnedEvent`,
   `renderManagementPage`, `renderEventPage`.
4. **Rotas e páginas** `index.js` (+ `views.js`): vitrine, página pública, área do organizador, gestão;
   remover `src/modules/placeholders/`.
5. **Testes** `test/F02/*.test.js` cobrindo F02-CA01…CA07 e X01.
6. **Verificação**: `./scripts/gates.sh` verde; conferência manual com `./scripts/up.sh` (criar, editar, publicar,
   vitrine) e `./scripts/down.sh`.
