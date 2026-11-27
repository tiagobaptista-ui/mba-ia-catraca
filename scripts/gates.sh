#!/usr/bin/env bash
# Gates do projeto: lint + testes automatizados, num ambiente Docker efêmero e isolado do produto.
# Uso: ./scripts/gates.sh                      (tudo)
#      ./scripts/gates.sh 'test/F04/*.test.js' (lint + só os testes indicados)
set -euo pipefail
cd "$(dirname "$0")/.."

# Projeto Compose próprio por pasta: worktrees diferentes rodam gates ao mesmo tempo sem colidir.
SLUG="$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9\n' '-')"
PROJECT="catraca-gates-${SLUG}"
COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.gates.yml)

cleanup() { "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${COMPOSE[@]}" build gates
if [[ $# -gt 0 ]]; then
  "${COMPOSE[@]}" run --rm gates sh -c "npm run lint && node --test --test-concurrency=1 --test-force-exit --test-reporter=spec $*"
else
  "${COMPOSE[@]}" run --rm gates
fi
echo "Gates OK"
