/// <reference types="bun" />
import { expect, mock, test } from 'bun:test';
import { rateLimitDelay, RateLimitError, retryRateLimited } from '../ai/rate-limit.ts';

const now = 1790434741000;
const limited = {
  statusCode: 429,
  responseHeaders: { 'x-ratelimit-reset': '1790434800000' },
};

test('uses the reset timestamp from the reported OpenRouter error', () => {
  expect(rateLimitDelay(limited, now)).toBe(60_000);
  expect(rateLimitDelay({ statusCode: 429, responseBody: JSON.stringify({
    error: { metadata: { headers: { 'X-RateLimit-Reset': '1790434800000' } } },
  }) }, now)).toBe(60_000);
});

test('honors Retry-After seconds and dates', () => {
  expect(rateLimitDelay({ statusCode: 429, responseHeaders: { 'retry-after': '10' } }, now)).toBe(11_000);
  expect(rateLimitDelay({ statusCode: 429, responseHeaders: { 'retry-after': new Date(now + 10_000).toUTCString() } }, now)).toBe(11_000);
});

test('waits for reset and retries only the failing model request', async () => {
  const request = mock(async () => 'ok').mockRejectedValueOnce(limited);
  const wait = mock(async (_ms: number) => {});
  expect(await retryRateLimited(request, { wait, now: () => now })).toBe('ok');
  expect(wait).toHaveBeenCalledWith(60_000);
  expect(request).toHaveBeenCalledTimes(2);
});

test('persistent rate limiting stops after one retry with a clear error', async () => {
  const request = mock(async () => { throw limited; });
  const wait = mock(async (_ms: number) => {});
  await expect(retryRateLimited(request, { wait, now: () => now })).rejects.toBeInstanceOf(RateLimitError);
  expect(request).toHaveBeenCalledTimes(2);
  expect(wait).toHaveBeenCalledTimes(1);
});

test('does not wait through long quota windows or retry unrelated errors', async () => {
  const wait = mock(async (_ms: number) => {});
  await expect(retryRateLimited(async () => { throw { statusCode: 429, responseHeaders: { 'retry-after': '3600' } }; }, { wait })).rejects.toBeInstanceOf(RateLimitError);
  const unauthorized = { statusCode: 401 };
  await expect(retryRateLimited(async () => { throw unauthorized; }, { wait })).rejects.toBe(unauthorized);
  expect(wait).not.toHaveBeenCalled();
});

test('malformed reset information falls back to a minute', () => {
  expect(rateLimitDelay({ statusCode: 429, responseBody: 'invalid' }, now)).toBe(60_000);
});
