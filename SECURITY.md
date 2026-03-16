# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in `@oni.bot/core`, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email **security@oni.bot** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. You will receive acknowledgment within **48 hours**
4. A fix will be released within **7 days** for critical issues

## Security Considerations

### Built-in Hardening (v1.2.0+)

As of v1.2.0, the framework includes comprehensive security hardening from an automated bug pipeline that found and fixed 90+ vulnerabilities:

**Input validation & injection prevention:**
- All filesystem operations validate paths against traversal attacks and strip null bytes
- CLI commands use `execFileSync` (array args) instead of shell interpolation
- `deepMerge` and config loaders reject prototype pollution payloads (`__proto__`, `constructor`, `prototype`)
- Mermaid diagram generation escapes bracket injection in node labels
- LLM-generated skill content is validated before disk writes

**Network & API security:**
- All model factories (`anthropic`, `openai`, `openrouter`, `google`, `ollama`) validate URL schemes to prevent SSRF and API key exfiltration
- A2A server enforces CORS preflight, Content-Type validation, and 1MB body size limits
- Raw API response bodies are never exposed in error messages — generic status codes only
- API key presence is validated at factory construction time (fail-fast)

**Access control:**
- `checkAllowedPath()` returns and uses the resolved path for I/O (closes TOCTOU race)
- Empty `allowedPaths` throws instead of silently allowing all filesystem access
- Permission hooks fail-closed on error and timeout for security-critical events
- Safety gate uses strict boolean equality for approval checks

**Resource limits:**
- MCP `StdioTransport` and LSP client enforce max buffer sizes to prevent OOM
- `ExperimentLog` capped at 1,000 records; `DeadLetterQueue` at 100 per thread
- `crypto.randomUUID()` used for all security-sensitive IDs (replaces `Math.random`)

### Tool Execution

`@oni.bot/core` provides a tool execution framework. The framework itself does not execute arbitrary code, but user-defined node functions and tools can. Users are responsible for:

- Validating tool inputs before execution
- Using the built-in `Permissions` guardrail to restrict tool access
- Implementing appropriate sandboxing for untrusted tool code

### Model API Keys

API keys for model providers (OpenAI, Anthropic, etc.) are protected by:

- Construction-time validation — missing keys throw immediately
- URL scheme validation — prevents exfiltration via malicious `baseUrl`
- Error message sanitization — raw API responses never surface in errors
- Users should still store keys in environment variables and rotate regularly

### Budget Enforcement

The `BudgetTracker` guardrail provides cost limits but should not be the sole control:

- Set conservative budget limits
- Monitor usage through the telemetry/audit system
- Implement server-side rate limiting for production deployments

### Checkpoint Data

Checkpoint data may contain sensitive state. When using persistent checkpointers:

- Use encrypted storage for SQLite/PostgreSQL backends
- Implement TTL-based cleanup for old checkpoints
- Restrict access to checkpoint storage
- Redis operations use atomic Lua scripts to prevent partial writes

### Content Filtering

The guardrails module provides content filters (PII, topic). These are best-effort:

- Do not rely solely on built-in filters for compliance
- Layer additional filtering for sensitive domains (healthcare, finance)
- Audit filter effectiveness regularly
- PII regex patterns are stateless (no `/g` flag) for concurrency safety

## Dependencies

`@oni.bot/core` ships with **zero runtime dependencies**. Optional peer dependencies:

- `better-sqlite3` — for SQLite checkpointing (optional)

This minimizes supply chain attack surface.
