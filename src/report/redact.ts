// Masks token-like strings in any repository-derived text before it is rendered.
// Impact Check never emits file contents, but paths, specifiers and names can still carry secrets.

const PATTERNS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s/@]+@/gi,
];

/** Replacement text for masked secrets. */
export const REDACTED = "[REDACTED]";

/**
 * Masks token-like substrings (GitHub, AWS, Slack, OpenAI/Anthropic, Google, npm, Stripe, JWT, private
 * key headers, credentials in URLs).
 */
export function redact(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

/** Deep-redact every string in a JSON-compatible value, except keys listed in `skip`. */
export function redactDeep<T>(value: T, skip: ReadonlySet<string> = new Set()): T {
  const walk = (v: unknown, key: string | null): unknown => {
    if (typeof v === "string") return key !== null && skip.has(key) ? v : redact(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, null));
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    }
    return v;
  };
  return walk(value, null) as T;
}
