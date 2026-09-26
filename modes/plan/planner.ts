import {
  generateText,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";
import chalk from "chalk";
import { getAgentModel } from "../../ai/ai.config.ts";
import { ActionTracker } from "../agent/action-tracker.ts";
import { ToolExecutor } from "../agent/tool-executor.ts";
import { defaultAgentConfig } from "../agent/types.ts";
import type { Plan, PlanStep } from "./types.ts";
import { createWebTools } from "./web-tools.ts";
import { formatPlan } from "./plan-output.ts";

function readOnlyTools(executor: ToolExecutor) {
  return {
    read_file: tool({
      description:
        "Read a text file from the workspace. Use a path relative to the project root.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
      }),
      execute: async ({ path: p }) => executor.readFile(p),
    }),

    list_files: tool({
      description: "List files and directories under a path.",
      inputSchema: z.object({
        path: z.string(),
        recursive: z.boolean().optional().default(false),
      }),
      execute: async ({ path: p, recursive }) =>
        executor.listFiles(p, recursive),
    }),

    search_files: tool({
      description:
        'Find files matching a glob pattern (e.g. "*.ts", "**/*.md"). Optional content substring filter.',
      inputSchema: z.object({
        root: z.string().describe("Directory to search, relative to root"),
        pattern: z
          .string()
          .describe("Glob-like pattern using * and ** (forward slashes)"),
        content_contains: z.string().optional(),
      }),
      execute: async ({ root, pattern, content_contains }) =>
        executor.searchFiles(root, pattern, content_contains),
    }),

    analyze_codebase: tool({
      description:
        "Summarize structure: file counts, size, extensions. Read-only.",
      inputSchema: z.object({
        path: z.string().default("."),
      }),
      execute: async ({ path: p }) => executor.analyzeCodebase(p),
    }),

    list_skills: tool({
      description:
        "List absolute paths to SKILL.md files under configured skill directories (Cursor / Claude).",
      inputSchema: z.object({}),
      execute: async () => executor.listSkills(),
    }),

    read_skill: tool({
      description:
        "Read a SKILL.md file. Path must be absolute and under skill roots, or use a path returned by list_skills.",
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async ({ path: p }) => executor.readSkill(p),
    }),
  };
}

const PLAN_INSTRUCTIONS = (codebase: string, hasWeb: boolean) =>
  [
    "You are a Plan-Mode planner. You DO NOT modify files.",
    `Workspace: ${codebase}`,
    "Use read-only tools for codebase/skills research.",
    hasWeb
      ? "Web tools are available (web_search/web_crawl/fetch_url). Use only when needed."
      : "Web tools are unavailable (no FIRECRAWL_API_KEY).",
    "Finish with concise research findings and a proposed implementation plan in plain text.",
    "Keep research focused and batch independent tool calls. Do not modify files.",
  ].join("\n");

export async function generatePlan(goal: string): Promise<Plan> {
  const config = defaultAgentConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);


  const hasWeb = !!process.env.FIRECRAWL_API_KEY;
  const model = getAgentModel();


  const tools = { ...readOnlyTools(executor) , ...(hasWeb ? createWebTools(tracker) : {}) };

  console.log(chalk.cyan("\n🔍 Researching & drafting a plan…\n"));

  const result = await generateText({
    model,
    tools,
    stopWhen:stepCountIs(8),
    prepareStep: ({ stepNumber }) => stepNumber === 7 ? { toolChoice: 'none' } : {},
    system:PLAN_INSTRUCTIONS(config.codebasePath , hasWeb),
    prompt:`User goal: \n${goal}`,
  });

  console.log(chalk.cyan("\n📋 Formatting the plan…\n"));
  const validated = await formatPlan(model, [
    { role: 'user', content: `User goal: \n${goal}` },
    ...result.response.messages,
  ]);

  const steps:PlanStep[] = validated.steps.map((s , i)=>({
    id:`step-${i+1}`,
    title:s.title,
    description:s.description,
    hints:s.hints,
    complexity:s.complexity
  }));

  return {goal , researchSummary:validated.researchSummary , steps}
}
