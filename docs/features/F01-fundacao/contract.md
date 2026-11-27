# Contrato F01 — Fundação, contas e harness

Acordo entre implementador e avaliador. O avaliador executa cada item e registra evidência.

## Pré-requisitos de ambiente

- Docker em execução, Git, Node.js LTS, `curl`. Porta 3000 livre (ou `CATRACA_PORT`).
- Nenhum container do projeto `catraca` rodando antes do item C01 (`./scripts/down.sh`).
- Para C01, clonar o commit avaliado numa pasta vazia: `git clone <repo> /tmp/catraca-f01 && cd /tmp/catraca-f01 && git checkout <commit>`.
- Variáveis: `WEB=http://localhost:3000`.

## Itens verificáveis

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C01 | Subida em clone limpo | no clone: `./scripts/up.sh; echo $?` e depois `curl -s -o /dev/null -w '%{http_code}' $WEB/healthz` | saída 0; `200` |
| C02 | Seed carregada | `curl -s -c /tmp/j -o /dev/null -w '%{http_code} %{redirect_url}' -d 'email=organizador.a@catraca.dev&password=catraca123' $WEB/login` | `302` para `/organizer` |
| C03 | Seed tem os 3 usuários e é idempotente | `docker compose -p catraca exec -T db psql -U catraca catraca -c "select email, role from users order by email"` antes e depois de `docker compose -p catraca restart app` | 3 linhas (2 `organizer`, 1 `participant`), sem duplicar; restart sem erro nos logs |
| C04 | Derrubar encerra tudo | `./scripts/down.sh; curl -s -m 3 $WEB/healthz; echo "curl=$?"; docker ps --filter label=com.docker.compose.project=catraca -q \| wc -l` | curl falha (código ≠ 0); `0` containers |
| C05 | Subir de novo | `./scripts/up.sh` após C04, depois repetir C02 | sobe sem erro; login da seed `302` |
| C06 | Gates | `./scripts/gates.sh; echo $?` | lint e testes rodam (saída mostra testes `pass`), código `0` |
| C07 | Cadastro de participante | `curl -s -c /tmp/p -o /dev/null -w '%{http_code}' -d 'name=Ana&email=ana.f01@example.com&password=segredo1' $WEB/signup` e depois `curl -s -b /tmp/p $WEB/` | `302`; a página mostra "Ana" e "Sair" |
| C08 | Cadastro inválido | repetir C07 com o mesmo e-mail; e com `email=invalido` | `422` com "E-mail já cadastrado"; `422` com mensagem de e-mail inválido |
| C09 | Login e logout do participante | `POST /login` com `ana.f01@example.com` → `302 /`; `POST /logout` com o cookie → `302`; `GET /` depois não mostra "Sair" | conforme |
| C10 | Login inválido | `POST /login` com senha errada | `401` com "E-mail ou senha inválidos" |
| C11 | Sem cadastro de organizador | conta criada em C07: `select role from users where email='ana.f01@example.com'`; tentar `role=organizer` no POST /signup | papel `participant` nos dois casos |
| C12 | Visitante fora da área do organizador | `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' $WEB/organizer` | `302` para `/login?next=%2Forganizer` |
| C13 | Participante fora da área do organizador | com o cookie do participante: `curl -s -b /tmp/p -w '%{http_code}' $WEB/organizer` | `403`, página "Acesso restrito", sem lista de eventos |
| C14 | Organizador acessa a área | com o cookie de C02: `GET /organizer` | `200` |
| C15 | Sem chave de pagamento | `grep -nE 'GATEWAY\|KEY\|SECRET' docker-compose.yml` e `docker compose -p catraca config` | só `GATEWAY_MODE=simulated`, `GATEWAY_TIME_SCALE=1` e a chave de parceiro de teste; nenhuma chave de pagamento |
| C16 | AGENTS.md e CLAUDE.md | ler `AGENTS.md` e `CLAUDE.md` | AGENTS.md tem subir/derrubar/gates, regras e mapa dos artefatos; CLAUDE.md aponta para AGENTS.md |
| C17 | Testes de F01 cobrem o essencial | `ls test/F01` e saída de C06 | testes de utilitários (dinheiro, datas, ids), contas, papéis e seed idempotente passam |

## Mapeamento critério → itens

| Critério (PRD) | Itens |
|---|---|
| F01-CA01 | C01, C02 |
| F01-CA02 | C04 |
| F01-CA03 | C03, C05 |
| F01-CA04 | C06, C17 |
| F01-CA05 | C07, C08, C09, C10 |
| F01-CA06 | C03, C11 |
| F01-CA07 | C12, C13, C14 |
| F01-CA08 | C16 |
| (harness: modo simulado sem chave) | C15 |

Critérios cross-feature que partem de F01 (X01, X02, X03, X08) são cobertos nos contratos das features consumidoras.
