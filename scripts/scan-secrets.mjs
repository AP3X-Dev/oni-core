#!/usr/bin/env node
// ============================================================
// scan-secrets.mjs — content secret scanner for the release gate
// ============================================================
// Replaces the regex/filename-only secret check with a content scan of
// every git-tracked source file. It looks for high-confidence credential
// shapes (private keys, provider tokens with their real prefixes) rather
// than the many benign `apiKey`/`token` identifiers in the codebase, so it
// stays quiet on variable names and noisy on actual leaked material.
//
// Exit codes: 0 = clean, 1 = findings, 2 = scanner error.
//
// Suppress a known-safe line by appending the marker:  secret-scan: allow
// ============================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOW_MARKER = "secret-scan: allow";

// Placeholder words that mark a token as a fixture/example, not a real secret.
const PLACEHOLDER = /(example|sample|placeholder|dummy|fake|test|redacted|your[-_]?|xxxx|0000|1234|changeme|notarealkey|<[a-z]|\.\.\.)/i;

// Only scan source-like, tracked files. Markdown/docs are excluded because
// they intentionally show example tokens.
const SCANNED_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".env"]);

// High-confidence detectors. Each must match a real credential shape with a
// provider-specific prefix or structure that does not appear in identifiers.
const DETECTORS = [
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, placeholderOk: false },
  { id: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/, placeholderOk: true },
  { id: "aws-secret-access-key", re: /\baws_secret_access_key\s*[=:]\s*['"][A-Za-z0-9/+]{40}['"]/i, placeholderOk: true },
  { id: "github-token", re: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/, placeholderOk: true },
  { id: "slack-token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, placeholderOk: true },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_\-]{35}\b/, placeholderOk: true },
  { id: "stripe-live-secret", re: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/, placeholderOk: false },
  { id: "stripe-live-publishable", re: /\bpk_live_[0-9A-Za-z]{16,}\b/, placeholderOk: false },
  { id: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/, placeholderOk: true },
  { id: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/, placeholderOk: true },
  { id: "private-key-pkcs8-b64", re: /-----BEGIN ENCRYPTED PRIVATE KEY-----/, placeholderOk: false }, // secret-scan: allow
];

function trackedFiles() {
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split(/\r?\n/).filter(Boolean);
}

function extOf(path) {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function scanFile(path) {
  const findings = [];
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return findings; // unreadable/binary — skip
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_MARKER)) continue;
    for (const det of DETECTORS) {
      const m = det.re.exec(line);
      if (!m) continue;
      // For detectors that can appear as fixtures, skip obvious placeholders.
      if (det.placeholderOk && PLACEHOLDER.test(line)) continue;
      findings.push({ path, line: i + 1, id: det.id, sample: m[0].slice(0, 12) + "…" });
    }
  }
  return findings;
}

function main() {
  let files;
  try {
    files = trackedFiles();
  } catch (err) {
    console.error(`[scan-secrets] failed to list tracked files: ${err.message}`);
    process.exit(2);
  }

  const findings = [];
  let scanned = 0;
  for (const file of files) {
    if (!SCANNED_EXT.has(extOf(file))) continue;
    scanned++;
    findings.push(...scanFile(file));
  }

  if (findings.length > 0) {
    console.error(`[scan-secrets] ${findings.length} potential secret(s) found in ${scanned} scanned files:`);
    for (const f of findings) {
      console.error(`  ${f.path}:${f.line}  [${f.id}]  ${f.sample}`);
    }
    console.error(`\nIf a finding is a known-safe fixture, append "// ${ALLOW_MARKER}" to that line.`);
    process.exit(1);
  }

  console.log(`[scan-secrets] no high-confidence secrets in ${scanned} scanned files.`);
}

main();
