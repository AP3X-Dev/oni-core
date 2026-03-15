import type { ToolDefinition, ToolContext } from "../types.js";

interface SlackWebClient {
  chat: {
    postMessage: (args: {
      channel: string;
      text?: string;
      blocks?: unknown[];
      thread_ts?: string;
    }) => Promise<unknown>;
  };
}

interface SlackWebApiModule {
  WebClient: new (token: string) => SlackWebClient;
}

interface SendMessageInput {
  channel: string;
  text?: string;
  blocks?: unknown[];
}

interface PostToChannelInput {
  channel: string;
  text: string;
  username?: string;
  iconEmoji?: string;
}

interface ReplyInThreadInput {
  channel: string;
  threadTs: string;
  text: string;
  blocks?: unknown[];
}

async function loadSlackClient(token: string): Promise<SlackWebClient> {
  let mod: SlackWebApiModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mod = (await import("@slack/web-api" as any)) as SlackWebApiModule;
  } catch {
    throw new Error(
      "slackTools requires '@slack/web-api'. Install it: pnpm add @slack/web-api"
    );
  }
  return new mod.WebClient(token);
}

export function slackTools(config: { token: string }): ToolDefinition[] {
  const sendMessageTool: ToolDefinition = {
    name: "slack_send_message",
    description: "Send a message to a Slack channel or user",
    schema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID, channel name (#general), or user ID to send to",
        },
        text: { type: "string", description: "Message text (supports Slack mrkdwn)" },
        blocks: {
          type: "array",
          items: {},
          description: "Slack Block Kit blocks (optional, for rich messages)",
        },
      },
      required: ["channel"],
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as SendMessageInput;
      const client = await loadSlackClient(config.token);
      return client.chat.postMessage({
        channel: i.channel,
        text: i.text,
        blocks: i.blocks,
      });
    },
  };

  const postToChannelTool: ToolDefinition = {
    name: "slack_post_to_channel",
    description: "Post a formatted message to a Slack channel",
    schema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel name (e.g. #general) or channel ID",
        },
        text: { type: "string", description: "Message text" },
        username: { type: "string", description: "Override bot username for this message" },
        iconEmoji: {
          type: "string",
          description: "Override bot icon with an emoji (e.g. :robot_face:)",
        },
      },
      required: ["channel", "text"],
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as PostToChannelInput;
      const client = await loadSlackClient(config.token);
      return client.chat.postMessage({
        channel: i.channel,
        text: i.text,
      });
    },
  };

  const replyInThreadTool: ToolDefinition = {
    name: "slack_reply_in_thread",
    description: "Reply to an existing Slack message thread",
    schema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID or name where the parent message lives",
        },
        threadTs: {
          type: "string",
          description: "Timestamp of the parent message to reply to (e.g. '1234567890.123456')",
        },
        text: { type: "string", description: "Reply text" },
        blocks: {
          type: "array",
          items: {},
          description: "Slack Block Kit blocks (optional)",
        },
      },
      required: ["channel", "threadTs", "text"],
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as ReplyInThreadInput;
      const client = await loadSlackClient(config.token);
      return client.chat.postMessage({
        channel: i.channel,
        thread_ts: i.threadTs,
        text: i.text,
        blocks: i.blocks,
      });
    },
  };

  return [sendMessageTool, postToChannelTool, replyInThreadTool];
}
