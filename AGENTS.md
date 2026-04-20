# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

A web-based personal AI executive assistant ("cortex"). Combines structured productivity tooling (calendar, tasks, projects, planning) with an embedded AI layer that chats, plans proactively, and learns user habits over time. Notifications go to the web app and Discord.

See `personal_ai_executive_assistant_design_doc.md` for the full design.

## Architecture at a glance

- **Frontend**: Next.js + React + TypeScript (dashboard, calendar, tasks, projects, chat, memory/settings).
- **Backend**: Node.js + TypeScript + Fastify, exposing REST + SSE updates.
- **ORM**: Drizzle on SQLite (`better-sqlite3`, WAL mode). DB file is `backend/cortex.db`.
- **Workers**: Simple timer-based background worker (`backend/src/worker.ts`) — polls monitor every 30 min, syncs Google Calendar every 15 min. No Redis or BullMQ.
- **Validation**: Zod schemas on backend routes; shared types via frontend `lib/api.ts`.
- **Integrations**: Google (Calendar, Gmail, Drive via OAuth), Discord, LLM provider(s). See `docs/INTEGRATIONS.md`.
- **Deployment**: Docker Compose (frontend, backend, worker, proxy).

## AI layer

The AI is split into roles, not one mega-prompt:

- **Planner** — daily/weekly plans, scheduling, prioritization.
- **Monitor** — proactive checks, alert decisions.
- **Memory curator** — promotes stable preferences and learned tendencies from evidence.
- **Chat assistant** — answers questions, executes actions, explains reasoning. Lives in `backend/src/ai/chat.ts`; throws `ChatError` (not a fallback) when no provider or API key is configured.

Always assemble structured context from the DB, retrieve relevant memory, then call the role. Prefer structured (JSON) outputs over free text.

## Integrations architecture

### Config storage (`integrationConfigs`)

`backend/src/services/integrationConfigs.ts` + the `integration_configs` DB table store per-user, per-provider key/value pairs (OAuth client IDs, API keys, PATs, bot tokens). Values are **AES-256-GCM encrypted** at rest. Never return raw decrypted values from HTTP handlers — use `describeConfig()` which masks values.

Routes: `GET/PUT/DELETE /api/integrations/configs/:provider`. Known providers are whitelisted in `KNOWN_PROVIDERS`.

### Google OAuth

Full OAuth 2.0 flow in `backend/src/services/googleAuth.ts`. Uses three layers of DB rows:

- `provider = "google"` (master) — holds OAuth tokens + connected email.
- `provider = "google_calendar"`, `"gmail"`, `"google_drive"` — per-feature enable flags.

Connect once via `GET /api/integrations/google/connect` → OAuth callback enables all three features. Users can toggle features off individually. Disconnect via `POST /api/integrations/google/disconnect` revokes tokens and disables all features.

OAuth client credentials can come from user-supplied config (`integration_configs` for provider `"google"`) or fall back to `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` env vars.

### Google Calendar sync

`backend/src/services/googleCalendar.ts` syncs events to the local DB. Runs on the worker's 15-min tick and also fires immediately after OAuth callback. No-ops silently if `google_calendar` feature is disabled or tokens are missing.

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

- Phase 1 (foundation) is complete. Phase 2 (AI surface) is active — chat, integrations, Google Calendar sync, and the settings/integrations UI are in place.
- When adding code, mirror the folder layout: `frontend/src/{app,components,lib}`, `backend/src/{routes,db,services,ai,lib}`, `infra/`.
- Test files live in `backend/test/`. Run with `vitest`. Tests use an isolated SQLite file via `CORTEX_DB_PATH`.

## Things to be careful with

- **Secrets & tokens**: OAuth tokens and integration config values must be encrypted at rest via `encrypt()`/`decrypt()` in `backend/src/lib/crypto.ts`. Never log them or return raw values from HTTP handlers.
- **Config reads**: use `describeConfig()` (returns masked field metadata) for HTTP responses, never raw `getConfig()` output.
- **Proactive behavior**: any new trigger or notification path needs cooldown + dedup, not just "send when condition true."
- **Memory writes**: prefer conservative thresholds; the user must be able to view, edit, and delete anything the system learned.
- **Action permissions**: respect the read-only / suggest-and-confirm / auto-act tiers.
- **AI as dependency**: don't make core UI flows fail when the LLM is unavailable. `ChatError` should surface a user-friendly message, not a crash.
- **Google feature flags**: sync services for Calendar/Gmail/Drive must check `feature_disabled` before running — don't assume connected = active.
