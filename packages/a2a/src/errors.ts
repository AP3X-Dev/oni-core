/**
 * Thrown when an A2A request receives a 401 Unauthorized response,
 * indicating that auth credentials (e.g. an OAuth2 token) have expired
 * or are invalid.
 *
 * Callers can catch this specific error type to trigger token refresh
 * and retry logic without needing changes to A2AClientConfig.
 */
export class A2AAuthExpiredError extends Error {
  /** HTTP status code (always 401). */
  readonly statusCode = 401;

  constructor(
    message: string,
    /** The URL that returned 401. */
    public readonly url: string,
  ) {
    super(message);
    this.name = "A2AAuthExpiredError";
  }
}
