import OpenAI from 'openai';
import { RUNNER } from '../../lib/config';
import type { Citation, ProviderAnswer } from '../../lib/types';

/**
 * GPT answer collection via the Responses API with the hosted web_search tool.
 *
 * Citations arrive as `url_citation` annotations hanging off the output text blocks;
 * the `web_search_call` items tell us a search happened but don't carry result URLs,
 * so unlike Claude and Gemini every URL we record here is genuinely cited.
 */

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ maxRetries: 0 }); // the runner owns retries
  return client;
}

export async function askWithSearch(prompt: string, modelId: string): Promise<ProviderAnswer> {
  const started = Date.now();

  const response = await getClient().responses.create(
    {
      model: modelId,
      input: prompt,
      tools: [{ type: 'web_search' }],
      max_output_tokens: RUNNER.maxAnswerTokens,
    },
    { timeout: RUNNER.answerTimeoutMs }
  );

  const citations = new Map<string, Citation>();
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type !== 'output_text') continue;
      for (const ann of part.annotations ?? []) {
        // Narrow the annotation union; only url_citation carries a web source.
        if (ann.type !== 'url_citation' || typeof ann.url !== 'string') continue;
        citations.set(ann.url, { url: ann.url, title: ann.title, cited: true });
      }
    }
  }

  return {
    text: (response.output_text ?? '').trim(),
    citations: [...citations.values()],
    modelId,
    latencyMs: Date.now() - started,
  };
}
