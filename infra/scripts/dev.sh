#!/usr/bin/env bash
# Local non-docker dev bootstrap. Assumes node 20+.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

(cd "$ROOT/backend"  && npm install && npm run db:push && npm run seed)
(cd "$ROOT/frontend" && npm install)

echo
echo "Run from backend/:  npm run dev    # Fastify + embedded Next on :9009"
