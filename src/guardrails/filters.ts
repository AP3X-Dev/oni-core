import type { ContentFilter, ContentFilterResult } from "./types.js";

// ── PII patterns ──────────────────────────────────────────────────

// BUG-0025: The /g flag is intentionally omitted from these patterns.
// RegExp objects with /g maintain shared `lastIndex` state, which causes a
// race condition when the same pattern is tested across concurrent calls —
// alternating between match and no-match. When a global replace is needed,
// a fresh RegExp is created per call (see `piiFilter` below).
const PII_PATTERNS: Record<string, RegExp> = {
  email:      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  ssn:        /\b\d{3}-\d{2}-\d{4}\b/,
  phone:      /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
};

const REDACT_LABELS: Record<string, string> = {
  email:      "[EMAIL REDACTED]",
  ssn:        "[SSN REDACTED]",
  phone:      "[PHONE REDACTED]",
  creditCard: "[CREDIT CARD REDACTED]",
};

export interface PiiFilterOptions {
  block: Array<"email" | "ssn" | "phone" | "creditCard">;
  redact?: boolean;
}

export function piiFilter(options: PiiFilterOptions): ContentFilter {
  const { block, redact = false } = options;

  return {
    name: "pii",
    apply: "both",
    check(content: string): ContentFilterResult {
      let currentContent = content;
      const detectedKinds: string[] = [];

      for (const kind of block) {
        const pattern = PII_PATTERNS[kind];
        if (!pattern) continue;

        if (pattern.test(currentContent)) {
          detectedKinds.push(kind);
          if (redact) {
            const globalPattern = new RegExp(pattern.source, "g");
            currentContent = currentContent.replace(globalPattern, REDACT_LABELS[kind]);
          }
        }
      }

      if (detectedKinds.length > 0) {
        const reason = `PII detected: ${detectedKinds.join(", ")}`;
        if (redact) {
          return { blocked: true, reason, redacted: currentContent };
        }
        return { blocked: true, reason };
      }
      return { blocked: false };
    },
  };
}

// ── Topic filter ──────────────────────────────────────────────────

export interface TopicFilterOptions {
  blocked?: string[];
}

export function topicFilter(options: TopicFilterOptions): ContentFilter {
  const blockedTopics = (options.blocked ?? []).map(t => t.toLowerCase());

  return {
    name: "topic",
    apply: "both",
    check(content: string): ContentFilterResult {
      const lower = content.toLowerCase();
      for (const topic of blockedTopics) {
        if (lower.includes(topic)) {
          return { blocked: true, reason: `Blocked topic: ${topic}` };
        }
      }
      return { blocked: false };
    },
  };
}

// ── Custom filter ─────────────────────────────────────────────────

export interface CustomFilterOptions {
  name: string;
  check: (content: string) => ContentFilterResult;
  apply: "input" | "output" | "both";
}

export function customFilter(options: CustomFilterOptions): ContentFilter {
  return {
    name: options.name,
    apply: options.apply,
    check: options.check,
  };
}

// ── Run filters pipeline ──────────────────────────────────────────

export interface FilterPipelineResult {
  passed: boolean;
  content: string;
  blockedBy?: string;
  reason?: string;
}

export function runFilters(
  filters: ContentFilter[],
  content: string,
  direction: "input" | "output",
): FilterPipelineResult {
  let currentContent = content;

  for (const filter of filters) {
    // Skip filters that don't apply to this direction
    if (filter.apply !== "both" && filter.apply !== direction) {
      continue;
    }

    const result = filter.check(currentContent);

    if (result.blocked) {
      if (result.redacted !== undefined) {
        // Redaction mode — update content and continue
        currentContent = result.redacted;
        continue;
      }
      return {
        passed: false,
        content: currentContent,
        blockedBy: filter.name,
        reason: result.reason,
      };
    }
  }

  return { passed: true, content: currentContent };
}
