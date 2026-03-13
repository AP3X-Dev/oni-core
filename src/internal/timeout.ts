export async function runWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number | undefined,
  createTimeoutError: () => Error,
): Promise<T> {
  if (timeoutMs == null || timeoutMs <= 0) {
    return operation();
  }

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(createTimeoutError()), timeoutMs);
    if (typeof timer === "object" && timer !== null && "unref" in timer && typeof timer.unref === "function") {
      timer.unref();
    }

    Promise.resolve()
      .then(operation)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}
