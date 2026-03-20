# Project Context

> **This document provides high-level project direction to the bug pipeline.**
> The Supervisor agent reads this file every cycle and uses it to keep all agents
> aligned with the project's goals, priorities, and constraints.
>
> **Edit this file** to steer the pipeline. Changes take effect on the next Supervisor cycle.

---

## Project Overview

<!-- Describe what this project is, what it does, and who it's for. -->

**Name:** (your project name)
**Type:** (e.g., web app, CLI tool, library, API service)
**Stack:** (e.g., TypeScript, Node.js, React, PostgreSQL)
**Description:** (1-2 sentence summary)

---

## Current Priority

<!-- What should the pipeline focus on right now? The Supervisor uses this to
     guide Hunter scan focus, Fixer priority ordering, and Validator strictness. -->

**Focus area:** (e.g., "API layer stability", "auth system hardening", "performance hotspots")
**Critical paths:** (list files or modules that are highest priority)

```
- src/core/          # highest priority — runtime engine
- src/api/           # high priority — public API surface
```

**Off-limits:** (files or directories the pipeline should NOT touch)

```
- vendor/            # third-party code, do not scan or fix
- scripts/           # deployment scripts, manual only
- *.test.ts          # test files — Hunter ignores these by default
```

---

## Quality Goals

<!-- What quality bar should the pipeline enforce? -->

- **Severity threshold:** Fix all `critical` and `high` bugs. `medium` bugs are fix-if-time. `low` bugs can accumulate.
- **Reopen tolerance:** Reopen rate should stay below 25%. If it exceeds 40%, the Supervisor should investigate Fixer prompt quality.
- **Test coverage:** When the Test Generator creates regression tests, focus on the critical paths listed above.
- **Security posture:** The Security Auditor should prioritize OWASP Top 10 issues in API-facing code.

---

## Architecture Notes

<!-- Brief notes about the project's architecture that help agents understand the codebase.
     This is NOT full documentation — just enough context to avoid common mistakes. -->

### Key Patterns

<!-- e.g., "We use dependency injection via constructor params, not a DI container" -->

- (pattern 1)
- (pattern 2)

### Known Debt

<!-- Things agents should be aware of but NOT try to fix unless explicitly prioritized. -->

- (known issue 1)
- (known issue 2)

### External Dependencies

<!-- APIs, services, or systems the code interacts with that agents should be aware of. -->

- (dependency 1)
- (dependency 2)

---

## Agent Tuning Guidance

<!-- Optional: specific guidance for individual agents that the Supervisor
     should enforce when evaluating and modifying prompts. -->

### Hunter

- Prefer depth over breadth — scan fewer files more thoroughly per cycle
- Prioritize the focus area modules listed above

### Fixer

- Always create bugfix branches (never commit directly to main)
- For critical bugs, prefer conservative fixes over clever ones

### Validator

- Be strict on critical/high bugs — 100% confident before verifying
- Be lenient on low bugs — 80% confident is sufficient

### Security Auditor

- Focus on the critical paths listed above
- Deprioritize internal-only utility code

### Git Manager

- Run gc less frequently if the repo is small (<100MB .git)

### Supervisor

- Check this document every cycle for priority changes
- When modifying prompts, ensure changes align with the goals above
- Never optimize for throughput at the expense of the quality goals

---

## Changelog

<!-- Track major direction changes so the Supervisor can see what shifted and when. -->

| Date | Change |
|------|--------|
| (today) | Initial context document created |
