import ts from "typescript";
import type { Finding, Category } from "./types.js";
import { findingId } from "./types.js";

function isTestFile(filePath: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath);
}

export function scanSource(filePath: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const isTest = isTestFile(filePath);

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  function getLine(node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }

  function visit(node: ts.Node): void {
    // ── eval() calls ──────────────────────────────────────
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "eval"
    ) {
      findings.push({
        id: findingId(),
        severity: "critical",
        category: "security",
        file: filePath,
        line: getLine(node),
        issue: "eval() call detected — executes arbitrary code.",
        suggestion: "Replace with Function constructor or a safe parser.",
        source: "ast",
      });
    }

    // ── any type annotations (skip test files) ────────────
    if (!isTest && node.kind === ts.SyntaxKind.AnyKeyword) {
      const parent = node.parent;
      // Only flag explicit annotations, not inferred
      if (
        parent &&
        (ts.isTypeReferenceNode(parent) ||
          ts.isParameter(parent) ||
          ts.isVariableDeclaration(parent) ||
          ts.isFunctionDeclaration(parent) ||
          ts.isMethodDeclaration(parent) ||
          ts.isPropertyDeclaration(parent) ||
          ts.isPropertySignature(parent) ||
          ts.isTypeAliasDeclaration(parent) ||
          ts.isAsExpression(parent))
      ) {
        findings.push({
          id: findingId(),
          severity: "warning",
          category: "types",
          file: filePath,
          line: getLine(node),
          issue: "Explicit 'any' type annotation reduces type safety.",
          suggestion: "Replace with a specific type or 'unknown'.",
          source: "ast",
        });
      }
    }

    // ── Empty catch blocks ────────────────────────────────
    if (ts.isCatchClause(node)) {
      const block = node.block;
      const blockText = block.getText(sourceFile).trim();
      // Empty if just braces or braces with only whitespace
      const inner = blockText.slice(1, -1).trim();
      if (inner.length === 0) {
        findings.push({
          id: findingId(),
          severity: "warning",
          category: "error-handling",
          file: filePath,
          line: getLine(node),
          issue: "Empty catch block silently swallows errors.",
          suggestion: "Log the error, re-throw, or add a comment explaining why it's ignored.",
          source: "ast",
        });
      }
    }

    // ── console.log in production code ────────────────────
    if (
      !isTest &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "console" &&
      node.expression.name.text === "log"
    ) {
      findings.push({
        id: findingId(),
        severity: "info",
        category: "code-smell",
        file: filePath,
        line: getLine(node),
        issue: "console.log in production code.",
        suggestion: "Remove or replace with a structured logger.",
        source: "ast",
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

export async function scanFiles(files: string[], rootDir: string): Promise<Finding[]> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const all: Finding[] = [];

  for (const file of files) {
    try {
      const fullPath = join(rootDir, file);
      const content = await readFile(fullPath, "utf-8");
      all.push(...scanSource(file, content));
    } catch {
      // skip unreadable files
    }
  }

  return all;
}
