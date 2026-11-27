# Plano F01 — Fundação, contas e harness

Cada etapa termina com um commit `F01: ...`.

1. **Projeto Node e lint** — `package.json` (ESM, scripts `start`, `lint`, `test`), `eslint.config.js`,
   `package-lock.json`.
2. **Core** — `config`, `db`, `migrate`, `html`, `layout`, `time`, `money`, `ids`, `modules`; migração
   `001_accounts.sql`.
3. **Auth e contas** — `auth.js` (scrypt, sessões, `loadUser`, `requireRole`), módulo `accounts` (signup, login,
   logout, `/organizer` provisório), `app.js`, `server.js`, `seed.js`.
4. **Docker e scripts** — `Dockerfile` (alvos `runtime` e `test`), `docker-compose.yml`,
   `docker-compose.gates.yml`, `scripts/up.sh`, `scripts/down.sh`, `scripts/gates.sh`.
5. **Helpers e testes** — `test/helpers/*`, `test/F01/*.test.js` (utilitários, contas, papéis, seed idempotente).
6. **Verificação** — gates verdes; ciclo up → login seed → down → up; `README` e `AGENTS.md` conferidos.
