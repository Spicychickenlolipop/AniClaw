import { generateText, type LanguageModel, type ModelMessage } from 'ai';
import { z } from 'zod';

const planSchema = z.object({
  researchSummary: z.string().optional(),
  steps: z.array(z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    hints: z.array(z.string()).optional(),
    complexity: z.enum(['low', 'medium', 'high']).optional(),
  })).min(1).max(15),
});

// Accept a JSON object inside prose or a code fence, but never accept an
// incomplete object or skip schema validation. Track strings so braces inside
// descriptions do not terminate the object early.
export function parsePlanOutput(text: string): z.infer<typeof planSchema> {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let end = start; end < text.length; end++) {
      const char = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try {
          const result = planSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
          if (result.success) return result.data;
        } catch { /* Try the next object, if present. */ }
        break;
      }
    }
  }
  throw new Error('The model did not return a valid plan with 1–15 nonempty steps.');
}

export async function formatPlan(model: LanguageModel, messages: ModelMessage[]) {
  const conversation: ModelMessage[] = [...messages, {
    role: 'user',
    content: [
      'Using the research above, return ONLY a JSON object with this shape:',
      '{"researchSummary":"brief findings","steps":[{"title":"step title","description":"concrete instructions","hints":["optional hint"],"complexity":"low"}]}',
      'Include 1–15 steps. Each title and description must be a nonempty string.',
      'researchSummary, hints, and complexity are optional. complexity must be low, medium, or high.',
      'Do not call tools. Do not include commentary or Markdown fences.',
    ].join('\n'),
  }];

  for (let attempt = 0; attempt < 2; attempt++) {
    // Plain text plus explicit validation also works with models that do not
    // support provider-enforced JSON schemas. API failures are not format retries.
    const result = await generateText({
      model,
      system: 'You format implementation plans as valid JSON. Follow the requested schema exactly.',
      messages: conversation,
    });
    try {
      return parsePlanOutput(result.text);
    } catch {
      if (attempt === 1) {
        throw new Error(`The model could not produce valid plan JSON after two attempts (finish reason: ${result.finishReason}). Try a model that reliably follows JSON instructions.`);
      }
      if (result.text.trim()) conversation.push({ role: 'assistant', content: result.text });
      conversation.push({ role: 'user', content: 'That response was empty, invalid JSON, or did not match the schema. Return the complete JSON object now, with 1–15 steps containing nonempty title and description strings.' });
    }
  }
  throw new Error('Plan formatting failed.');
}
