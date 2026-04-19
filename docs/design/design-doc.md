# Personal AI Executive Assistant — Full Design Document

## 1. Overview

### 1.1 Product summary
Build a **web-based personal AI executive assistant** with a modern frontend, a backend deployed in Docker, and a proactive AI orchestration layer. The assistant should help manage:

- calendar
- tasks / todo lists
- weekly and daily planning
- scheduling and rescheduling
- reminders and nudges
- projects and priorities
- habits, tendencies, and preferences over time
- direct chat with an LLM that knows relevant context about the user
- Discord push notifications and interactions

This is **not** just a chatbot. It is a structured productivity system with an embedded AI layer that can:

- understand the user’s current commitments
- proactively inspect their data on a schedule
- notify them about important situations
- learn their habits and preferences over time
- improve its planning and suggestions gradually

---

## 2. Goals

### 2.1 Core goals
1. Provide a powerful web UI for calendar, tasks, projects, planning, and AI chat.
2. Let the assistant proactively monitor the user’s life data and suggest or trigger actions.
3. Let the user communicate with the assistant naturally via chat.
4. Support Discord notifications and optionally lightweight Discord commands/interactions.
5. Store structured long-term memory and user tendencies so the assistant improves over time.
6. Run the backend cleanly in Docker.
7. Be extensible so more data sources and agents can be added later.

### 2.2 Product principles
- **Structured-first**: tasks, events, projects, reminders, and user preferences should be first-class objects.
- **AI as reasoning layer**: LLMs should reason over structured data, not replace it.
- **Proactive by design**: the assistant should initiate useful interventions.
- **Human-in-control**: the assistant should suggest and confirm major actions unless explicitly permitted to automate.
- **Memory with evidence**: learning about the user should be based on repeated observations, not one-off guesses.
- **Powerful but understandable UI**: the system should feel like a control center, not a black box.

---

## 3. Non-goals for V1

- Full email ingestion and autonomous email replies
- Full browser/computer control
- Mobile app
- Multi-user collaboration
- Complex autonomous purchasing or finance actions
- Full enterprise-grade multi-tenant infrastructure beyond reasonable foundations

These can be added later.

---

## 4. High-level product vision

The user opens the website and sees:

- a **Today dashboard**
- upcoming events
- top tasks and deadlines
- suggested schedule for the day
- AI-generated priorities
- recent proactive alerts
- a chat panel with the assistant
- project status summaries

The assistant can:

- suggest a daily plan every morning
- notice overloaded days and propose rescheduling
- detect neglected tasks or projects
- remind about deadlines, meetings, prep work, and follow-ups
- recommend focus blocks
- learn preferred work times and behavior patterns
- send helpful Discord notifications instead of relying only on the website

---

## 5. Core features

### 5.1 Calendar management
- Sync with Google Calendar first
- Display events in calendar views
- Create / update / delete events
- Suggest scheduling times for tasks or meetings
- Detect free time blocks
- Detect overloaded or fragmented days
- Suggest focus blocks
- Suggest prep blocks before important meetings/events

### 5.2 Task and todo management
- Native task management UI
- Optional external task integrations later
- Task fields:
  - title
  - description
  - due date
  - priority
  - status
  - estimated duration
  - project
  - tags
  - recurrence
  - energy level / difficulty
- AI-generated prioritization
- Suggested scheduling into calendar blocks
- Nudges for stale or neglected tasks

### 5.3 Projects
- Group tasks into projects
- Show project health
- Track progress over time
- Detect abandoned projects
- Summarize project status in AI chat and dashboards

### 5.4 Daily and weekly planning
- Generate a daily plan every morning
- Generate a weekly planning summary on Sundays or Mondays
- Recommend task placement into free calendar windows
- Detect conflicts between goals and actual time usage

### 5.5 Proactive assistance
- Regular background evaluations of user state
- Detect notable situations and produce:
  - notifications
  - suggestions
  - automatic draft plans
- Examples:
  - “You have a meeting in 2 hours and no prep block.”
  - “You have three overdue tasks and no focus blocks today.”
  - “You tend to do best on deep work between 10am and 1pm; I reserved a block there.”
  - “This project has been neglected for 8 days.”

### 5.6 Chat with the assistant
- A chat interface in the website
- Assistant has access to relevant structured data and user memory
- Can answer questions like:
  - “What should I do today?”
  - “When can I fit a 2-hour research block?”
  - “What am I behind on?”
  - “How has my week gone?”
- Can also take actions:
  - “Add a task”
  - “Move this meeting”
  - “Plan my afternoon”

### 5.7 Discord integration
- Push notifications to a Discord DM or private channel
- Optionally allow lightweight commands:
  - `/today`
  - `/tasks`
  - `/plan`
  - `/schedule-block`
- Notification categories:
  - reminders
  - schedule suggestions
  - daily plan
  - deadline warnings
  - meeting prep nudges
  - weekly review summaries

### 5.8 Memory and learning
- Learn tendencies over time
- Store explicit preferences and inferred patterns separately
- Example learned tendencies:
  - prefers deep work in morning
  - underestimates task duration by ~30%
  - often ignores low-priority reminders
  - works better with 90-minute focus blocks
- Use these patterns to improve planning and recommendations

---

## 6. User stories

### 6.1 Daily use
- As a user, I want to open the website and instantly understand what matters today.
- As a user, I want the assistant to propose a realistic day plan based on my calendar and tasks.
- As a user, I want to chat with the assistant to reorganize my day.

### 6.2 Planning
- As a user, I want the assistant to suggest where to place tasks in my schedule.
- As a user, I want the assistant to tell me when I am overcommitted.
- As a user, I want weekly planning suggestions.

### 6.3 Proactive behavior
- As a user, I want useful nudges without needing to ask.
- As a user, I want Discord notifications for important items.
- As a user, I want the assistant to get more personalized over time.

### 6.4 Trust and control
- As a user, I want to see why the assistant made a suggestion.
- As a user, I want to configure what it can do automatically.
- As a user, I want to review and edit memory or preferences.

---

## 7. System architecture

## 7.1 High-level architecture

```text
Frontend (Web App)
  ├── Dashboard UI
  ├── Calendar UI
  ├── Tasks UI
  ├── Projects UI
  ├── Chat UI
  └── Settings / Memory UI

Backend API
  ├── Auth + user management
  ├── Calendar service
  ├── Task service
  ├── Project service
  ├── Scheduling engine
  ├── Notification service
  ├── Memory service
  ├── AI orchestration service
  ├── Chat service
  └── Discord integration service

Data / infra
  ├── PostgreSQL
  ├── Redis
  ├── Vector store (pgvector or similar)
  ├── Background job queue
  ├── LLM provider(s)
  └── External integrations (Google Calendar, Discord)
```

---

## 8. Frontend design

## 8.1 Tech stack
- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui or equivalent component library
- Zustand or Redux Toolkit for local state as needed
- React Query / TanStack Query for API state
- FullCalendar or custom calendar components
- WebSocket / SSE for live assistant updates

## 8.2 Main pages

### Dashboard
Main “control center.”

Sections:
- Today timeline
- upcoming events
- top tasks
- suggested plan
- alerts and nudges
- project health summaries
- quick add widgets
- assistant sidebar or docked chat

### Calendar
- day/week/month views
- task overlays / suggested schedule blocks
- drag-and-drop scheduling
- AI suggestions shown inline

### Tasks
- inbox
- today
- upcoming
- by project
- kanban/list views
- AI-generated prioritization and schedule recommendations

### Projects
- project summary cards
- progress and velocity
- active tasks
- neglected project alerts

### Chat
- full-screen or side panel chat
- context-aware replies
- supports action execution and follow-up confirmations
- shows linked data cards inside chat responses

### Memory / Preferences
- explicit preferences
- learned tendencies
- notification settings
- privacy controls
- integrations settings

## 8.3 UX principles
- Fast, dense, useful dashboards
- Clear explanation for assistant suggestions
- Strong visual hierarchy for urgency
- AI should appear embedded in the product, not detached from it
- Every AI suggestion should have actionable buttons like:
  - accept
  - modify
  - dismiss
  - don’t suggest this again

---

## 9. Backend design

## 9.1 Tech stack
- Python + FastAPI
- SQLAlchemy
- PostgreSQL
- Redis
- Celery, Dramatiq, or RQ for background jobs
- Docker for deployment
- Optional Nginx or Caddy reverse proxy

## 9.2 Services/modules

### Auth service
- session or JWT auth
- OAuth for Google integration
- user settings

### Calendar service
- sync Google Calendar events
- CRUD event operations
- conflict detection
- free/busy calculations

### Task service
- CRUD tasks
- recurring task logic
- tags, priorities, estimates
- status transitions

### Project service
- CRUD projects
- project metrics
- task aggregation

### Scheduling engine
- compute free calendar blocks
- place tasks into available time windows
- evaluate tradeoffs and conflicts
- respect user preferences and tendencies

### Notification service
- website alerts
- email optional later
- Discord DM/channel notifications
- deduplication and cooldowns

### Memory service
- explicit preferences
- long-term semantic memory
- learned tendencies
- memory retrieval for chat and proactive planning

### AI orchestration service
- periodic evaluations
- context assembly
- LLM calls
- recommendation generation
- action proposal generation
- memory updates

### Chat service
- handles chat sessions
- injects user context and relevant memory
- calls tools / actions
- returns structured UI-friendly assistant responses

### Discord integration service
- notification dispatch
- slash command handling (optional)
- mapping user account to Discord account

---

## 10. Data model

## 10.1 Core entities

### users
- id
- email
- name
- timezone
- created_at
- updated_at

### integrations
- id
- user_id
- provider
- access_token_encrypted
- refresh_token_encrypted
- status
- last_synced_at

### events
- id
- user_id
- external_id
- provider
- title
- description
- location
- start_time
- end_time
- timezone
- attendees_json
- status
- created_at
- updated_at

### tasks
- id
- user_id
- title
- description
- due_date
- priority
- status
- estimated_minutes
- actual_minutes
- project_id
- recurrence_rule
- energy_level
- created_at
- updated_at
- completed_at

### projects
- id
- user_id
- name
- description
- status
- target_date
- created_at
- updated_at

### reminders
- id
- user_id
- type
- source_object_type
- source_object_id
- scheduled_for
- status
- channel
- content_json

### notifications
- id
- user_id
- category
- title
- body
- severity
- delivery_channel
- delivered_at
- read_at
- related_object_type
- related_object_id

### preferences_explicit
- id
- user_id
- key
- value_json
- source
- confidence
- created_at
- updated_at

### tendencies_learned
- id
- user_id
- tendency_type
- value_json
- evidence_count
- confidence
- last_observed_at
- created_at
- updated_at

### memory_items
- id
- user_id
- memory_type
- source_type
- source_id
- content
- summary
- metadata_json
- embedding
- salience
- created_at
- updated_at

### plans
- id
- user_id
- plan_type
- period_start
- period_end
- content_json
- generated_by
- created_at

### assistant_runs
- id
- user_id
- run_type
- trigger_type
- started_at
- finished_at
- input_snapshot_json
- output_json
- status

### assistant_messages
- id
- user_id
- conversation_id
- role
- content
- metadata_json
- created_at

### scheduled_blocks
- id
- user_id
- task_id
- event_id_nullable
- start_time
- end_time
- status
- source

---

## 11. AI system design

## 11.1 AI roles
The AI system should be split into logical roles rather than a single opaque prompt.

### Planner
Responsible for:
- daily planning
- weekly planning
- scheduling suggestions
- task prioritization

### Monitor
Responsible for:
- checking for important changes or risk states
- generating proactive alerts
- deciding whether to notify user

### Memory curator
Responsible for:
- extracting stable preferences from repeated observations
- creating semantic memory summaries
- updating learned tendencies

### Chat assistant
Responsible for:
- answering questions
- executing actions
- explaining reasoning
- retrieving memories and current state

These can all use the same LLM initially, but should be separated at the orchestration layer.

## 11.2 LLM prompting strategy
The system should not rely on one massive prompt.

Instead:
1. Assemble structured context from the database.
2. Retrieve relevant memories and tendencies.
3. Add the current user request or proactive trigger.
4. Call the proper AI role.
5. Return structured output.

### Example structured context for planning
```json
{
  "date": "2026-04-20",
  "calendar": [...],
  "free_blocks": [...],
  "tasks": [...],
  "projects": [...],
  "explicit_preferences": [...],
  "learned_tendencies": [...]
}
```

## 11.3 Structured outputs
Each AI response should be machine-readable.

Example planning output:
```json
{
  "summary": "Today is meeting-heavy, so prioritize one deep-work task.",
  "recommended_blocks": [
    {
      "task_id": "123",
      "start": "2026-04-20T11:00:00",
      "end": "2026-04-20T12:30:00",
      "reason": "This is your highest-focus block."
    }
  ],
  "alerts": [
    {
      "type": "deadline_risk",
      "task_id": "456",
      "message": "This task is due tomorrow and still estimated at 3h."
    }
  ]
}
```

---

## 12. Proactive orchestration design

## 12.1 Core idea
The assistant should run proactively in the background, not only when the user opens chat.

## 12.2 Trigger types

### Time-based triggers
- every morning at user-configured time
- hourly during active hours
- evening review time
- weekly planning trigger

### Event-based triggers
- calendar changed
- task created or completed
- task overdue
- meeting approaching
- important project neglected

### State-based triggers
- overloaded day detected
- no focus blocks for high-priority work
- approaching deadline risk
- unusual inactivity on active project
- repeated scheduling pattern violation

## 12.3 Proactive loop
```text
Trigger occurs
   ↓
Fetch fresh user state
   ↓
Run rule-based detectors
   ↓
If notable state exists, call Monitor/Planner LLM
   ↓
Generate suggested actions / message
   ↓
Decide delivery channel
   ↓
Send website alert and/or Discord notification
   ↓
Log outcome and user response
```

## 12.4 Rules before LLM
To reduce cost and noise, use deterministic rules first.

Examples:
- if task due within 24h and unscheduled and estimated > free time → flag deadline risk
- if meeting within 2h and no prep block exists and meeting marked important → flag prep reminder
- if 3 overdue tasks exist → flag backlog problem
- if no open focus block exists in next 2 days for a high-priority task → flag scheduling issue

Only then invoke the LLM to produce human-friendly reasoning and suggestions.

## 12.5 Notification policy
Every proactive event should include:
- importance score
- urgency
- confidence
- cooldown rules
- preferred delivery channel

The system must avoid spam.

---

## 13. Discord integration design

## 13.1 Notification modes
- Direct Message to user
- private server channel (optional)

## 13.2 Notification types
- daily agenda
- task reminders
- deadline alerts
- meeting prep reminders
- suggested changes to schedule
- weekly review

## 13.3 Interaction model
Minimal V1:
- send messages with buttons/links back to web app

Better V2:
- slash commands
- approve/dismiss suggested schedule changes
- quick add task from Discord
- ask simple questions from Discord

## 13.4 Example Discord messages

### Daily plan
```text
Good morning.

Today’s priorities:
1. Finish RL replay parser
2. Prepare for 3pm meeting
3. Review PR #82

Best focus block:
11:00–12:30
```

### Deadline alert
```text
You have a task due tomorrow that still needs ~3 hours.
Suggested move: reserve 4:00–5:30pm today.
```

---

## 14. Memory and learning design

## 14.1 Types of memory

### Explicit preferences
Directly provided by user.
Examples:
- prefers mornings for deep work
- doesn’t want notifications after 10pm
- likes tasks scheduled in 90-minute blocks

### Episodic memory
Past assistant interactions and notable events.
Examples:
- user moved a suggested block from afternoon to morning
- user repeatedly postponed tasks on Fridays

### Semantic memory
Stable summaries about the user.
Examples:
- active projects
- recurring commitments
- common collaborators
- preferred work styles

### Learned tendencies
Inferred patterns from repeated behavior.
Examples:
- generally underestimates task length
- does best with 60–90 minute blocks
- tends to skip low-priority admin tasks

## 14.2 Learning policy
Only promote a tendency after repeated evidence.

Example threshold:
- at least 3 similar observations over 14+ days
- confidence score above threshold

## 14.3 Memory editing
User must be able to:
- view learned tendencies
- delete memories
- mark a tendency as wrong
- promote a preference to explicit

## 14.4 Memory retrieval for chat
For each chat request, retrieve:
- current relevant state
- recent plans
- active projects
- top tendencies relevant to the question
- prior related assistant interactions

---

## 15. Scheduling engine design

## 15.1 Inputs
- calendar events
- tasks
- due dates
- estimated durations
- user preferences
- learned tendencies
- constraints like work hours, buffers, travel, energy

## 15.2 Outputs
- recommended task ordering
- recommended schedule blocks
- conflict warnings
- rescheduling suggestions

## 15.3 Basic algorithm for V1
1. Compute free calendar windows.
2. Rank tasks by urgency, importance, and fit.
3. Score each task-window pair.
4. Place tasks greedily or with simple optimization.
5. Send suggestions for user approval.

## 15.4 Scoring dimensions
- urgency
- project importance
- duration fit
- energy fit
- tendency match
- proximity to deadline
- context switching penalty
- buffer requirements

## 15.5 Future upgrade
Use optimization or constraint solving for better scheduling.

---

## 16. Chat system design

## 16.1 Chat capabilities
- answer questions about schedule, tasks, and projects
- create/update/delete tasks and events
- explain suggestions
- summarize progress
- give daily and weekly planning guidance

## 16.2 Chat UX requirements
- rich responses with cards
- inline actions
- show source objects referenced
- support follow-up clarification
- allow quick acceptance of suggestions

## 16.3 Example flows

### User asks for plan
User: “Plan my afternoon.”

Assistant:
- fetches afternoon calendar windows
- fetches outstanding tasks
- consults tendencies
- proposes plan
- offers buttons to schedule blocks

### User asks for status
User: “What am I behind on?”

Assistant:
- checks overdue tasks
- checks neglected projects
- checks deadline risk
- responds with summary and recommended actions

---

## 17. APIs

## 17.1 REST endpoints (illustrative)

### auth
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

### tasks
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/{id}`
- `DELETE /api/tasks/{id}`

### projects
- `GET /api/projects`
- `POST /api/projects`
- `PATCH /api/projects/{id}`

### calendar
- `GET /api/events`
- `POST /api/events`
- `PATCH /api/events/{id}`
- `DELETE /api/events/{id}`
- `POST /api/calendar/sync`

### planning
- `GET /api/plans/today`
- `GET /api/plans/week`
- `POST /api/plans/generate`
- `POST /api/schedule/suggest`
- `POST /api/schedule/apply`

### chat
- `POST /api/chat`
- `GET /api/chat/conversations`
- `GET /api/chat/conversations/{id}`

### memory
- `GET /api/memory/preferences`
- `GET /api/memory/tendencies`
- `PATCH /api/memory/tendencies/{id}`
- `DELETE /api/memory/items/{id}`

### notifications
- `GET /api/notifications`
- `POST /api/notifications/test-discord`

### integrations
- `POST /api/integrations/google/connect`
- `POST /api/integrations/discord/connect`

## 17.2 Real-time updates
Use WebSockets or Server-Sent Events for:
- notification updates
- live assistant progress
- sync status
- new planning suggestions

---

## 18. Background jobs

## 18.1 Needed jobs
- calendar sync job
- daily planning job
- weekly review job
- proactive monitoring job
- memory consolidation job
- notification dispatch job
- Discord delivery job
- tendency update job

## 18.2 Example schedules
- calendar sync: every 5–15 minutes or webhook-driven
- proactive monitor: every 30–60 minutes
- daily plan: each morning
- weekly review: Sunday evening
- memory consolidation: nightly

---

## 19. Docker deployment design

## 19.1 Containers

### frontend container
- Next.js app

### backend container
- FastAPI app

### worker container
- background jobs

### db container
- PostgreSQL

### redis container
- Redis

### reverse proxy container
- Nginx or Caddy

## 19.2 Docker Compose example architecture
```text
services:
  frontend
  backend
  worker
  postgres
  redis
  proxy
```

## 19.3 Environment variables
- database URL
- redis URL
- JWT secret
- encryption key
- Google OAuth client/secret
- Discord bot token
- LLM provider keys
- vector DB settings if separate

## 19.4 Persistence
- PostgreSQL volume
- optional file storage volume
- logs volume if needed

---

## 20. Security and privacy

## 20.1 Sensitive data
- OAuth tokens
- user calendar data
- user tasks and private plans
- learned behavioral tendencies
- chat history

## 20.2 Requirements
- encrypt integration tokens at rest
- use HTTPS in production
- principle of least privilege for integrations
- audit log for assistant-initiated actions
- explicit settings for proactive behavior
- visible memory editing controls

## 20.3 Action safety model
Define permission levels:

### Read-only
- inspect data
- answer questions
- suggest actions

### Suggest-and-confirm
- create schedule drafts
- propose event changes
- propose task movements

### Auto-act
- only for user-approved trusted categories
- example: send daily Discord summary automatically

---

## 21. Analytics and feedback loops

## 21.1 Product analytics
Track:
- suggestion acceptance rate
- notification open rate
- chat usage
- daily planner usage
- reschedule frequency
- number of tasks completed after assistant suggestion

## 21.2 Learning analytics
Track:
- confidence of learned tendencies
- false positives / dismissed suggestions
- notification fatigue indicators
- planning effectiveness

## 21.3 UX feedback controls
For each assistant suggestion allow:
- useful
- not useful
- too obvious
- wrong timing
- wrong assumption

This data improves personalization.

---

## 22. MVP scope

## 22.1 V1 features
- user auth
- Google Calendar sync
- native task/project management
- dashboard
- chat assistant
- daily plan generation
- proactive monitoring for key conditions
- Discord notifications
- explicit preferences
- basic learned tendencies
- Dockerized backend deployment

## 22.2 V1 proactive scenarios
- morning daily plan
- deadline risk alert
- meeting prep reminder
- neglected project reminder
- no focus block available warning

## 22.3 V1 chat actions
- create task
- update task
- create event
- suggest schedule block
- summarize day/week

---

## 23. V2 ideas
- email metadata integration
- Slack/Discord input as task capture
- meeting preparation summaries
- habit tracking
- richer memory graph
- better scheduling optimization
- task duration estimation model
- natural language rules for assistant behavior
- mobile-responsive progressive web app improvements

---

## 24. Suggested folder / repo structure

```text
assistant-app/
  frontend/
    app/
    components/
    lib/
    hooks/
    styles/
  backend/
    app/
      api/
      models/
      schemas/
      services/
      ai/
      jobs/
      integrations/
      utils/
    migrations/
  infra/
    docker/
    nginx/
    scripts/
  docs/
    design/
    api/
  docker-compose.yml
  README.md
```

---

## 25. Recommended implementation phases

## Phase 0 — foundation
- finalize product scope
- define schemas
- set up repo structure
- set up Docker Compose
- set up auth

## Phase 1 — core data + UI
- tasks, projects, calendar data model
- dashboard UI
- calendar/task/project pages
- Google Calendar integration

## Phase 2 — AI chat + planning
- chat system
- planning service
- daily plan generation
- schedule suggestions

## Phase 3 — proactive assistant
- background monitor jobs
- rule detectors
- Discord notifications
- suggestion cards + approvals

## Phase 4 — memory + personalization
- explicit preferences UI
- learned tendencies pipeline
- memory retrieval in chat
- adaptive scheduling suggestions

## Phase 5 — refinement
- reduce notification noise
- better scoring and scheduling
- richer dashboards and analytics

---

## 26. Hardest technical problems

### 26.1 Proactive usefulness without spam
The biggest product risk is becoming noisy. The assistant must be selective.

### 26.2 Memory quality
Bad inferred tendencies will erode trust. Learning must be conservative.

### 26.3 Scheduling quality
Naive scheduling will feel robotic. Even V1 should respect user habits.

### 26.4 Context assembly for chat
The assistant should see the right information without becoming bloated or irrelevant.

### 26.5 Permissions and trust
Users need clarity on what the assistant can and cannot do automatically.

---

## 27. Design decisions summary

### We are building
- a structured productivity web app
- with embedded AI chat
- with proactive background intelligence
- with Discord notifications
- with memory and personalization
- with a backend running in Docker

### We are not building
- a raw chatbot wrapper
- an all-powerful autonomous desktop agent in V1
- a system that makes opaque, high-risk decisions without user control

---

## 28. Example end-to-end user experience

1. User connects Google Calendar and Discord.
2. User creates tasks and projects in the web app.
3. Each morning, the assistant generates a day plan.
4. The user gets a Discord summary and can open the website for details.
5. Throughout the day, background jobs detect risks and propose actions.
6. The user chats with the assistant to reorganize work.
7. Over time, the assistant learns patterns and improves its planning.
8. The user can inspect and edit what the assistant has learned.

---

## 29. Final product positioning
This system should feel like:

- a **personal operations dashboard**
- a **smart planner**
- a **task and calendar command center**
- a **persistent executive assistant**
- a **learning system that adapts to the user over time**

If executed well, it will be more useful than a generic AI chat tool because it combines:
- structured data
- proactive orchestration
- memory
- action-taking
- personalization

That combination is the real product.
