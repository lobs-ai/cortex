import {
  sqliteTable,
  text,
  integer,
  real,
} from "drizzle-orm/sqlite-core";

// Single-user dev default. All rows still carry user_id for forward-compat.

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Detroit"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const integrations = sqliteTable("integrations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  status: text("status").notNull().default("available"),
  detail: text("detail"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
});

// Per-user, per-provider key/value config. Holds OAuth client IDs, API keys,
// PATs, bot tokens, etc. Values are AES-GCM encrypted.
export const integrationConfigs = sqliteTable("integration_configs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  field: text("field").notNull(),
  valueEncrypted: text("value_encrypted").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("gray"),
  status: text("status").notNull().default("active"),
  targetDate: integer("target_date", { mode: "timestamp_ms" }),
  health: integer("health").notNull().default(80),
  tasksOpen: integer("tasks_open").notNull().default(0),
  tasksDone: integer("tasks_done").notNull().default(0),
  lastActivity: integer("last_activity", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  externalId: text("external_id"),
  provider: text("provider"),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  startTime: integer("start_time", { mode: "timestamp_ms" }).notNull(),
  endTime: integer("end_time", { mode: "timestamp_ms" }).notNull(),
  timezone: text("timezone").notNull().default("America/Detroit"),
  kind: text("kind").notNull().default("meeting"),
  projectId: text("project_id"),
  attendeesJson: text("attendees_json"),
  rsvpStatus: text("rsvp_status"), // "needsAction" | "accepted" | "declined" | "tentative"
  accessRole: text("access_role"), // "owner" | "writer" | "reader" | "freeBusyReader" (null = Cortex-created)
  important: integer("important", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("confirmed"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: integer("due_date", { mode: "timestamp_ms" }),
  priority: text("priority").notNull().default("P2"),
  status: text("status").notNull().default("inbox"),
  estimatedMinutes: integer("estimated_minutes"),
  actualMinutes: integer("actual_minutes"),
  projectId: text("project_id"),
  recurrenceRule: text("recurrence_rule"),
  energyLevel: text("energy_level").notNull().default("med"),
  tagsJson: text("tags_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

export const reminders = sqliteTable("reminders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  sourceObjectType: text("source_object_type"),
  sourceObjectId: text("source_object_id"),
  scheduledFor: integer("scheduled_for", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull().default("pending"),
  channel: text("channel").notNull().default("web"),
  contentJson: text("content_json"),
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  category: text("category").notNull(),
  severity: text("severity").notNull().default("low"),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  actionsJson: text("actions_json"),
  deliveryChannel: text("delivery_channel").notNull().default("web"),
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
  dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" }),
  relatedObjectType: text("related_object_type"),
  relatedObjectId: text("related_object_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const preferencesExplicit = sqliteTable("preferences_explicit", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  key: text("key").notNull(),
  valueJson: text("value_json").notNull(),
  source: text("source").notNull().default("user"),
  confidence: real("confidence").notNull().default(1.0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const tendenciesLearned = sqliteTable("tendencies_learned", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tendencyType: text("tendency_type").notNull(),
  text: text("text").notNull(),
  valueJson: text("value_json"),
  evidenceCount: integer("evidence_count").notNull().default(1),
  confidence: real("confidence").notNull().default(0.5),
  status: text("status").notNull().default("watching"),
  lastObservedAt: integer("last_observed_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const memoryItems = sqliteTable("memory_items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  memoryType: text("memory_type").notNull(),
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  content: text("content").notNull(),
  summary: text("summary"),
  metadataJson: text("metadata_json"),
  salience: real("salience").notNull().default(0.5),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  planType: text("plan_type").notNull(),
  periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
  periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
  contentJson: text("content_json").notNull(),
  generatedBy: text("generated_by").notNull().default("planner"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const assistantRuns = sqliteTable("assistant_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  runType: text("run_type").notNull(),
  triggerType: text("trigger_type").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  inputSnapshotJson: text("input_snapshot_json"),
  outputJson: text("output_json"),
  status: text("status").notNull().default("running"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
});

export const assistantMessages = sqliteTable("assistant_messages", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  cardsJson: text("cards_json"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const recurringTasks = sqliteTable("recurring_tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  projectId: text("project_id"),
  cadence: text("cadence").notNull(), // "daily" | "weekdays" | "weekly" | "custom"
  cadenceDetail: text("cadence_detail"), // human-readable extension ("Mon/Wed/Fri", RRULE string)
  timeOfDay: text("time_of_day"), // "HH:MM"
  estimatedMinutes: integer("estimated_minutes"),
  priority: text("priority").notNull().default("P2"),
  energyLevel: text("energy_level").notNull().default("med"),
  streak: integer("streak").notNull().default(0),
  weeklyRate: real("weekly_rate").notNull().default(0),
  lastCompletedAt: integer("last_completed_at", { mode: "timestamp_ms" }),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  managedByAi: integer("managed_by_ai", { mode: "boolean" }).notNull().default(false),
  suggestedBy: text("suggested_by"),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const recurringSuggestions = sqliteTable("recurring_suggestions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(), // "create" | "adjust" | "pause"
  title: text("title").notNull(),
  body: text("body").notNull(),
  cadence: text("cadence"),
  confidence: real("confidence").notNull().default(0.5),
  evidence: integer("evidence").notNull().default(0),
  relatedRecurringId: text("related_recurring_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" }),
});

export const providerApiKeys = sqliteTable("provider_api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  label: text("label").notNull(),
  keyEncrypted: text("key_encrypted").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const journalEntries = sqliteTable("journal_entries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  eventId: text("event_id"),
  kind: text("kind").notNull(), // "reflection" | "quick_log"
  rating: integer("rating"), // 1-5, null for quick_log
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Memory of tasks the agent proactively created. Lets the proposer avoid
// re-creating the same task even after the user completes or deletes it.
export const agentProposals = sqliteTable("agent_proposals", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sourceKey: text("source_key").notNull(),
  taskId: text("task_id"),
  reason: text("reason").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const scheduledBlocks = sqliteTable("scheduled_blocks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  taskId: text("task_id"),
  eventId: text("event_id"),
  title: text("title").notNull(),
  startTime: integer("start_time", { mode: "timestamp_ms" }).notNull(),
  endTime: integer("end_time", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull().default("proposed"),
  source: text("source").notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
