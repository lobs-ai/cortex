# Cortex

A personal AI executive assistant: calendar + tasks + projects + AI chat + proactive nudges + Discord notifications + learned tendencies.

See [docs/design/design-doc.md](docs/design/design-doc.md) for the full product design, and [AGENTS.md](AGENTS.md) for the working guide.

## Layout

```
cortex/
  frontend/     Next.js + TypeScript app
  backend/      FastAPI + SQLAlchemy app
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

- Frontend: http://localhost:3000
- Backend:  http://localhost:8000 (Swagger at `/docs`)

## Quick start (local, no docker)

Two terminals:

```bash
# terminal 1 — backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.seed          # seed demo data (SQLite default)
uvicorn app.main:app --reload
```

```bash
# terminal 2 — frontend
cd frontend
npm install
npm run dev
```

The backend defaults to SQLite (`backend/cortex.db`) when `DATABASE_URL` is unset, so no Postgres is required to run locally.

## Demo data

`python -m app.seed` loads the CSE-grad-student demo that matches the design prototype — NeurIPS rebuttal, advisor 1:1, EECS 598/484, etc. See `docs/example/` for the original design that this data is modeled on.

## Phases

Working priorities (per `AGENTS.md`):

- **Phase 1 — foundation**: backend API, task system, calendar integration, dashboard UI. ✓
- **Phase 2 — AI surface**: LLM planning, chat, Discord notifications.
- **Phase 3 — intelligence**: proactive assistant, memory system, advanced scheduling.

The AI roles (Planner, Monitor, Memory curator, Chat) are wired as pluggable stubs that return structured outputs. Swap in an LLM by implementing `backend/app/ai/client.py`.
