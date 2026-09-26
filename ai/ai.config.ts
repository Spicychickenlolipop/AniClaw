import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { wrapLanguageModel } from "ai";
import { rateLimitMiddleware } from "./rate-limit.ts";

export function getAgentModel() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const modelId = process.env.OPENROUTER_DEFAULT_MODEL?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing");
  if (!modelId) throw new Error("OPENROUTER_DEFAULT_MODEL is missing");

  const provider = createOpenRouter({ apiKey });
  return wrapLanguageModel({ model: provider(modelId), middleware: rateLimitMiddleware });
}
