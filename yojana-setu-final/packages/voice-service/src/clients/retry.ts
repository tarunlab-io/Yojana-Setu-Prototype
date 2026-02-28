import { logger } from '../config';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  /** Multiplier applied to delay on each retry (default: 2) */
  backoffFactor?: number;
  /** Maximum delay cap in ms (default: 10000) */
  maxDelayMs?: number;
  /** Function to determine if an error is retryable */
  isRetryable?: (err: unknown) => boolean;
}

/**
 * Executes an async operation with exponential backoff retry logic.
 * Logs each attempt and final failure.
 *
 * @param operation - Async function to retry
 * @param options - Retry configuration
 * @param operationName - Human-readable name for logging
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
  operationName: string,
): Promise<T> {
  const {
    maxRetries,
    baseDelayMs,
    backoffFactor = 2,
    maxDelayMs = 10_000,
    isRetryable = () => true,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();

      if (attempt > 0) {
        logger.info(`${operationName} succeeded after ${attempt} retries`);
      }

      return result;
    } catch (err) {
      lastError = err;

      const isLast = attempt === maxRetries;
      const canRetry = isRetryable(err);

      if (isLast || !canRetry) {
        logger.error(`${operationName} failed after ${attempt + 1} attempts`, {
          error: err instanceof Error ? err.message : String(err),
          retryable: canRetry,
        });
        break;
      }

      const delay = Math.min(baseDelayMs * Math.pow(backoffFactor, attempt), maxDelayMs);
      logger.warn(`${operationName} attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
        error: err instanceof Error ? err.message : String(err),
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determines if an HTTP error status is retryable.
 * 429 (rate limit), 503 (unavailable), 504 (timeout) are retryable.
 * 4xx client errors (except 429) are not retryable.
 */
export function isHttpRetryable(err: unknown): boolean {
  if (err instanceof Error && 'status' in err) {
    const status = (err as { status: number }).status;
    return status === 429 || status >= 500;
  }
  // Network errors (no status) are retryable
  return true;
}
