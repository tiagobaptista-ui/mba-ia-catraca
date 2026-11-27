# Spec F01 — Fundação, contas e harness

Critérios do PRD: F01-CA01 … F01-CA08. Arestas que saem daqui: X01 (F02), X02 (F03), X03 (F04), X08 (F05).

## Decisões técnicas

| Tema | Decisão | Por quê |
|---|---|---|
| Runtime | Node.js 24 (imagem `node:24-alpine`) | o avaliador só tem Node LTS + Docker; tudo roda em container |
| HTTP | Express 5 | maduro, trata erros de handlers `async` |
| Banco | PostgreSQL 17 (`postgres:17-alpine`), driver `pg` | transações e lock de linha (`FOR UPDATE`) resolvem R07 sem infraestrutura extra |
| Front-end | HTML renderizado no servidor, formulários `POST`, sem JS obrigatório | o brief não avalia design; menos peças, nada de build |
| Sessão | cookie `catraca_sid` (HttpOnly, SameSite=Lax) → tabela `sessions` (hash SHA-256 do token) | simples, sem dependência |
| Senha | `crypto.scrypt` com sal aleatório | nativo do Node |
| Migrações | arquivos `src/db/migrations/NNN_<nome>.sql`, aplicados em ordem e registrados em `schema_migrations`, sob `pg_advisory_lock` | cada feature tem número reservado → sem conflito |
| Módulos | `src/modules/<nome>/index.js` exporta `{ name, order, register(app), start? }`; `loadModules()` importa todos, ordena por `order` | feature nova não edita arquivo central |
| Testes | `node:test`, servidor real em porta efêmera, banco Postgres dos gates | testa o que o avaliador usa (HTTP) |
| Lint | ESLint 9 (`@eslint/js` recommended) | gate barato |

## Componentes

- `src/core/config.js` — lê env: `PORT` (3000), `DATABASE_URL`, `PARTNER_API_KEY` (`pk_test_catraca_parceiro`),
  `GATEWAY_MODE` (`simulated`), `GATEWAY_TIME_SCALE` (1), `GATEWAY_POLL_MS` (200), `SESSION_TTL_HOURS` (12).
- `src/core/db.js` — `pool`, `query(text, params)`, `withTransaction(fn)` (BEGIN/COMMIT/ROLLBACK).
- `src/core/migrate.js` — `migrate()` idempotente.
- `src/core/html.js` — `html` (tagged template; escapa interpolações; arrays são concatenados), `raw(str)`.
- `src/core/layout.js` — `page({ title, user, body })`: `<!doctype html>`, `<meta charset="utf-8">`, navegação
  (Vitrine; Meus ingressos se participante; Área do organizador se organizador; Entrar/Criar conta ou "Sair").
- `src/core/auth.js` — `hashPassword`, `verifyPassword`, `createSession(res, userId)`, `destroySession`,
  middleware `loadUser` (popula `req.user`), `requireRole(role)`:
  sem usuário → `302 /login?next=<url>`; papel errado → `403` com página "Acesso restrito" (sem dados).
- `src/core/time.js` — `parseLocalDateTime('2026-12-26T21:00')` (−03:00) → `Date`; `formatDateTimeBR(date)` →
  `26/12/2026 21:00`; `toIsoOffset(date)` → `2026-12-26T21:00:00-03:00`; `toDateTimeLocalValue(date)`.
- `src/core/money.js` — `parseMoneyToCents('150,00' | '150.00' | '150')` → 15000 (ou `null`);
  `formatCents(35000)` → `R$ 350,00` (espaço comum, milhar com ponto).
- `src/core/ids.js` — `newId('evt')` → `evt_` + 10 chars base32; `newTicketCode()` → 8 chars de
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- `src/core/modules.js` — `loadModules()`.
- `src/app.js` — `createApp(modules)`: `urlencoded` (JSON fica a cargo de cada módulo), `loadUser`, `/healthz`,
  módulos, 404 e handler de erro.
- `src/server.js` — `migrate()` → `seed()` → `listen` → `start()` dos módulos; SIGTERM/SIGINT encerram com graça.
- `src/seed.js` — upsert por e-mail (atualiza nome, papel e senha) dos três usuários; pode rodar N vezes.
- `src/modules/accounts/` — `GET/POST /signup`, `GET/POST /login`, `POST /logout`, `GET /organizer` provisório
  (substituído pela lista de eventos em F02).

## Modelo de dados (migração `001_accounts.sql`)

```sql
users(id text pk, name text, email text unique (minúsculo), password_hash text, role text check in ('organizer','participant'), created_at timestamptz)
sessions(id text pk /* sha256 do token */, user_id text fk users on delete cascade, expires_at timestamptz, created_at timestamptz)
```

## Contas e validação

- Cadastro: nome (1–100), e-mail válido (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), senha ≥ 6. E-mail normalizado em
  minúsculas. Repetido → "E-mail já cadastrado". Sucesso → sessão criada, redireciona para `/`.
- Login: erro genérico "E-mail ou senha inválidos". Sucesso → `next` (se for caminho local) ou `/organizer`
  (organizador) ou `/` (participante).
- Logout: `POST /logout` apaga a sessão e o cookie.

## Harness

- `docker-compose.yml`: serviços `db` (sem porta publicada, volume `db-data`, healthcheck `pg_isready`) e `app`
  (build do `Dockerfile`, alvo `runtime`; porta `${CATRACA_PORT:-3000}:3000`; healthcheck em `/healthz`;
  `init: true`). Env de produto com valores padrão — nenhum segredo real.
- `scripts/up.sh`: `docker compose -p ${COMPOSE_PROJECT_NAME:-catraca} up -d --build --wait`, imprime endereços e
  credenciais. `scripts/down.sh`: `down --remove-orphans` (`--purge` → `-v`).
- `docker-compose.gates.yml` + `scripts/gates.sh`: projeto `catraca-gates-<pasta>`, banco em `tmpfs`, serviço
  `gates` (alvo `test` do Dockerfile) roda `npm run lint && npm test`; derruba tudo no fim e devolve o código.
- `test/helpers/`: `startTestServer({ workers })`, `resetDb()` (TRUNCATE de todas as tabelas menos
  `schema_migrations` + seed), `createClient(baseUrl)` (cookies, `get`, `postForm`, `postJson`, `login`),
  `futureLocalDateTime(days)`.
- Testes rodam com `--test-concurrency=1` (os arquivos compartilham o banco).

## Fora do escopo de F01

Eventos, compra, gateway e API de parceiros (as features seguintes). CSRF token: mitigado por SameSite=Lax.
