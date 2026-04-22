// Background worker cadences. Shared between the worker itself and the
// /api/status route so the UI's countdown stays in sync if we retune them.

export const MONITOR_INTERVAL_MS = 30 * 60 * 1000;
export const CALENDAR_INTERVAL_MS = 15 * 60 * 1000;
// Commitment state machine needs tight cadence — it's the "nag" in
// commit/nag/verify. Every minute is fine for a SQLite-backed single user.
export const COMMITMENT_INTERVAL_MS = 60 * 1000;
// Review runs once per evening; the tick just checks if we've already run
// one today and bails otherwise, so exact cadence doesn't matter.
export const DAILY_REVIEW_INTERVAL_MS = 10 * 60 * 1000;
