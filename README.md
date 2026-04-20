# Cortex

A personal AI executive assistant: calendar + tasks + projects + AI chat + proactive nudges + Discord notifications + learned tendencies.

See [docs/design/design-doc.md](docs/design/design-doc.md) for the full product design, and [AGENTS.md](AGENTS.md) for the working guide.

## Layout

```
cortex/
  frontend/     Next.js + TypeScript app
  backend/      Fastify + TypeScript API (Drizzle + Postgres)
  infra/        docker-compose, nginx, scripts
  docs/
    design/     design doc
    example/    original HTML/JSX design prototype (reference only)
```

## Quick start (docker)

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

- Frontend: http://localhost (via nginx) or http://localhost:3030 direct
- Backend:  http://localhost:9009

## Quick start (local, no docker)

Requires Node.js 20+ and a running Postgres (or use the SQLite dev fallback by leaving `DATABASE_URL` unset — the backend will store data in `backend/cortex.db`).

Two terminals:

```bash
# terminal 1 — backend
cd backend
npm install
npm run db:push         # apply schema
npm run seed            # seed demo data
npm run dev             # Fastify on :9009
```

```bash
# terminal 2 — frontend
cd frontend
npm install
npm run dev             # Next.js on :3030
```

## Demo data

`npm run seed` (in `backend/`) loads the CSE-grad-student demo that matches the design prototype — NeurIPS rebuttal, advisor 1:1, EECS 598/484, etc. See `docs/example/` for the original design that this data is modeled on.

## Phases

Working priorities (per `AGENTS.md`):

- **Phase 1 — foundation**: backend API, task system, calendar integration, dashboard UI.
- **Phase 2 — AI surface**: LLM planning, chat, Discord notifications.
- **Phase 3 — intelligence**: proactive assistant, memory system, advanced scheduling.

The AI roles (Planner, Monitor, Memory curator, Chat) are wired as pluggable TypeScript modules that return structured outputs. Swap in an LLM by configuring `ANTHROPIC_API_KEY` — with no key, the stubs return deterministic demo responses so the UI always works.
