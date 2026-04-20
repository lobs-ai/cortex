import React from "react";

export function Dot({ color }: { color?: string | null }) {
  return <span className={`dot-sm dot-${color || "gray"}`} />;
}

export function Chip({ kind, children }: { kind?: string; children: React.ReactNode }) {
  return <span className={`chip ${kind || ""}`}>{children}</span>;
}

export function PriorityChip({ p }: { p: "P0" | "P1" | "P2" }) {
  return <span className={`chip ${p === "P0" ? "p0" : p === "P1" ? "p1" : "p2"}`}>{p}</span>;
}

export function ProjectTag({
  projectId,
  projects,
}: {
  projectId: string | null;
  projects: { id: string; name: string; color: string }[];
}) {
  const p = projects.find((x) => x.id === projectId);
  if (!p) return <span className="caps muted-2">—</span>;
  return (
    <span className="row gap-2" style={{ fontSize: 11 }}>
      <Dot color={p.color} />
      <span className="truncate" style={{ maxWidth: 150 }}>{p.name}</span>
    </span>
  );
}
