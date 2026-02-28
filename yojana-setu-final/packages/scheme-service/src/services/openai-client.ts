import OpenAI from 'openai';
import { OpenAIError } from '@yojana-setu/shared';
import { logger } from '../config/logger';

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new OpenAIError('OPENAI_API_KEY is not set');
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

const MODEL = process.env['OPENAI_MODEL'] ?? 'gpt-4-turbo-preview';

// ─── Text Completion ──────────────────────────────────────────────────────────

export async function chatComplete(
  systemPrompt: string,
  userPrompt: string,
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const { maxTokens = 1000, temperature = 0.3 } = options;

  try {
    const response = await getClient().chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new OpenAIError('Empty response from OpenAI');

    logger.debug('OpenAI completion', {
      model: MODEL,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
    });

    return content;
  } catch (err) {
    if (err instanceof OpenAIError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new OpenAIError(`OpenAI API call failed: ${message}`);
  }
}

// ─── JSON Completion ──────────────────────────────────────────────────────────

/**
 * Calls GPT-4 and parses the response as JSON.
 * Strips markdown code fences if present.
 */
export async function chatCompleteJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  options: { maxTokens?: number } = {},
): Promise<T> {
  const raw = await chatComplete(systemPrompt, userPrompt, {
    ...options,
    temperature: 0.1, // Lower temp for structured output
  });

  // Strip ```json ... ``` fences if GPT adds them
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(clean) as T;
  } catch {
    throw new OpenAIError('OpenAI returned invalid JSON', { raw });
  }
}
