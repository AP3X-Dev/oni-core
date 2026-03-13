import { describe, it, expect } from "vitest";
import { PubSub } from "../../coordination/pubsub.js";

describe("PubSub buffer bounds", () => {
  it("enforces maxBufferSize by dropping oldest messages", () => {
    const ps = new PubSub({ maxBufferSize: 3 });

    ps.publish("agent-a", "topic.x", "msg1");
    ps.publish("agent-a", "topic.x", "msg2");
    ps.publish("agent-a", "topic.x", "msg3");
    ps.publish("agent-a", "topic.x", "msg4"); // should evict msg1

    const msgs = ps.getMessages("*");
    expect(msgs).toHaveLength(3);
    expect(msgs[0]!.data).toBe("msg2"); // oldest surviving
    expect(msgs[2]!.data).toBe("msg4"); // newest
  });

  it("defaults to unlimited buffer when no maxBufferSize is set", () => {
    const ps = new PubSub();

    for (let i = 0; i < 200; i++) {
      ps.publish("agent", "topic", i);
    }

    expect(ps.getMessages("*")).toHaveLength(200);
  });

  it("preserves from field when publishing via agent name", () => {
    const ps = new PubSub();
    ps.publish("my-agent", "events.created", { id: 1 });

    const msgs = ps.getMessages("events.*");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.from).toBe("my-agent");
    expect(msgs[0]!.topic).toBe("events.created");
    expect(msgs[0]!.data).toEqual({ id: 1 });
  });
});
