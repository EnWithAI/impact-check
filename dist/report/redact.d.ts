/** Replacement text for masked secrets. */
export declare const REDACTED = "[REDACTED]";
/**
 * Masks token-like substrings (GitHub, AWS, Slack, OpenAI/Anthropic, Google, npm, Stripe, JWT, private
 * key headers, credentials in URLs).
 */
export declare function redact(text: string): string;
/** Deep-redact every string in a JSON-compatible value, except keys listed in `skip`. */
export declare function redactDeep<T>(value: T, skip?: ReadonlySet<string>): T;
