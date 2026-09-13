import { RUNNER } from '../../lib/config';
import type { Citation, ProviderAnswer } from '../../lib/types';

/**
 * Gemini answer collection with Google Search grounding.
 *
 * Deliberately raw REST rather than @google/genai: the v2 SDK surface differs
 * substantially from its documented predecessor and we verified this endpoint shape
 * directly (see DECISIONS.md). Auth goes in the `x-goog-api-key` header, never a
 * `?key=` query parameter, so the key stays out of access logs and proxy traces.
 *
 * Grounding metadata gives us both halves of the cited/used distinction:
 *   groundingChunks[]  — every page retrieved  (used)
 *   groundingSupports[] — chunks actually backing a sentence (cited)
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: GroundingChunk[];
      groundingSupports?: Array<{ groundingChunkIndices?: number[] }>;
    };
  }>;
  error?: { message?: string; status?: string };
}

export async function askWithSearch(prompt: string, modelId: string): Promise<ProviderAnswer> {
  const started = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNNER.answerTimeoutMs);

  let json: GeminiResponse;
  try {
    const res = await fetch(`${ENDPOINT}/${modelId}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { maxOutputTokens: RUNNER.maxAnswerTokens },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 300);
      // Surface the status so the runner's retry/fallback logic can classify it.
      const err = new Error(`gemini HTTP ${res.status}: ${body}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    json = (await res.json()) as GeminiResponse;
  } finally {
    clearTimeout(timer);
  }

  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();

  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const citedIndices = new Set<number>();
  for (const support of candidate?.groundingMetadata?.groundingSupports ?? []) {
    for (const i of support.groundingChunkIndices ?? []) citedIndices.add(i);
  }

  const citations = new Map<string, Citation>();
  chunks.forEach((chunk, i) => {
    const url = chunk.web?.uri;
    if (!url) return;
    const existing = citations.get(url);
    const cited = citedIndices.has(i) || existing?.cited === true;
    citations.set(url, { url, title: chunk.web?.title, cited });
  });

  return { text, citations: [...citations.values()], modelId, latencyMs: Date.now() - started };
}
