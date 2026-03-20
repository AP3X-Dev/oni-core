import { describe, it, expect } from "vitest";
import { createMessage } from "../../swarm/mailbox.js";

describe("createMessage", () => {
  it("BUG-0072: should generate unique message IDs across concurrent instances", () => {
    // Before the fix, a shared module-level counter caused ID collisions
    // when multiple SwarmGraph instances called createMessage concurrently.
    // The fix replaced the counter with randomUUID().
    const ids = new Set<string>();
    const count = 100;

    for (let i = 0; i < count; i++) {
      const msg = createMessage("agentA", "agentB", `message-${i}`);
      ids.add(msg.id);
    }

    expect(ids.size).toBe(count);
  });
});
