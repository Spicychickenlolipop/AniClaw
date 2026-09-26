/// <reference types="bun" />
import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { Plan } from '../modes/plan/types.ts';
import { RateLimitError } from '../ai/rate-limit.ts';

const plan: Plan = {
  goal: 'Fix user_profile [settings]',
  steps: [
    { id: 'step-1', title: 'Update user_profile *', description: 'Update the profile.' },
    { id: 'step-2', title: 'Check [settings]', description: 'Verify the settings.' },
  ],
};
const cancel = Symbol('cancel');
const confirm = mock(async (): Promise<boolean | symbol> => true);
const generatePlan = mock(async () => plan);
const selectSteps = mock(async () => plan.steps);
const approve = mock(async () => true);
const generate = mock(async (_options: unknown) => ({ text: 'Completed user_profile [settings] *' }));
const agentOptions: any[] = [];
const ai = await import('ai');
mock.module('ai', () => ({
  ...ai,
  ToolLoopAgent: class {
    constructor(options: unknown) { agentOptions.push(options); }
    generate = generate;
  },
}));
mock.module('@clack/prompts', () => ({
  text: async () => plan.goal,
  confirm,
  isCancel: (value: unknown) => typeof value === 'symbol',
}));
mock.module('../modes/plan/planner.ts', () => ({ generatePlan }));
mock.module('../modes/plan/selection.ts', () => ({ printPlan: () => {}, selectSteps }));
mock.module('../modes/agent/approval.ts', () => ({ runApprovalFlow: approve }));
mock.module('../modes/telegram/auth.ts', () => ({ isOwner: () => true }));
const finishOrApprove = mock(async (..._args: unknown[]) => {});
mock.module('../modes/telegram/approval-session.ts', () => ({
  finishOrApprove, approvalSessions: new Map(), approvalDiff: () => '',
}));

const { ToolExecutor } = await import('../modes/agent/tool-executor.ts');
const { runPlanMode } = await import('../modes/plan/orchestrator.ts');
const { registerHandlers } = await import('../modes/telegram/handlers.ts');
const { planMessage, planSessions, refreshPlanUi } = await import('../modes/telegram/plan-session.ts');
const { getAgentModel } = await import('../ai/ai.config.ts');
const apply = spyOn(ToolExecutor.prototype, 'applyApprovedFromTracker').mockReturnValue({ errors: [] });
const clear = spyOn(ToolExecutor.prototype, 'clearStaging');
const log = spyOn(console, 'log').mockImplementation(() => {});
const errorLog = spyOn(console, 'error').mockImplementation(() => {});
const savedEnv = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_DEFAULT_MODEL: process.env.OPENROUTER_DEFAULT_MODEL,
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
};
const commands = new Map<string, (ctx: any) => Promise<unknown>>();
const actions = new Map<string, (ctx: any) => Promise<unknown>>();
registerHandlers({
  command: (name: string, handler: any) => commands.set(name, handler),
  action: (name: string | RegExp, handler: any) => actions.set(String(name), handler),
} as any);

function context() {
  return {
    chat: { id: 1 }, message: { text: `/plan ${plan.goal}` },
    reply: mock(async (_text: string, _options?: object) => ({})),
    editMessageText: mock(async (_text: string, _options?: object) => ({})),
    answerCbQuery: mock(async (_text?: string) => true),
  };
}

beforeEach(() => {
  for (const fn of [confirm, generatePlan, selectSteps, approve, generate, finishOrApprove, apply, clear, errorLog]) fn.mockClear();
  confirm.mockImplementation(async () => true);
  generatePlan.mockImplementation(async () => plan);
  selectSteps.mockImplementation(async () => plan.steps);
  approve.mockImplementation(async () => true);
  generate.mockImplementation(async () => ({ text: 'Completed user_profile [settings] *' }));
  agentOptions.length = 0;
  planSessions.clear();
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_DEFAULT_MODEL = 'test-model';
  delete process.env.FIRECRAWL_API_KEY;
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  log.mockRestore();
  errorLog.mockRestore();
  apply.mockRestore();
  clear.mockRestore();
});

describe('CLI Plan mode', () => {
  test('executes every step and reaches approval even when the agent returns text', async () => {
    await runPlanMode();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0]).toEqual({ prompt: expect.stringContaining(plan.steps[1]!.description) });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(agentOptions[0].tools.web_search).toBeUndefined();
  });

  for (const answer of [false, cancel]) {
    test(`does not execute after ${String(answer)}`, async () => {
      confirm.mockImplementation(async () => answer);
      await runPlanMode();
      expect(generate).not.toHaveBeenCalled();
      expect(approve).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
    });
  }

  test('rejected changes are cleared without being applied', async () => {
    approve.mockImplementation(async () => false);
    await runPlanMode();
    expect(apply).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  test('reports generation failures without crashing the menu', async () => {
    generatePlan.mockImplementation(async () => { throw new Error('Provider unavailable'); });
    await runPlanMode();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Provider unavailable'));
    expect(generate).not.toHaveBeenCalled();
  });

  test('clears staging and does not apply partial work after execution failure', async () => {
    generate.mockImplementation(async () => { throw new Error('Execution failed'); });
    await runPlanMode();
    expect(apply).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Execution failed'));
  });
});

describe('Telegram Plan mode', () => {
  test('sends and refreshes plan text without Markdown parsing', async () => {
    const ctx = context();
    await commands.get('plan')!(ctx);
    expect(ctx.reply.mock.calls[1]?.[0]).toContain(plan.goal);
    expect(ctx.reply.mock.calls[1]?.[1]).not.toHaveProperty('parse_mode');
    await refreshPlanUi(ctx, planSessions.get(1)!);
    expect(ctx.editMessageText.mock.calls[0]?.[1]).not.toHaveProperty('parse_mode');
  });

  test('reports generation failures to the chat', async () => {
    generatePlan.mockImplementation(async () => { throw new Error('Provider unavailable'); });
    const ctx = context();
    await commands.get('plan')!(ctx);
    expect(ctx.reply.mock.calls.at(-1)?.[0]).toContain('Could not generate');
    expect(planSessions.has(1)).toBe(false);
  });

  test('explains persistent provider rate limits in the chat', async () => {
    generatePlan.mockImplementation(async () => { throw new RateLimitError(); });
    const ctx = context();
    await commands.get('plan')!(ctx);
    expect(ctx.reply.mock.calls.at(-1)?.[0]).toContain('OpenRouter is still rate-limiting');
  });

  test('executes all steps and reaches approval with Markdown characters in output', async () => {
    const ctx = context();
    planSessions.set(1, { plan, selected: new Set(plan.steps.map(s => s.id)) });
    await actions.get('plan_proceed')!(ctx);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(finishOrApprove).toHaveBeenCalledTimes(1);
    for (const call of ctx.reply.mock.calls) expect(call[1]).not.toHaveProperty('parse_mode');
  });

  test('reports execution failures to the chat', async () => {
    const ctx = context();
    planSessions.set(1, { plan, selected: new Set(['step-1']) });
    generate.mockImplementation(async () => { throw new Error('Execution failed'); });
    await actions.get('plan_proceed')!(ctx);
    expect(ctx.reply.mock.calls.at(-1)?.[0]).toContain('Plan execution failed');
    expect(finishOrApprove).not.toHaveBeenCalled();
  });

  test('repeated select/deselect actions do not send unchanged edits', async () => {
    const ctx = context();
    planSessions.set(1, { plan, selected: new Set(plan.steps.map(s => s.id)) });
    await actions.get('plan_all')!(ctx);
    expect(ctx.editMessageText).not.toHaveBeenCalled();
    await actions.get('plan_none')!(ctx);
    await actions.get('plan_none')!(ctx);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
  });

  test('bounds long goals and titles while retaining every step', () => {
    const longPlan = { goal: 'x'.repeat(10000), steps: Array.from({ length: 15 }, (_, i) => ({
      id: `step-${i + 1}`, title: 'x'.repeat(10000), description: '', complexity: 'medium' as const,
    })) };
    const message = planMessage({ plan: longPlan, selected: new Set() });
    expect(message.length).toBeLessThan(4096);
    expect(message).toContain('15.');
  });
});

test('model configuration reports missing required settings', () => {
  delete process.env.OPENROUTER_DEFAULT_MODEL;
  expect(getAgentModel).toThrow('OPENROUTER_DEFAULT_MODEL is missing');
  delete process.env.OPENROUTER_API_KEY;
  expect(getAgentModel).toThrow('OPENROUTER_API_KEY is missing');
});
