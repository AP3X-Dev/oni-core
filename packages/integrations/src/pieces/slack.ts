import { adaptActivePiece, type AdaptedToolDefinition, type ActivePiecesAction } from "../adapter/index.js";
import type { AuthResolver } from "../adapter/auth-resolver.js";
import { PropertyType } from "../adapter/props-to-schema.js";

const slackSendMessage: ActivePiecesAction = {
  name: "slack_send_message",
  displayName: "Send Message",
  description: "Send a message to a Slack channel or user",
  props: {
    to: { type: PropertyType.SHORT_TEXT, displayName: "Channel or User ID", required: true },
    text: { type: PropertyType.LONG_TEXT, displayName: "Message Text", required: true },
  },
  run: async (_ctx) => {
    throw new Error(
      "Slack tools require the '@activepieces/piece-slack' package. " +
      "Install it and import the actual action: import { slackSendMessageAction } from '@activepieces/piece-slack'",
    );
  },
};

const slackGetChannelHistory: ActivePiecesAction = {
  name: "slack_get_channel_history",
  displayName: "Get Channel History",
  description: "Retrieve recent messages from a Slack channel",
  props: {
    channel: { type: PropertyType.SHORT_TEXT, displayName: "Channel ID", required: true },
    limit: { type: PropertyType.NUMBER, displayName: "Limit", required: false, description: "Number of messages to retrieve (default 100)" },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-slack"); },
};

const slackFindUserByEmail: ActivePiecesAction = {
  name: "find_slack_user_by_email",
  displayName: "Find User by Email",
  description: "Look up a Slack user by their email address",
  props: {
    email: { type: PropertyType.SHORT_TEXT, displayName: "Email Address", required: true },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-slack"); },
};

/**
 * Get adapted Slack tool definitions.
 * @param authResolver - Provides OAuth2 credentials for Slack
 * @param actions - Optional: provide actual community actions to get real execution.
 */
export function adaptedSlackTools(
  authResolver: AuthResolver,
  actions?: {
    sendMessage?: ActivePiecesAction;
    getChannelHistory?: ActivePiecesAction;
    findUserByEmail?: ActivePiecesAction;
  },
): AdaptedToolDefinition[] {
  return [
    adaptActivePiece(actions?.sendMessage ?? slackSendMessage, authResolver),
    adaptActivePiece(actions?.getChannelHistory ?? slackGetChannelHistory, authResolver),
    adaptActivePiece(actions?.findUserByEmail ?? slackFindUserByEmail, authResolver),
  ];
}
