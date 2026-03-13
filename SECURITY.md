# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.7.x   | :white_check_mark: |
| < 0.7   | :x:                |

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

### Tool Execution

`@oni.bot/core` provides a tool execution framework. The framework itself does not execute arbitrary code, but user-defined node functions and tools can. Users are responsible for:

- Validating tool inputs before execution
- Using the built-in `Permissions` guardrail to restrict tool access
- Implementing appropriate sandboxing for untrusted tool code

### Model API Keys

API keys for model providers (OpenAI, Anthropic, etc.) should be:

- Stored in environment variables, not in code
- Never logged or included in error messages
- Rotated regularly

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

### Content Filtering

The guardrails module provides content filters (PII, topic). These are best-effort:

- Do not rely solely on built-in filters for compliance
- Layer additional filtering for sensitive domains (healthcare, finance)
- Audit filter effectiveness regularly

## Dependencies

`@oni.bot/core` ships with **zero runtime dependencies**. Optional peer dependencies:

- `better-sqlite3` — for SQLite checkpointing (optional)

This minimizes supply chain attack surface.
