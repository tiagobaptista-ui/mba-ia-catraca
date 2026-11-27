#!/usr/bin/env bash
# Sobe o produto (banco + app) a partir de um clone limpo: build, migrações e seed. Nenhum outro passo.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${COMPOSE_PROJECT_NAME:-catraca}"
export CATRACA_PORT="${CATRACA_PORT:-3000}"

docker compose -p "$PROJECT" up -d --build --wait --wait-timeout 300

cat <<INFO

Catraca no ar (projeto Compose: $PROJECT)
  WEB: http://localhost:$CATRACA_PORT
  API: http://localhost:$CATRACA_PORT   (rotas em /api/partner/...)
  Chave de parceiro (X-Api-Key): pk_test_catraca_parceiro
  Organizador A: organizador.a@catraca.dev / catraca123
  Organizador B: organizador.b@catraca.dev / catraca123
  Participante:  participante@catraca.dev / catraca123
Derrubar: ./scripts/down.sh
INFO
