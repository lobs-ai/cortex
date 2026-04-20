// Background worker cadences. Shared between the worker itself and the
// /api/status route so the UI's countdown stays in sync if we retune them.

export const MONITOR_INTERVAL_MS = 30 * 60 * 1000;
export const CALENDAR_INTERVAL_MS = 15 * 60 * 1000;
