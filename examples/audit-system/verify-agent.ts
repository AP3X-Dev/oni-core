import { openrouter } from "../../src/models/openrouter.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Finding } from "./types.js";

export interface VerifyResult {
  confirmed: boolean;
  confidence: number;
  reason: string;
}

export function buildVerifyPrompt(finding: Finding, fileContext: string): string {
  return `Analyze this audit finding and determine if it is a TRUE issue or a FALSE POSITIVE.

FINDING:
- File: ${finding.file}${finding.line ? `:${finding.line}` : ""}
- Category: ${finding.category}
- Severity: ${finding.severity}
- Issue: ${finding.issue}
${finding.suggestion ? `- Suggestion: ${finding.suggestion}` : ""}
- Source: ${finding.source}

FILE CONTEXT (lines around the finding):
\`\`\`
${fileContext}
\`\`\`

Common false positives to watch for:
- Regex patterns or string literals that CONTAIN a dangerous keyword but don't EXECUTE it
- Detection/validation code that CHECKS for dangerous patterns (not using them)
- Code inside template literals or string builders (not runtime code)
- Test files using patterns that would be unsafe in production
- Comments mentioning dangerous patterns

Respond with ONLY this JSON:
{"confirmed": boolean, "confidence": number_0_to_1, "reason": "one sentence explanation"}`;
}

export function parseVerifyResponse(response: string): VerifyResult {
  try {
    // Extract JSON from response (model might wrap it in markdown)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      confirmed: Boolean(parsed.confirmed),
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      reason: String(parsed.reason ?? ""),
    };
  } catch {
    // If we can't parse, default to keeping the finding
    return { confirmed: true, confidence: 0.5, reason: "Verification parse failed — keeping finding" };
  }
}

export async function verifyFindings(
  findings: Finding[],
  rootDir: string,
  modelId: string,
  onProgress?: (msg: string) => void,
): Promise<Finding[]> {
  if (findings.length === 0) return [];

  const model = openrouter(modelId, { reasoningEffort: "low" });
  const verified: Finding[] = [];

  // Batch findings by file to minimize file reads
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }

  for (const [file, fileFindings] of byFile) {
    let fileContent = "";
    try {
      fileContent = await readFile(join(rootDir, file), "utf-8");
    } catch {
      // Can't read file — keep all findings from it
      for (const f of fileFindings) {
        verified.push({ ...f, verified: true, confidence: 0.5, verifyReason: "Could not read file for verification" });
      }
      continue;
    }

    const lines = fileContent.split("\n");

    for (const finding of fileFindings) {
      // Extract context: 10 lines before and after the finding
      const lineIdx = (finding.line ?? 1) - 1;
      const start = Math.max(0, lineIdx - 10);
      const end = Math.min(lines.length, lineIdx + 11);
      const context = lines
        .slice(start, end)
        .map((l, i) => `${start + i + 1}: ${l}`)
        .join("\n");

      const prompt = buildVerifyPrompt(finding, context);

      try {
        const response = await model.chat({
          messages: [{ role: "user", content: prompt }],
          systemPrompt: "You are a code review expert. Analyze findings for false positives. Respond with JSON only.",
          maxTokens: 256,
        });

        const result = parseVerifyResponse(response.content);
        onProgress?.(`  [verify] ${finding.file}:${finding.line ?? "?"} — ${result.confirmed ? "CONFIRMED" : "REJECTED"} (${(result.confidence * 100).toFixed(0)}%) ${result.reason}`);

        if (result.confirmed && result.confidence >= 0.6) {
          verified.push({
            ...finding,
            verified: true,
            confidence: result.confidence,
            verifyReason: result.reason,
          });
        }
      } catch {
        // Verification failed — keep the finding
        verified.push({ ...finding, verified: true, confidence: 0.5, verifyReason: "Verification error — keeping finding" });
      }
    }
  }

  return verified;
}
