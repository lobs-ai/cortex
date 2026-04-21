import { describe, it, expect } from "vitest";
import { extractJson } from "../src/ai/jsonExtract.js";

describe("extractJson", () => {
  it("parses clean JSON", () => {
    const r = extractJson(`{"a": 1, "b": [2, 3]}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1, b: [2, 3] });
    if (r.ok) expect(r.repaired).toBe(false);
  });

  it("parses JSON surrounded by prose", () => {
    const r = extractJson(`Here's the plan:\n{"summary": "ok", "blocks": []}\n\nThanks!`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ summary: "ok", blocks: [] });
  });

  it("strips code fences", () => {
    const r = extractJson("```json\n{\"x\": 1}\n```");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ x: 1 });
  });

  it("repairs trailing commas", () => {
    const r = extractJson(`{"a": [1, 2, 3,], "b": {"c": 4,},}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: [1, 2, 3], b: { c: 4 } });
    if (r.ok) expect(r.repaired).toBe(true);
  });

  it("repairs // comments", () => {
    const r = extractJson(`{"a": 1, // comment here\n  "b": 2}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1, b: 2 });
  });

  it("repairs Python literals", () => {
    const r = extractJson(`{"a": None, "b": True, "c": False}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: null, b: true, c: false });
  });

  it("slices only the first complete object, ignoring trailing `}` in prose", () => {
    const r = extractJson(`{"blocks": [{"start":"09:00"}]} and the model said }`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ blocks: [{ start: "09:00" }] });
  });

  it("handles braces inside strings", () => {
    const r = extractJson(`{"label": "study }{ stuff", "n": 1}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ label: "study }{ stuff", n: 1 });
  });

  it("reports error when truly unparseable", () => {
    const r = extractJson(`this is not json at all`);
    expect(r.ok).toBe(false);
  });
});
