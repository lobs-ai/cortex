#!/usr/bin/env bash
# Local non-docker dev bootstrap. Assumes node 20+.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

(cd "$ROOT/backend"  && npm install && npm run db:push && npm run seed)
(cd "$ROOT/frontend" && npm install)

echo
echo "Run in two terminals:"
echo "  cd backend  && npm run dev     # :9009"
echo "  cd frontend && npm run dev     # :3030"
