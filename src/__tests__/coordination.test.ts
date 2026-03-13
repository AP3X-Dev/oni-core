import { describe, it, expect, vi } from "vitest";
import { RequestReplyBroker } from "../coordination/request-reply.js";
import { PubSub, topicMatches } from "../coordination/pubsub.js";

// ── RequestReplyBroker ──────────────────────────────────────────

describe("RequestReplyBroker", () => {
  it("request() creates pending request and reply() resolves it", async () => {
    const broker = new RequestReplyBroker();
    const { requestId, promise, message } = broker.request(
      "agentA",
      "agentB",
      { query: "hello" },
    );

    expect(requestId).toMatch(/^req_/);
    expect(message.from).toBe("agentA");
    expect(message.to).toBe("agentB");
    expect(message.metadata.requestId).toBe(requestId);

    const replyMsg = broker.reply(requestId, { answer: 42 });
    expect(replyMsg.from).toBe("agentB");
    expect(replyMsg.to).toBe("agentA");
    expect(replyMsg.metadata.isReply).toBe(true);

    const result = await promise;
    expect(result).toEqual({ answer: 42 });
  });

  it("getPending returns unresolved requests for an agent", () => {
    const broker = new RequestReplyBroker();
    broker.request("a", "b", "p1");
    broker.request("c", "b", "p2");
    broker.request("a", "d", "p3");

    const pending = broker.getPending("b");
    expect(pending).toHaveLength(2);
    expect(pending.every((r) => r.to === "b")).toBe(true);
    expect(broker.hasPending("b")).toBe(true);
    expect(broker.hasPending("d")).toBe(true);
    expect(broker.hasPending("a")).toBe(false);
  });

  it("reply throws for unknown request", () => {
    const broker = new RequestReplyBroker();
    expect(() => broker.reply("nonexistent", "data")).toThrow(
      "No pending request with id nonexistent",
    );
  });
});

// ── PubSub ──────────────────────────────────────────────────────

describe("PubSub", () => {
  it("publish notifies matching subscribers", () => {
    const ps = new PubSub();
    const handler = vi.fn();
    ps.subscribe("events.click", handler);

    ps.publish("ui", "events.click", { x: 10 });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].topic).toBe("events.click");
    expect(handler.mock.calls[0][0].data).toEqual({ x: 10 });
  });

  it("wildcard subscription matches subtopics", () => {
    const ps = new PubSub();
    const handler = vi.fn();
    ps.subscribe("research.*", handler);

    ps.publish("agentA", "research.complete", { result: "done" });
    ps.publish("agentB", "research.started", { task: "search" });
    ps.publish("agentC", "other.event", {});

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0].topic).toBe("research.complete");
    expect(handler.mock.calls[1][0].topic).toBe("research.started");
  });

  it("getMessages returns buffered messages", () => {
    const ps = new PubSub();
    ps.publish("a", "topic.one", 1);
    ps.publish("b", "topic.two", 2);
    ps.publish("c", "other", 3);

    const msgs = ps.getMessages("topic.*");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].data).toBe(1);
    expect(msgs[1].data).toBe(2);
  });

  it("flush clears buffer and returns messages", () => {
    const ps = new PubSub();
    ps.publish("a", "x", 1);
    ps.publish("b", "y", 2);

    const flushed = ps.flush();
    expect(flushed).toHaveLength(2);
    expect(ps.flush()).toHaveLength(0);
  });

  it("unsubscribe stops notifications", () => {
    const ps = new PubSub();
    const handler = vi.fn();
    const unsub = ps.subscribe("t", handler);

    ps.publish("a", "t", 1);
    expect(handler).toHaveBeenCalledOnce();

    unsub();
    ps.publish("a", "t", 2);
    expect(handler).toHaveBeenCalledOnce(); // still 1
  });
});

// ── topicMatches ────────────────────────────────────────────────

describe("topicMatches", () => {
  it("exact match", () => {
    expect(topicMatches("a.b", "a.b")).toBe(true);
  });

  it("no match", () => {
    expect(topicMatches("a.b", "a.c")).toBe(false);
  });

  it("wildcard *", () => {
    expect(topicMatches("a.*", "a.b")).toBe(true);
  });

  it("single-segment wildcard does not match deeper paths", () => {
    expect(topicMatches("a.*", "a.b.c")).toBe(false);
  });

  it("global *", () => {
    expect(topicMatches("*", "anything")).toBe(true);
    expect(topicMatches("*", "a.b.c")).toBe(true);
  });

  it("** matches deep", () => {
    expect(topicMatches("a.**", "a.b.c.d")).toBe(true);
    expect(topicMatches("a.**", "a.b")).toBe(true);
    expect(topicMatches("a.**", "a.x.y.z")).toBe(true);
  });

  it("** does not match wrong prefix", () => {
    expect(topicMatches("a.**", "b.c.d")).toBe(false);
  });
});
