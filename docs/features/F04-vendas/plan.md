# Plano F04 — Vendas: compra, vagas e "Meus ingressos"

Branch `feature/F04-vendas`. Um commit por etapa: `F04: ...`.

1. **Migração** `004_sales.sql`.
2. **Serviço** `service.js`: vagas (R05), `purchaseTicket` com lock do evento (R06, R07), consultas.
3. **Integrações**: handler condicional do gateway (R08), capacity guard (R03), extras da vitrine (R07).
4. **Rotas**: `POST /events/:id/purchase`, `GET /my-tickets` (R09).
5. **Testes** `test/F04/*.test.js` incluindo a rajada repetida (R07) e os cross X03–X07.
6. **Verificação**: gates verdes; no produto (`up.sh`), compra real com 0001 (confirmada em ≤ 5 s) e 0004
   (pendente ocupa vaga, `Ingressos esgotados`), `down.sh`.
