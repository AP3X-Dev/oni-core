import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createChatCommandTrigger,
  createDependencyAlertTrigger,
  createGitHubWebhookTrigger,
  verifyGitHubWebhookSignature,
} from "../index.js";

const options = {
  clock: () => new Date("2026-05-23T12:00:00.000Z"),
  idFactory: (prefix: string) => `${prefix}_test`,
};

function signature(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("platform trigger ingestion", () => {
  it("verifies GitHub webhook signatures using the raw body", () => {
    const rawBody = JSON.stringify({ action: "opened" });
    const secret = "webhook-secret";

    expect(() => verifyGitHubWebhookSignature({
      secret,
      rawBody,
      signature256: signature(secret, rawBody),
    })).not.toThrow();
    expect(() => verifyGitHubWebhookSignature({
      secret,
      rawBody,
      signature256: signature("wrong-secret", rawBody),
    })).toThrow("signature mismatch");
    expect(() => verifyGitHubWebhookSignature({
      secret,
      rawBody,
      signature256: "sha256=not-hex",
    })).toThrow("signature format");
  });

  it("normalizes GitHub pull request webhooks into VCS triggers", () => {
    const payload = {
      action: "opened",
      repository: {
        name: "oni-core",
        html_url: "https://github.com/ap3x/oni-core",
        owner: { login: "ap3x" },
      },
      pull_request: {
        number: 42,
        html_url: "https://github.com/ap3x/oni-core/pull/42",
      },
      sender: { login: "octocat" },
    };
    const rawBody = JSON.stringify(payload);

    const trigger = createGitHubWebhookTrigger({
      event: "pull_request",
      payload,
      rawBody,
      secret: "webhook-secret",
      signature256: signature("webhook-secret", rawBody),
      deliveryId: "delivery-1",
    }, options);

    expect(trigger).toEqual({
      id: "trg_test",
      kind: "vcs",
      source: "github.pull_request",
      actor: "octocat",
      firedAt: "2026-05-23T12:00:00.000Z",
      correlationId: "delivery-1",
      payload: {
        event: "pull_request",
        action: "opened",
        repository: {
          provider: "github",
          owner: "ap3x",
          name: "oni-core",
          url: "https://github.com/ap3x/oni-core",
        },
        sender: "octocat",
        pullRequestNumber: 42,
        pullRequestUrl: "https://github.com/ap3x/oni-core/pull/42",
      },
    });
  });

  it("normalizes GitHub security webhooks without storing the full payload", () => {
    const trigger = createGitHubWebhookTrigger({
      event: "dependabot_alert",
      deliveryId: "delivery-alert",
      payload: {
        action: "created",
        repository: {
          name: "app",
          owner: { login: "ap3x" },
        },
        alert: {
          number: 7,
          html_url: "https://github.com/ap3x/app/security/dependabot/7",
          secretField: "not-copied",
        },
        sender: { login: "dependabot" },
        largeNestedPayload: { should: "not be copied" },
      },
    }, options);

    expect(trigger.kind).toBe("security");
    expect(trigger.source).toBe("github.dependabot_alert");
    expect(trigger.payload).toMatchObject({
      event: "dependabot_alert",
      action: "created",
      alertNumber: 7,
      alertUrl: "https://github.com/ap3x/app/security/dependabot/7",
    });
    expect(JSON.stringify(trigger.payload)).not.toContain("secretField");
    expect(JSON.stringify(trigger.payload)).not.toContain("largeNestedPayload");
  });

  it("normalizes chat commands into chat triggers", () => {
    const trigger = createChatCommandTrigger({
      provider: "slack",
      command: "/oni",
      text: "/oni harden platform",
      channelId: "C123",
      channelName: "agents",
      userId: "U123",
      username: "cj",
      messageId: "1700000000.000100",
    }, options);

    expect(trigger).toMatchObject({
      id: "trg_test",
      kind: "chat",
      source: "chat:slack",
      actor: "cj",
      firedAt: "2026-05-23T12:00:00.000Z",
      correlationId: "1700000000.000100",
      payload: {
        provider: "slack",
        command: "/oni",
        text: "/oni harden platform",
        channelId: "C123",
        channelName: "agents",
        userId: "U123",
        username: "cj",
        messageId: "1700000000.000100",
      },
    });
  });

  it("normalizes dependency alerts into dependency triggers", () => {
    const trigger = createDependencyAlertTrigger({
      provider: "github-dependabot",
      packageName: "vite",
      ecosystem: "npm",
      severity: "high",
      advisoryId: "GHSA-xxxx-yyyy",
      cve: "CVE-2026-0001",
      affectedRange: "<8.0.12",
      fixedVersion: "8.0.12",
      manifestPath: "package.json",
      repository: { provider: "github", owner: "ap3x", name: "oni-core" },
      url: "https://github.com/advisories/GHSA-xxxx-yyyy",
    }, options);

    expect(trigger).toEqual({
      id: "trg_test",
      kind: "dependency",
      source: "dependency:github-dependabot",
      actor: "github-dependabot",
      firedAt: "2026-05-23T12:00:00.000Z",
      correlationId: "GHSA-xxxx-yyyy",
      payload: {
        provider: "github-dependabot",
        packageName: "vite",
        ecosystem: "npm",
        severity: "high",
        advisoryId: "GHSA-xxxx-yyyy",
        cve: "CVE-2026-0001",
        affectedRange: "<8.0.12",
        fixedVersion: "8.0.12",
        manifestPath: "package.json",
        repository: { provider: "github", owner: "ap3x", name: "oni-core" },
        url: "https://github.com/advisories/GHSA-xxxx-yyyy",
      },
    });
  });
});
