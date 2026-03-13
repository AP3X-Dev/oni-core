import type { Finding, SuppressionRule, Category } from "./types.js";

function matchGlob(pattern: string, path: string): boolean {
  // Convert glob to regex: ** → .*, * → [^/]*, ? → .
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${re}$`).test(path);
}

export function loadSuppressions(content: string): SuppressionRule[] {
  const rules: SuppressionRule[] = [];

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(":");
    if (parts.length === 2) {
      rules.push({
        filePattern: parts[0]!,
        category: parts[1]! as Category | "*",
      });
    } else if (parts.length === 3) {
      const lineNum = parseInt(parts[1]!, 10);
      if (Number.isNaN(lineNum)) {
        // Treat as file:category if middle part isn't a number
        rules.push({ filePattern: parts[0]!, category: parts[2]! as Category | "*" });
      } else {
        rules.push({
          filePattern: parts[0]!,
          category: parts[2]! as Category | "*",
          line: lineNum,
        });
      }
    }
  }

  return rules;
}

export function loadSuppressionsFromFile(path: string): SuppressionRule[] {
  try {
    const fs = require("node:fs");
    return loadSuppressions(fs.readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

export function isSuppressed(finding: Finding, rules: SuppressionRule[]): boolean {
  for (const rule of rules) {
    if (!matchGlob(rule.filePattern, finding.file)) continue;
    if (rule.category !== "*" && rule.category !== finding.category) continue;
    if (rule.line !== undefined && finding.line !== rule.line) continue;
    return true;
  }
  return false;
}
