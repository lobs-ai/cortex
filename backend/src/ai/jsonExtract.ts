// Tolerant JSON extractor for LLM output.
//
// Models (especially MiniMax/GLM/Kimi/DeepSeek) commonly emit near-JSON with
// trailing commas, code fences, `//` comments, smart quotes, and prose before
// or after the JSON block. Strict JSON.parse rejects all of these. This helper
// tries strict first, then applies a series of targeted repairs.
//
// Returns { value, repaired, raw } on success, or { error, raw } on failure.

export type ExtractResult<T> =
  | { ok: true; value: T; repaired: boolean; raw: string }
  | { ok: false; error: string; raw: string };

export function extractJson<T = unknown>(text: string): ExtractResult<T> {
  const raw = sliceJsonRegion(text);
  if (!raw) return { ok: false, error: "no JSON object found in output", raw: text };

  try {
    return { ok: true, value: JSON.parse(raw) as T, repaired: false, raw };
  } catch {
    // fall through to repair
  }

  const repaired = repairJson(raw);
  try {
    return { ok: true, value: JSON.parse(repaired) as T, repaired: true, raw: repaired };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, raw };
  }
}

// Find the substring between the first `{` and its matching `}` at brace
// depth 0, skipping braces inside string literals. This is more robust than
// `indexOf("{") … lastIndexOf("}")` which includes any stray `}` in trailing
// prose.
function sliceJsonRegion(text: string): string | null {
  const stripped = text
    // common code-fence wrappers
    .replace(/^```(?:json|JSON)?\s*/m, "")
    .replace(/```\s*$/m, "");
  const start = stripped.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  // unbalanced — return from first `{` to last `}` as a fallback
  const end = stripped.lastIndexOf("}");
  if (end > start) return stripped.slice(start, end + 1);
  return null;
}

function repairJson(text: string): string {
  let s = text;
  // smart quotes → straight
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // strip // line comments (not inside strings — naive but good enough)
  s = stripComments(s);
  // trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, "$1");
  // Python-ish literals
  s = s.replace(/\bNone\b/g, "null").replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false");
  return s;
}

function stripComments(s: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < s.length) {
    const ch = s[i];
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
