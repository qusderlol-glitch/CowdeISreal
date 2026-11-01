#!/usr/bin/env bash
# E2E: временный Postgres + миграции, две сборки (с настройками и без), vite preview, Playwright.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$ROOT/.pgtest-e2e"; PORT=54330
rm -rf "$DATA"; mkdir -p "$DATA"
run() { if [ "$(id -u)" = "0" ]; then chown -R postgres "$DATA"; sudo -u postgres "$@"; else "$@"; fi; }
run "$PGBIN/initdb" -D "$DATA/db" -U postgres -A trust >/dev/null
run "$PGBIN/pg_ctl" -D "$DATA/db" -o "-p $PORT -k $DATA -c wal_level=logical" -l "$DATA/log" -w start >/dev/null
cleanup() { kill "${P1:-0}" "${P2:-0}" 2>/dev/null || true; run "$PGBIN/pg_ctl" -D "$DATA/db" -m fast stop >/dev/null || true; }
trap cleanup EXIT
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -h "$DATA" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f supabase/tests/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
VITE_SUPABASE_URL=http://stand.test VITE_SUPABASE_ANON_KEY=stand-anon npx vite build --outDir .e2e/configured --emptyOutDir >/dev/null
VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir .e2e/unconfigured --emptyOutDir >/dev/null
npx vite preview --outDir .e2e/configured --port 4173 --strictPort >/dev/null 2>&1 & P1=$!
npx vite preview --outDir .e2e/unconfigured --port 4174 --strictPort >/dev/null 2>&1 & P2=$!
for i in $(seq 1 40); do curl -s localhost:4173 >/dev/null && curl -s localhost:4174 >/dev/null && break; sleep 0.25; done
E2E_BASE=http://localhost:4173 E2E_BASE_UNCONFIGURED=http://localhost:4174 E2E_SHOTS="${E2E_SHOTS:-$ROOT/docs/screenshots}" \
E2E_DB="postgresql://postgres@localhost/postgres?host=$DATA&port=$PORT" node "${E2E_SCRIPT:-scripts/e2e/run.mjs}"
