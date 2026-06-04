// ============================================================
// @oni.bot/core/platform - Secret redaction
// ============================================================
// Shared redaction used by every surface that persists agent output
// (external-agent runner, agentLoop runner, artifact/audit content) so
// granted secret values never reach durable storage in the clear.
// ============================================================

/** Minimum length a value must have before it is worth redacting. */
export const MIN_REDACTABLE_LENGTH = 4;

export const REDACTION_PLACEHOLDER = "[REDACTED_SECRET]";

/**
 * Replace every occurrence of each secret value in `text` with a placeholder.
 * Short values (< MIN_REDACTABLE_LENGTH) are ignored to avoid mangling output
 * with overly broad substitutions. Longest values are replaced first so that a
 * secret which is a substring of another is not partially exposed.
 */
export function redactSecrets(text: string, values: Iterable<string | undefined>): string {
  const usable = [...values]
    .filter((value): value is string => typeof value === "string" && value.length >= MIN_REDACTABLE_LENGTH)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const value of usable) {
    if (out.includes(value)) {
      out = out.split(value).join(REDACTION_PLACEHOLDER);
    }
  }
  return out;
}

/**
 * Collect the concrete secret values that should be redacted, given the set of
 * granted secret keys and an environment map that may hold their values.
 * Only keys present in `secretKeys` contribute, so non-secret env is never
 * treated as redactable material.
 */
export function collectRedactionValues(
  secretKeys: Iterable<string>,
  env: Record<string, string | undefined> | undefined,
): string[] {
  if (!env) return [];
  const keys = new Set(secretKeys);
  const values: string[] = [];
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.length >= MIN_REDACTABLE_LENGTH) {
      values.push(value);
    }
  }
  return values;
}
