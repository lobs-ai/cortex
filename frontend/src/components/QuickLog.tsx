"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type JournalEntry, type NearestEvent } from "@/lib/api";
import { Icon } from "./Icon";

type PostState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "posted"; entry: JournalEntry; nearest: NearestEvent }
  | { kind: "error"; message: string };

export function QuickLog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<PostState>({ kind: "idle" });
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const inField = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (!inField && e.key === "l" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const submit = useMutation({
    mutationFn: async (note: string) => {
      const entry = await api.journal.create({ kind: "quick_log", note });
      const nearest = await api.journal.nearestEvent(new Date(), 120).catch(() => null);
      return { entry, nearest };
    },
    onSuccess: ({ entry, nearest }) => {
      setState({ kind: "posted", entry, nearest });
      setText("");
      qc.invalidateQueries({ queryKey: ["journal"] });
    },
    onError: (err) => {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Failed to save" });
    },
  });

  const attach = useMutation({
    mutationFn: async ({ id, eventId }: { id: string; eventId: string | null }) => {
      return api.journal.patch(id, { eventId });
    },
    onSuccess: (entry) => {
      setState({ kind: "posted", entry, nearest: null });
      qc.invalidateQueries({ queryKey: ["journal"] });
    },
  });

  const onSend = () => {
    const note = text.trim();
    if (!note) return;
    setState({ kind: "pending" });
    submit.mutate(note);
  };

  const dismissPosted = () => {
    setState({ kind: "idle" });
    setOpen(false);
  };

  const posted = state.kind === "posted" ? state : null;
  const alreadyAttached = posted?.entry.eventId;
  const nearest = posted?.nearest;

  return (
    <>
      {!open && (
        <button
          className="quicklog-fab"
          title="Quick log (⇧⌘L)"
          onClick={() => setOpen(true)}
        >
          <Icon name="plus" size={14} />
          <span>log</span>
        </button>
      )}
      {open && (
        <div className="quicklog-panel">
          <div className="hd">
            <span className="caps">Quick log</span>
            <button className="btn ghost" onClick={() => setOpen(false)}>
              <Icon name="x" size={12} />
            </button>
          </div>
          <div className="bd">
            {state.kind !== "posted" && (
              <>
                <textarea
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      onSend();
                    }
                  }}
                  placeholder="What are you doing? How's it going?"
                  rows={3}
                  className="mono"
                />
                {state.kind === "error" && (
                  <div className="quicklog-error">{state.message}</div>
                )}
                <div className="quicklog-actions">
                  <span className="muted mono" style={{ fontSize: 10.5 }}>⌘↵ to send</span>
                  <button
                    className="btn primary"
                    disabled={!text.trim() || state.kind === "pending"}
                    onClick={onSend}
                  >
                    {state.kind === "pending" ? "Saving…" : "Log"}
                  </button>
                </div>
              </>
            )}
            {posted && (
              <div className="col" style={{ gap: 8 }}>
                <div style={{ fontSize: 12 }}>
                  Logged{alreadyAttached ? " and attached to event" : ""}.
                </div>
                {!alreadyAttached && nearest && (
                  <div className="col" style={{ gap: 6 }}>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {nearest.match === "happening"
                        ? "This is happening now:"
                        : nearest.match === "recent"
                          ? "Just ended:"
                          : "Coming up:"} {" "}
                      <b style={{ color: "var(--text)" }}>{nearest.title}</b>
                    </div>
                    <div className="row gap-2">
                      <button
                        className="btn"
                        disabled={attach.isPending}
                        onClick={() => attach.mutate({ id: posted.entry.id, eventId: nearest.id })}
                      >
                        Attach to this event
                      </button>
                      <button className="btn ghost" onClick={dismissPosted}>
                        Keep standalone
                      </button>
                    </div>
                  </div>
                )}
                {!alreadyAttached && !nearest && (
                  <div className="row gap-2">
                    <button className="btn primary" onClick={dismissPosted}>Done</button>
                  </div>
                )}
                {alreadyAttached && (
                  <div className="row gap-2">
                    <button className="btn primary" onClick={dismissPosted}>Done</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
