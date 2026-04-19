# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

A web-based personal AI executive assistant ("cortex"). Combines structured productivity tooling (calendar, tasks, projects, planning) with an embedded AI layer that chats, plans proactively, and learns user habits over time. Notifications go to the web app and Discord.

See `personal_ai_executive_assistant_design_doc.md` for the full design.

## Architecture at a glance

- **Frontend**: Next.js + React + TypeScript (dashboard, calendar, tasks, projects, chat, memory/settings).
- **Backend**: Node.js + TypeScript + Fastify, exposing REST + SSE/WebSocket updates.
- **ORM**: Drizzle (typed SQL, Postgres-first).
- **Workers**: BullMQ (Redis-backed) for sync, planning, monitoring, memory consolidation, notifications.
- **Data**: PostgreSQL (with pgvector), Redis.
- **Validation**: Zod schemas shared between backend and frontend.
- **Integrations**: Google Calendar, Discord, LLM provider(s).
- **Deployment**: Docker Compose (frontend, backend, worker, postgres, redis, proxy).

## AI layer

The AI is split into roles, not one mega-prompt:

- **Planner** — daily/weekly plans, scheduling, prioritization.
- **Monitor** — proactive checks, alert decisions.
- **Memory curator** — promotes stable preferences and learned tendencies from evidence.
- **Chat assistant** — answers questions, executes actions, explains reasoning.

Always assemble structured context from the DB, retrieve relevant memory, then call the role. Prefer structured (JSON) outputs over free text.

## Design principles

1. **Structured data first** — tasks, events, projects, preferences are first-class DB objects. AI reasons over them, not in place of them.
2. **AI assists decisions** — it proposes; the user (or trusted rules) decides. Default to suggest-and-confirm.
3. **UI remains usable without AI** — every core flow (create task, view calendar, plan manually) must work if the LLM is down or disabled.
4. **Proactive > reactive** — but gated by deterministic rules first, with cooldowns and dedup. No notification spam.
5. **User privacy is prioritized** — encrypt tokens at rest, minimize data sent to LLMs, and make memory inspectable, editable, and deletable.

## Development phases

Build in this order. Don't jump ahead.

- **Phase 1 — foundation**: backend API, task system, calendar integration, dashboard UI.
- **Phase 2 — AI surface**: LLM planning, chat interface, Discord notifications.
- **Phase 3 — intelligence**: proactive assistant, memory system, advanced scheduling.

The full design doc has a finer-grained breakdown (Phase 0–5); these three are the current working priorities.

## Success criteria

The system is working if it:

- helps the user plan their day
- reduces missed tasks
- proactively surfaces useful insights
- becomes the user's daily planning tool

When making tradeoffs, favor whichever option moves these forward.

## Working in this repo

- Implementation is in early/planning stage — the design doc is the source of truth for scope and structure.
- Stick to the current phase's scope unless the user asks otherwise.
- When adding code, mirror the suggested folder layout (`frontend/`, `backend/src/{routes,db,schemas,services,ai,jobs,integrations}`, `infra/`).

## Things to be careful with

- **Secrets & tokens**: OAuth tokens must be encrypted at rest. Never log them.
- **Proactive behavior**: any new trigger or notification path needs cooldown + dedup, not just "send when condition true."
- **Memory writes**: prefer conservative thresholds; the user must be able to view, edit, and delete anything the system learned.
- **Action permissions**: respect the read-only / suggest-and-confirm / auto-act tiers.
- **AI as dependency**: don't make core UI flows fail when the LLM is unavailable.
