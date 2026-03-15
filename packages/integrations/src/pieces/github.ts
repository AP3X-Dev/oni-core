import { adaptActivePiece, type AdaptedToolDefinition, type ActivePiecesAction } from "../adapter/index.js";
import type { AuthResolver } from "../adapter/auth-resolver.js";
import { PropertyType } from "../adapter/props-to-schema.js";

const githubCreateIssue: ActivePiecesAction = {
  name: "github_create_issue",
  displayName: "Create Issue",
  description: "Create a new issue in a GitHub repository",
  props: {
    owner: { type: PropertyType.SHORT_TEXT, displayName: "Repository Owner", required: true },
    repo: { type: PropertyType.SHORT_TEXT, displayName: "Repository Name", required: true },
    title: { type: PropertyType.SHORT_TEXT, displayName: "Issue Title", required: true },
    body: { type: PropertyType.LONG_TEXT, displayName: "Issue Body", required: false },
  },
  run: async (_ctx) => {
    throw new Error(
      "GitHub tools require the '@activepieces/piece-github' package. " +
      "Install it and import the actual action: import { githubCreateIssueAction } from '@activepieces/piece-github'",
    );
  },
};

const githubListIssues: ActivePiecesAction = {
  name: "github_list_issues",
  displayName: "List Issues",
  description: "List issues in a GitHub repository",
  props: {
    owner: { type: PropertyType.SHORT_TEXT, displayName: "Repository Owner", required: true },
    repo: { type: PropertyType.SHORT_TEXT, displayName: "Repository Name", required: true },
    state: {
      type: PropertyType.STATIC_SELECT,
      displayName: "State",
      required: false,
      options: { options: [{ label: "Open", value: "open" }, { label: "Closed", value: "closed" }, { label: "All", value: "all" }] },
    },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-github"); },
};

const githubCreatePR: ActivePiecesAction = {
  name: "github_create_pull_request",
  displayName: "Create Pull Request",
  description: "Open a new pull request in a GitHub repository",
  props: {
    owner: { type: PropertyType.SHORT_TEXT, displayName: "Repository Owner", required: true },
    repo: { type: PropertyType.SHORT_TEXT, displayName: "Repository Name", required: true },
    title: { type: PropertyType.SHORT_TEXT, displayName: "PR Title", required: true },
    head: { type: PropertyType.SHORT_TEXT, displayName: "Head Branch", required: true },
    base: { type: PropertyType.SHORT_TEXT, displayName: "Base Branch", required: true },
    body: { type: PropertyType.LONG_TEXT, displayName: "PR Body", required: false },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-github"); },
};

/**
 * Get adapted GitHub tool definitions.
 * @param authResolver - Provides OAuth2 or API key credentials for GitHub
 * @param actions - Optional: provide actual community actions to get real execution.
 */
export function adaptedGithubTools(
  authResolver: AuthResolver,
  actions?: {
    createIssue?: ActivePiecesAction;
    listIssues?: ActivePiecesAction;
    createPR?: ActivePiecesAction;
  },
): AdaptedToolDefinition[] {
  return [
    adaptActivePiece(actions?.createIssue ?? githubCreateIssue, authResolver),
    adaptActivePiece(actions?.listIssues ?? githubListIssues, authResolver),
    adaptActivePiece(actions?.createPR ?? githubCreatePR, authResolver),
  ];
}
