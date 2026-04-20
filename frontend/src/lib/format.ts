export const fmtTime = (d: Date) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: false });

export const fmtHM = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export const fmtDateShort = (d: Date) =>
  d.toLocaleDateString([], { month: "short", day: "numeric" });

export const fmtWeekday = (d: Date) => d.toLocaleDateString([], { weekday: "short" });

export const fmtRelative = (date: Date | string | null) => {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = (+d - +new Date()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "now";
  if (abs < 3600) return Math.round(abs / 60) + "m " + (diff < 0 ? "ago" : "");
  if (abs < 86400) return Math.round(abs / 3600) + "h " + (diff < 0 ? "ago" : "");
  return Math.round(abs / 86400) + "d " + (diff < 0 ? "ago" : "");
};
