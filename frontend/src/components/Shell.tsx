"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { RightRail } from "./RightRail";
import { SettingsModal } from "./SettingsModal";

const TABS: { id: string; label: string; icon: IconName; k: string; path: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", k: "1", path: "/" },
  { id: "calendar",  label: "Calendar",  icon: "calendar",  k: "2", path: "/calendar" },
  { id: "tasks",     label: "Tasks",     icon: "tasks",     k: "3", path: "/tasks" },
  { id: "chat",      label: "Chat",      icon: "chat",      k: "4", path: "/chat" },
  { id: "memory",    label: "Memory",    icon: "memory",    k: "5", path: "/memory" },
];

const ACCENTS: Record<string, string> = {
  blue: "oklch(0.72 0.14 240)",
  green: "oklch(0.72 0.14 150)",
  amber: "oklch(0.78 0.14 75)",
  violet: "oklch(0.68 0.16 300)",
  red: "oklch(0.68 0.19 25)",
};

function activeTabFromPath(path: string) {
  if (path.startsWith("/calendar")) return "calendar";
  if (path.startsWith("/tasks")) return "tasks";
  if (path.startsWith("/chat")) return "chat";
  if (path.startsWith("/memory")) return "memory";
  return "dashboard";
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const tab = activeTabFromPath(pathname);

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [accent, setAccent] = useState("blue");
  const [showProactive, setShowProactive] = useState(true);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", ACCENTS[accent]);
  }, [accent]);

  useEffect(() => {
    setNow(new Date());
    const i = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const t = TABS.find((x) => x.k === e.key);
      if (t) {
        e.preventDefault();
        router.push(t.path);
      }
      if (e.key === "t" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setTheme((cur) => (cur === "dark" ? "light" : "dark"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const showRightRail = (tab === "dashboard" || tab === "calendar") && showProactive;

  return (
    <div className="app">
      <div className="rail">
        <div className="rail-logo" title="Cortex"></div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className="rail-tab"
            data-active={tab === t.id}
            onClick={() => router.push(t.path)}
            title={`${t.label} · ${t.k}`}
          >
            <Icon name={t.icon} size={18} />
            <span className="kbd">{t.k}</span>
          </button>
        ))}
        <div className="rail-spacer" />
        <button
          className="rail-tab"
          title="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
        </button>
        <button className="rail-tab" title="Tweaks" onClick={() => setTweaksOpen((v) => !v)}>
          <Icon name="bolt" size={16} />
        </button>
        <button
          className="rail-tab"
          title="Settings — AI provider & model"
          onClick={() => setSettingsOpen(true)}
        >
          <Icon name="settings" size={16} />
        </button>
      </div>

      <div className="main">
        <div className="topbar">
          <div className="left">
            <span><span className="dot" /><b>online</b> · cortex v0.3</span>
            <span>synced <span className="mono">3m ago</span></span>
            <span>next run <span className="mono">in 27m</span></span>
          </div>
          <div className="center mono">
            {now
              ? now.toLocaleString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })
              : ""}
          </div>
          <div className="right">
            <span className="row gap-2">
              <Icon name="github" size={13} />
              <Icon name="discord" size={13} />
              <span className="mono">3 integrations</span>
            </span>
            <span>⌘K</span>
            <span className="caps" style={{ color: "var(--text)" }}>Rafe S.</span>
          </div>
        </div>

        <div className={`page ${!showRightRail ? "no-rail" : ""}`}>
          <div className="canvas">{children}</div>
          {showRightRail && (
            <div className="right-rail">
              <RightRail />
            </div>
          )}
        </div>
      </div>

      {tweaksOpen && (
        <div className="tweaks-panel">
          <div className="hd">
            <span className="caps"><b style={{ color: "var(--text)" }}>Tweaks</b></span>
            <button className="btn ghost" onClick={() => setTweaksOpen(false)}>
              <Icon name="x" size={12} />
            </button>
          </div>
          <div className="bd">
            <div className="tweak-row">
              <span className="k">Theme</span>
              <div className="seg-mini">
                <button data-active={theme === "dark"} onClick={() => setTheme("dark")}>dark</button>
                <button data-active={theme === "light"} onClick={() => setTheme("light")}>light</button>
              </div>
            </div>
            <div className="tweak-row">
              <span className="k">Accent</span>
              <div className="swatch-row">
                {Object.keys(ACCENTS).map((a) => (
                  <button
                    key={a}
                    className="swatch"
                    data-active={accent === a}
                    style={{ background: ACCENTS[a] }}
                    onClick={() => setAccent(a)}
                  />
                ))}
              </div>
            </div>
            <div className="tweak-row">
              <span className="k">Proactive rail</span>
              <div className="seg-mini">
                <button data-active={showProactive} onClick={() => setShowProactive(true)}>on</button>
                <button data-active={!showProactive} onClick={() => setShowProactive(false)}>off</button>
              </div>
            </div>
            <div className="tweak-row">
              <span className="k">Shortcuts</span>
              <span className="mono muted-2" style={{ fontSize: 10.5 }}>1–5 nav · ⌘T theme</span>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
