import { rawDb } from "./client.js";

// Exported so the server can apply the schema at boot (idempotent — every
// statement is `IF NOT EXISTS`). Running this file directly via `npm run
// db:push` still works thanks to the side-effect call at the bottom.
export function applySchema(): void {
  rawDb.exec(DDL);
}

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Detroit',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  detail TEXT,
  last_synced_at INTEGER
);

CREATE TABLE IF NOT EXISTS integration_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  field TEXT NOT NULL,
  value_encrypted TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, provider, field)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT 'gray',
  status TEXT NOT NULL DEFAULT 'active',
  target_date INTEGER,
  health INTEGER NOT NULL DEFAULT 80,
  tasks_open INTEGER NOT NULL DEFAULT 0,
  tasks_done INTEGER NOT NULL DEFAULT 0,
  last_activity INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  external_id TEXT,
  provider TEXT,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Detroit',
  kind TEXT NOT NULL DEFAULT 'meeting',
  project_id TEXT,
  attendees_json TEXT,
  important INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date INTEGER,
  priority TEXT NOT NULL DEFAULT 'P2',
  status TEXT NOT NULL DEFAULT 'inbox',
  estimated_minutes INTEGER,
  actual_minutes INTEGER,
  project_id TEXT,
  recurrence_rule TEXT,
  energy_level TEXT NOT NULL DEFAULT 'med',
  tags_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  source_object_type TEXT,
  source_object_id TEXT,
  scheduled_for INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  channel TEXT NOT NULL DEFAULT 'web',
  content_json TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'low',
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  actions_json TEXT,
  delivery_channel TEXT NOT NULL DEFAULT 'web',
  delivered_at INTEGER,
  read_at INTEGER,
  dismissed_at INTEGER,
  related_object_type TEXT,
  related_object_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS preferences_explicit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tendencies_learned (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tendency_type TEXT NOT NULL,
  text TEXT NOT NULL,
  value_json TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'watching',
  last_observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  content TEXT NOT NULL,
  summary TEXT,
  metadata_json TEXT,
  salience REAL NOT NULL DEFAULT 0.5,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  generated_by TEXT NOT NULL DEFAULT 'planner',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  run_type TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  input_snapshot_json TEXT,
  output_json TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  tokens_in INTEGER,
  tokens_out INTEGER
);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  cards_json TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  project_id TEXT,
  cadence TEXT NOT NULL,
  cadence_detail TEXT,
  time_of_day TEXT,
  estimated_minutes INTEGER,
  priority TEXT NOT NULL DEFAULT 'P2',
  energy_level TEXT NOT NULL DEFAULT 'med',
  streak INTEGER NOT NULL DEFAULT 0,
  weekly_rate REAL NOT NULL DEFAULT 0,
  last_completed_at INTEGER,
  paused INTEGER NOT NULL DEFAULT 0,
  managed_by_ai INTEGER NOT NULL DEFAULT 0,
  suggested_by TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_suggestions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  cadence TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  evidence INTEGER NOT NULL DEFAULT 0,
  related_recurring_id TEXT,
  created_at INTEGER NOT NULL,
  dismissed_at INTEGER
);

CREATE TABLE IF NOT EXISTS provider_api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  key_encrypted TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_blocks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT,
  event_id TEXT,
  title TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  source TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_integration_configs_lookup ON integration_configs (user_id, provider, field);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks (user_id, status);
CREATE INDEX IF NOT EXISTS idx_events_user_start ON events (user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON assistant_messages (conversation_id, created_at);
`;

// Direct run: `npm run db:push` invokes this file via tsx, so do the apply.
// When imported by server.ts this block still runs at import time, which is
// what we want — boot-time schema apply.
applySchema();
console.log("schema applied");
