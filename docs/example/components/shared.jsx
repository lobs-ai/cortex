// Shared icons + small components. Global-scoped.

const Icon = ({ name, size = 16 }) => {
  const s = size;
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    dashboard: <g {...stroke}><rect x="3" y="3"  width="7" height="9"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="12" width="7" height="9"/></g>,
    calendar:  <g {...stroke}><rect x="3" y="5" width="18" height="16"/><path d="M3 9h18M8 3v4M16 3v4"/></g>,
    tasks:     <g {...stroke}><path d="M4 6h16M4 12h16M4 18h10"/></g>,
    chat:      <g {...stroke}><path d="M4 5h16v11H9l-5 4z"/></g>,
    memory:    <g {...stroke}><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></g>,
    settings:  <g {...stroke}><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></g>,
    bell:      <g {...stroke}><path d="M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3z"/><path d="M10 20a2 2 0 0 0 4 0"/></g>,
    search:    <g {...stroke}><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></g>,
    plus:      <g {...stroke}><path d="M12 5v14M5 12h14"/></g>,
    check:     <g {...stroke}><path d="M5 12l4 4 10-10"/></g>,
    x:         <g {...stroke}><path d="M6 6l12 12M18 6L6 18"/></g>,
    chevL:     <g {...stroke}><path d="M15 6l-6 6 6 6"/></g>,
    chevR:     <g {...stroke}><path d="M9 6l6 6-6 6"/></g>,
    chevD:     <g {...stroke}><path d="M6 9l6 6 6-6"/></g>,
    clock:     <g {...stroke}><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></g>,
    bolt:      <g {...stroke}><path d="M13 3L5 13h6l-1 8 8-10h-6z"/></g>,
    send:      <g {...stroke}><path d="M4 20l17-8L4 4l3 8z"/><path d="M7 12h14"/></g>,
    project:   <g {...stroke}><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/></g>,
    sparkles:  <g {...stroke}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 3v4M21 5h-4"/></g>,
    github:    <g fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.12-1.47-1.12-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.04 1.53 1.04.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.5 9.5 0 0 1 12 6.8c.85 0 1.7.12 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></g>,
    discord:   <g fill="currentColor"><path d="M20 5.3A18 18 0 0 0 15.5 4l-.2.4c1.6.3 2.4.7 3.6 1.3A13.5 13.5 0 0 0 5.1 5.7c1.2-.6 2-1 3.6-1.3L8.5 4A18 18 0 0 0 4 5.3C1.5 9 .8 12.5 1.2 16c1.8 1.3 3.6 2.1 5.3 2.6.4-.5.8-1.1 1.1-1.7-.6-.2-1.2-.5-1.7-.9.1-.1.3-.2.4-.3 3.3 1.5 6.8 1.5 10.1 0 .1.1.3.2.4.3-.5.4-1.1.7-1.7.9.3.6.7 1.2 1.1 1.7 1.7-.5 3.5-1.3 5.3-2.6.5-4.1-.5-7.5-2.5-10.7zM8.6 14c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.8 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></g>,
    drag:      <g fill="currentColor"><circle cx="9" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="15" cy="18" r="1.2"/></g>,
    sun:       <g {...stroke}><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></g>,
    moon:      <g {...stroke}><path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/></g>,
    archive:   <g {...stroke}><rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8M10 12h4"/></g>,
  };
  return <svg width={s} height={s} viewBox="0 0 24 24">{paths[name]}</svg>;
};

// Formatters
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: false });
const fmtHM = (d) => {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
};
const fmtDateShort = (d) => d.toLocaleDateString([], { month: "short", day: "numeric" });
const fmtWeekday = (d) => d.toLocaleDateString([], { weekday: "short" });
const fmtRelative = (date) => {
  const diff = (date - new Date()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "now";
  if (abs < 3600) return Math.round(abs / 60) + "m " + (diff < 0 ? "ago" : "");
  if (abs < 86400) return Math.round(abs / 3600) + "h " + (diff < 0 ? "ago" : "");
  return Math.round(abs / 86400) + "d " + (diff < 0 ? "ago" : "");
};
const projectById = (id) => (window.PROJECTS || []).find(p => p.id === id);
const taskById = (id) => (window.TASKS || []).find(t => t.id === id);
const eventById = (id) => (window.EVENTS || []).find(e => e.id === id);

const Dot = ({ color }) => <span className={`dot-sm dot-${color || "gray"}`}></span>;

const Chip = ({ kind, children }) => <span className={`chip ${kind || ""}`}>{children}</span>;

const PriorityChip = ({ p }) => <span className={`chip ${p === "P0" ? "p0" : p === "P1" ? "p1" : "p2"}`}>{p}</span>;

const ProjectTag = ({ id }) => {
  const p = projectById(id);
  if (!p) return <span className="caps muted-2">—</span>;
  return <span className="row gap-2" style={{ fontSize: 11 }}><Dot color={p.color} /><span className="truncate" style={{ maxWidth: 150 }}>{p.name}</span></span>;
};

Object.assign(window, {
  Icon, fmtTime, fmtHM, fmtDateShort, fmtWeekday, fmtRelative,
  projectById, taskById, eventById,
  Dot, Chip, PriorityChip, ProjectTag
});
