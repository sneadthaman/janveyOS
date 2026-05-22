export class NonRetryableActionError extends Error {
  public readonly retryable = false;

  constructor(
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "NonRetryableActionError";
  }
}
