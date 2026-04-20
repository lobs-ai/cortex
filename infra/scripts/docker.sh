#!/usr/bin/env bash
# Wrapper around `docker compose` for the cortex stack.
# Run from anywhere; it always resolves the repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker-compose.yml"
ENV_FILE="$ROOT/.env"

# docker compose auto-loads $ROOT/.env when run from the repo root, but our
# compose file uses `env_file: ../.env` relative to infra/, so make sure the
# file exists before we try to bring anything up.
ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "no .env at $ENV_FILE — copying from .env.example"
    cp "$ROOT/.env.example" "$ENV_FILE"
  fi
}

dc() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

usage() {
  cat <<EOF
cortex docker wrapper

usage: $(basename "$0") <command>

commands:
  start       bring the stack up in the background (build if images missing)
  stop        stop containers but keep volumes (pg data stays)
  restart     stop + start
  rebuild     force a fresh image build, then start
  logs [svc]  tail logs — optionally for one service (app, postgres, redis, worker)
  ps          show running services
  shell       open a shell inside the app container
  clean       stop + remove containers AND volumes (destroys postgres/redis data)
  help        show this

services (per docker-compose.yml): app, worker, postgres, redis
EOF
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  start)
    ensure_env
    dc up -d --build
    dc ps
    ;;
  stop)
    dc stop
    ;;
  restart)
    dc stop
    ensure_env
    dc up -d
    dc ps
    ;;
  rebuild)
    ensure_env
    dc down
    dc build --no-cache
    dc up -d
    dc ps
    ;;
  logs)
    if [ $# -gt 0 ]; then
      dc logs -f --tail=200 "$@"
    else
      dc logs -f --tail=200
    fi
    ;;
  ps|status)
    dc ps
    ;;
  shell)
    dc exec app /bin/sh
    ;;
  clean)
    read -r -p "This will delete postgres + redis volumes. Continue? [y/N] " ans
    case "$ans" in
      y|Y|yes) dc down -v ;;
      *) echo "aborted" ;;
    esac
    ;;
  help|-h|--help|"")
    usage
    ;;
  *)
    echo "unknown command: $cmd"
    echo
    usage
    exit 1
    ;;
esac
