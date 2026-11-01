#!/usr/bin/env bash
# Поднимает временный Postgres, применяет шим Supabase + миграции + SQL-тесты. Требует PostgreSQL 15+ (initdb, pg_ctl).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$ROOT/.pgtest"; PORT="${PGTEST_PORT:-54329}"
rm -rf "$DATA"; mkdir -p "$DATA"
RUNAS=""; if [ "$(id -u)" = "0" ]; then chown -R postgres "$DATA"; RUNAS="sudo -u postgres"; command -v sudo >/dev/null || RUNAS="su postgres -c"; fi
run() { if [ "$RUNAS" = "su postgres -c" ]; then su postgres -c "$*"; elif [ -n "$RUNAS" ]; then $RUNAS "$@"; else "$@"; fi; }
run "$PGBIN/initdb" -D "$DATA/db" -U postgres -A trust >/dev/null
run "$PGBIN/pg_ctl" -D "$DATA/db" -o "-p $PORT -k $DATA -c wal_level=logical" -l "$DATA/log" -w start >/dev/null
trap 'run "$PGBIN/pg_ctl" -D "$DATA/db" -m fast stop >/dev/null' EXIT
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -h "$DATA" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do echo "migrate: $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
echo "migrate again (idempotency)"; for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
for t in "$ROOT"/supabase/tests/[1-9]*.sql; do echo "test: $(basename "$t")"; "${PSQL[@]}" -o /dev/null -f "$t"; done
echo "SQL OK"
