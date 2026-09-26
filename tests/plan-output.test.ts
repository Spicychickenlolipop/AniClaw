/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { formatPlan, parsePlanOutput } from '../modes/plan/plan-output.ts';

const plan = { steps: [{ title: 'Fix parser', description: 'Handle braces { } and "quoted" strings.' }] };
const json = JSON.stringify(plan);
function response(text: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  };
}

test('parses plain, fenced, and prose-wrapped JSON with braces in strings', () => {
  for (const text of [json, `\`\`\`json\n${json}\n\`\`\``, `Here is the plan:\n${json}\nDone.`]) {
    expect(parsePlanOutput(text)).toEqual(plan);
  }
});

test('rejects empty, truncated, and schema-invalid plans', () => {
  for (const text of ['', 'First inspect the code.', json.slice(0, -1), '{"steps":[]}', '{"steps":[{"title":" ","description":"x"}]}']) {
    expect(() => parsePlanOutput(text)).toThrow();
  }
});

test('formats using a separate text request without tools or provider JSON mode', async () => {
  const model = new MockLanguageModelV4({ doGenerate: response(json) });
  expect(await formatPlan(model, [{ role: 'user', content: 'Fix the parser' }])).toEqual(plan);
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(model.doGenerateCalls[0]?.responseFormat?.type).not.toBe('json');
  expect(model.doGenerateCalls[0]?.tools ?? []).toHaveLength(0);
});

test('repairs invalid output once with the original research retained', async () => {
  const model = new MockLanguageModelV4({ doGenerate: [response('Here is a prose plan.'), response(json)] });
  expect(await formatPlan(model, [{ role: 'user', content: 'Research: parser fails on braces.' }])).toEqual(plan);
  expect(model.doGenerateCalls).toHaveLength(2);
  expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain('Research: parser fails on braces.');
});

test('stops after two invalid responses and gives an actionable error', async () => {
  const model = new MockLanguageModelV4({ doGenerate: [response(''), response('Still not JSON')] });
  await expect(formatPlan(model, [])).rejects.toThrow('after two attempts');
  expect(model.doGenerateCalls).toHaveLength(2);
});

test('provider failures are not retried as formatting errors', async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('Provider unavailable'); } });
  await expect(formatPlan(model, [])).rejects.toThrow('Provider unavailable');
  expect(model.doGenerateCalls).toHaveLength(1);
});
