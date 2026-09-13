import Anthropic from '@anthropic-ai/sdk';
import { RUNNER } from '../../lib/config';
import type { Citation, ProviderAnswer } from '../../lib/types';

/**
 * Claude answer collection with the server-side web search tool.
 *
 * Two behaviours here are easy to get wrong and both are load-bearing:
 *
 * 1. Server-tool errors do NOT throw. A failed search comes back as HTTP 200 with a
 *    `web_search_tool_result` block whose `content` is an error OBJECT rather than the
 *    usual ARRAY of results. Indexing it blindly yields undefined, not an exception.
 * 2. `stop_reason: "pause_turn"` means the model paused mid-search and expects to be
 *    resumed by echoing its own content back. Treating it as a finished answer silently
 *    truncates the response.
 */

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ maxRetries: 0 }); // the runner owns retries
  return client;
}

const MAX_RESUMES = 3;

export async function askWithSearch(prompt: string, modelId: string): Promise<ProviderAnswer> {
  const started = Date.now();
  const anthropic = getClient();

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
  const textParts: string[] = [];
  const citations = new Map<string, Citation>();

  for (let turn = 0; turn <= MAX_RESUMES; turn++) {
    const response = await anthropic.messages.create(
      {
        model: modelId,
        max_tokens: RUNNER.maxAnswerTokens,
        // Adaptive, NOT disabled. With thinking off, Sonnet narrates its own search
        // into the visible answer ("Ah, the results are JSON strings…") and that
        // narration would be scored as if it were the answer. Adaptive keeps the
        // reasoning in `thinking` blocks, which we drop, leaving clean prose.
        // `display` stays at its default (omitted) so we are not billed for prose
        // we discard.
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
        messages,
      },
      { timeout: RUNNER.answerTimeoutMs }
    );

    collect(response.content, textParts, citations);

    if (response.stop_reason !== 'pause_turn') {
      return {
        text: textParts.join('').trim(),
        citations: [...citations.values()],
        modelId,
        latencyMs: Date.now() - started,
      };
    }

    // Resume: hand the model its own partial turn back verbatim.
    messages.push({ role: 'assistant', content: response.content });
  }

  return {
    text: textParts.join('').trim(),
    citations: [...citations.values()],
    modelId,
    latencyMs: Date.now() - started,
  };
}

function collect(
  blocks: Anthropic.ContentBlock[],
  textParts: string[],
  citations: Map<string, Citation>
) {
  for (const block of blocks) {
    if (block.type === 'text') {
      textParts.push(block.text);
      // Explicit citations attached to the prose — these are "cited".
      // TextCitation is a union; only the web-search variants carry a url.
      for (const c of block.citations ?? []) {
        if (!('url' in c) || typeof c.url !== 'string') continue;
        citations.set(c.url, {
          url: c.url,
          title: 'title' in c && typeof c.title === 'string' ? c.title : undefined,
          cited: true,
        });
      }
    } else if (block.type === 'web_search_tool_result') {
      const content = (block as { content: unknown }).content;
      // Error case: `content` is an object carrying error_code, not an array of results.
      if (!Array.isArray(content)) continue;
      for (const result of content as Array<Record<string, unknown>>) {
        const url = typeof result.url === 'string' ? result.url : null;
        if (!url || citations.has(url)) continue;
        citations.set(url, {
          url,
          title: typeof result.title === 'string' ? result.title : undefined,
          cited: false, // retrieved during search but not (yet) cited in prose
        });
      }
    }
  }
}
