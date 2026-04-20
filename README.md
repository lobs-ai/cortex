# Cortex

A personal AI executive assistant: calendar + tasks + projects + AI chat + proactive nudges + Discord notifications + learned tendencies.

See [docs/design/design-doc.md](docs/design/design-doc.md) for the full product design, and [AGENTS.md](AGENTS.md) for the working guide.

## Layout

```
cortex/
  frontend/     Next.js + TypeScript app (pages + components)
  backend/      Fastify + TypeScript server (Drizzle, Postgres, embeds Next.js)
  infra/        docker-compose, scripts
  docs/
    design/     design doc
    example/    original HTML/JSX design prototype (reference only)
```

The backend owns the HTTP server. Next.js is mounted inside Fastify via
`next.getRequestHandler()`, so pages, static assets, API routes, and websockets
all run on one port and one process.

## Quick start (docker)

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

Open http://localhost:9009.

## Quick start (local, no docker)

Requires Node.js 20+. The backend stores data in `backend/cortex.db` (SQLite)
unless `DATABASE_URL` is set.

```bash
cd frontend && npm install && cd -
cd backend  && npm install
npm run db:push            # apply schema
npm run dev                # Fastify + Next on :9009
```

Open http://localhost:9009.

## Seed / reset

The backend starts with an empty database by default. If you want the
CSE-grad-student demo that matches the design prototype, run:

```bash
cd backend && npm run seed:demo
```

## Phases

Working priorities (per `AGENTS.md`):

- **Phase 1 — foundation**: backend API, task system, calendar integration, dashboard UI.
- **Phase 2 — AI surface**: LLM planning, chat, Discord notifications.
- **Phase 3 — intelligence**: proactive assistant, memory system, advanced scheduling.

The AI roles (Planner, Monitor, Memory curator, Chat) are pluggable TypeScript
modules that return structured outputs. Pick a provider + model in the in-app
Settings; without credentials the stubs return deterministic demo responses so
the UI always works.
