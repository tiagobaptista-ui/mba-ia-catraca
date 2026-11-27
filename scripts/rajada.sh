#!/usr/bin/env bash
# Rajada do passo 15 do Fluxo do avaliador (F09), repetida em eventos novos.
# Uso: ./scripts/rajada.sh [repetições]          (padrão 5; com o produto no ar)
#      WEB=http://localhost:3100 API=http://localhost:3100 ./scripts/rajada.sh 5
# Para cada repetição: entra como organizador A (cookie jar num diretório temporário), cria e publica um evento novo
# (lotação 5, R$ 10,00, daqui a 30 dias), dispara exatamente o comando do passo 15 e confere "5 202" e "25 409".
# Sai com 0 só se todas as repetições baterem.
set -euo pipefail

REPS="${1:-5}"
WEB="${WEB:-http://localhost:3000}"
API="${API:-http://localhost:3000}"
KEY="${KEY:-pk_test_catraca_parceiro}"

if ! [[ "$REPS" =~ ^[1-9][0-9]*$ ]]; then
  echo "uso: $0 [repetições]   (inteiro maior ou igual a 1; padrão 5)" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
JAR="$TMP/cookies.txt"
RUN="$(date -u +%y%m%d%H%M%S)-$$" # nomes únicos: pode rodar várias vezes no mesmo banco

# Início daqui a 30 dias, no fuso da Catraca (UTC−03:00), no formato de <input type="datetime-local">.
EPOCH=$(($(date +%s) + 30 * 24 * 3600 - 3 * 3600))
STARTS_AT="$(date -u -d "@$EPOCH" +%Y-%m-%dT%H:%M 2>/dev/null || date -u -r "$EPOCH" +%Y-%m-%dT%H:%M)"

# POST de formulário com o cookie jar do organizador A. Imprime "<status> <endereço do redirecionamento>".
post_form() {
  local url="$1"
  shift
  local data=(-d '')
  if [[ $# -gt 0 ]]; then
    data=()
    for field in "$@"; do data+=(--data-urlencode "$field"); done
  fi
  curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -b "$JAR" -c "$JAR" "${data[@]}" "$url" || true
}

read -r status _ <<<"$(post_form "$WEB/login" "email=organizador.a@catraca.dev" "password=catraca123")"
if [[ "$status" != 302 ]]; then
  echo "✘ login do organizador A em $WEB/login falhou (HTTP $status). O produto está no ar? (./scripts/up.sh)" >&2
  exit 1
fi
echo "Organizador A logado em $WEB. Rajadas em $API: $REPS repetição(ões), 30 compras simultâneas cada."

passed=0
for i in $(seq "$REPS"); do
  echo
  read -r status location <<<"$(post_form "$WEB/organizer/events" \
    "name=Rajada $RUN #$i" "startsAt=$STARTS_AT" "venue=Bar da Rajada" "capacity=5" "price=10,00")"
  E4="${location##*/}"
  if [[ "$status" != 302 || -z "$E4" ]]; then
    echo "✘ repetição $i/$REPS: criação do evento falhou (HTTP $status)"
    continue
  fi
  read -r status _ <<<"$(post_form "$WEB/organizer/events/$E4/publish")"
  if [[ "$status" != 302 ]]; then
    echo "✘ repetição $i/$REPS: publicação do evento $E4 falhou (HTTP $status)"
    continue
  fi
  echo "Repetição $i/$REPS: evento $E4 (lotação 5, R\$ 10,00, início $STARTS_AT)"

  # Comando do passo 15, exatamente como no Fluxo do avaliador.
  OUT="$(seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST "$API/api/partner/events/$E4/purchases" \
    -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
    -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c)" || true
  echo "$OUT"

  if [[ "$(printf '%s\n' "$OUT" | awk '{ print $1, $2 }')" == $'5 202\n25 409' ]]; then
    passed=$((passed + 1))
    echo "✔ repetição $i/$REPS: 5 202 e 25 409"
  else
    echo "✘ repetição $i/$REPS: esperado exatamente 5 202 e 25 409"
  fi
done

echo
echo "Rajada: $passed de $REPS repetição(ões) com exatamente 5 202 e 25 409."
[[ "$passed" -eq "$REPS" ]]
