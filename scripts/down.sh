#!/usr/bin/env bash
# Derruba tudo que ./scripts/up.sh iniciou (containers e rede). O volume do banco é mantido;
# use --purge para apagá-lo também.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${COMPOSE_PROJECT_NAME:-catraca}"
export CATRACA_PORT="${CATRACA_PORT:-3000}"

if [[ "${1:-}" == "--purge" ]]; then
  docker compose -p "$PROJECT" down --remove-orphans --volumes
else
  docker compose -p "$PROJECT" down --remove-orphans
fi
echo "Catraca derrubada (projeto Compose: $PROJECT)."
