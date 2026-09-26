import { setTimeout as sleep } from 'node:timers/promises';
import type { LanguageModelMiddleware } from 'ai';

export class RateLimitError extends Error {
  constructor() {
    super('OpenRouter is still rate-limiting requests. Wait before trying again; your model or account quota may need time to reset.');
    this.name = 'RateLimitError';
  }
}

// OpenRouter can put reset headers in either the HTTP headers or error metadata.
export function rateLimitDelay(error: unknown, now = Date.now()): number | undefined {
  if (!error || typeof error !== 'object' || !('statusCode' in error) || error.statusCode !== 429) return;
  const details = error as { responseHeaders?: Record<string, string>; responseBody?: string };
  let metadataHeaders: Record<string, string> = {};
  try {
    metadataHeaders = JSON.parse(details.responseBody ?? '{}').error?.metadata?.headers ?? {};
  } catch { /* The HTTP headers still work if the body is not JSON. */ }
  const headers = Object.fromEntries(
    Object.entries({ ...metadataHeaders, ...details.responseHeaders }).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const delays: number[] = [];
  const retryAfter = headers['retry-after'];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now;
    if (Number.isFinite(delay)) delays.push(delay);
  }
  const reset = Number(headers['x-ratelimit-reset']);
  if (Number.isFinite(reset) && reset > 0) {
    delays.push((reset < 1e12 ? reset * 1000 : reset) - now);
  }
  return delays.length ? Math.max(1000, ...delays.map(delay => delay + 1000)) : 60_000;
}

export async function retryRateLimited<T>(
  request: () => PromiseLike<T>,
  options: {
    signal?: AbortSignal;
    wait?: (milliseconds: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      const delay = rateLimitDelay(error, options.now?.() ?? Date.now());
      if (delay === undefined) throw error;
      // Retry the model request once, without replaying any executed tools.
      // Longer quota windows require user action rather than an indefinite wait.
      if (attempt === 1 || delay > 65_000) throw new RateLimitError();
      console.warn(`OpenRouter rate limit reached. Retrying in ${Math.ceil(delay / 1000)} seconds…`);
      if (options.wait) await options.wait(delay);
      else await sleep(delay, undefined, { signal: options.signal });
    }
  }
}

export const rateLimitMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v4',
  wrapGenerate: ({ doGenerate, params }) => retryRateLimited(doGenerate, { signal: params.abortSignal }),
  wrapStream: ({ doStream, params }) => retryRateLimited(doStream, { signal: params.abortSignal }),
};
