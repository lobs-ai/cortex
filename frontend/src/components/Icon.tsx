import React from "react";

export type IconName =
  | "dashboard" | "calendar" | "tasks" | "chat" | "memory" | "settings"
  | "bell" | "search" | "plus" | "check" | "x" | "chevL" | "chevR" | "chevD"
  | "clock" | "bolt" | "send" | "project" | "sparkles" | "github" | "discord"
  | "drag" | "sun" | "moon" | "archive";

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const PATHS: Record<IconName, React.ReactNode> = {
  dashboard: <g {...strokeProps}><rect x="3" y="3"  width="7" height="9"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="12" width="7" height="9"/></g>,
  calendar:  <g {...strokeProps}><rect x="3" y="5" width="18" height="16"/><path d="M3 9h18M8 3v4M16 3v4"/></g>,
  tasks:     <g {...strokeProps}><path d="M4 6h16M4 12h16M4 18h10"/></g>,
  chat:      <g {...strokeProps}><path d="M4 5h16v11H9l-5 4z"/></g>,
  memory:    <g {...strokeProps}><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M10 7V4M14 7V4M10 17v3M14 17v3M7 10H4M7 14H4M17 10h3M17 14h3"/></g>,
  settings:  <g {...strokeProps}><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/></g>,
  bell:      <g {...strokeProps}><path d="M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3z"/><path d="M10 20a2 2 0 0 0 4 0"/></g>,
  search:    <g {...strokeProps}><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></g>,
  plus:      <g {...strokeProps}><path d="M12 5v14M5 12h14"/></g>,
  check:     <g {...strokeProps}><path d="M5 12l4 4 10-10"/></g>,
  x:         <g {...strokeProps}><path d="M6 6l12 12M18 6L6 18"/></g>,
  chevL:     <g {...strokeProps}><path d="M15 6l-6 6 6 6"/></g>,
  chevR:     <g {...strokeProps}><path d="M9 6l6 6-6 6"/></g>,
  chevD:     <g {...strokeProps}><path d="M6 9l6 6 6-6"/></g>,
  clock:     <g {...strokeProps}><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></g>,
  bolt:      <g {...strokeProps}><path d="M13 3L5 13h6l-1 8 8-10h-6z"/></g>,
  send:      <g {...strokeProps}><path d="M4 20l17-8L4 4l3 8z"/><path d="M7 12h14"/></g>,
  project:   <g {...strokeProps}><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/></g>,
  sparkles:  <g {...strokeProps}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 3v4M21 5h-4"/></g>,
  github:    <g fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.12-1.47-1.12-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.04 1.53 1.04.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.5 9.5 0 0 1 12 6.8c.85 0 1.7.12 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></g>,
  discord:   <g fill="currentColor"><path d="M20 5.3A18 18 0 0 0 15.5 4l-.2.4c1.6.3 2.4.7 3.6 1.3A13.5 13.5 0 0 0 5.1 5.7c1.2-.6 2-1 3.6-1.3L8.5 4A18 18 0 0 0 4 5.3C1.5 9 .8 12.5 1.2 16c1.8 1.3 3.6 2.1 5.3 2.6.4-.5.8-1.1 1.1-1.7-.6-.2-1.2-.5-1.7-.9.1-.1.3-.2.4-.3 3.3 1.5 6.8 1.5 10.1 0 .1.1.3.2.4.3-.5.4-1.1.7-1.7.9.3.6.7 1.2 1.1 1.7 1.7-.5 3.5-1.3 5.3-2.6.5-4.1-.5-7.5-2.5-10.7zM8.6 14c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.8 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></g>,
  drag:      <g fill="currentColor"><circle cx="9" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="15" cy="18" r="1.2"/></g>,
  sun:       <g {...strokeProps}><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></g>,
  moon:      <g {...strokeProps}><path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/></g>,
  archive:   <g {...strokeProps}><rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8M10 12h4"/></g>,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {PATHS[name]}
    </svg>
  );
}
