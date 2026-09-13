import Anthropic from '@anthropic-ai/sdk';
import { EXTRACTION_MODEL } from '../lib/config';
import type { Brand, ExtractionResult, ExtractedMention, Sentiment } from '../lib/types';

/**
 * Turn one answer into structured mentions.
 *
 * This is the measurement instrument of the whole product, so it is held to an eval
 * (`npm run eval`) against hand-labelled answers rather than trusted by inspection.
 *
 * Design choices that matter:
 *   - `strict: true` on the tool schema, so `input` is guaranteed to validate and we
 *     never hand-parse malformed JSON.
 *   - Positions are renumbered here from first-appearance order rather than trusting
 *     the model's arithmetic — models are good at spotting brands, less reliable at
 *     counting them.
 *   - Brand names are snapped back to the exact configured spelling, so a stray
 *     "Langsmith" can never create a second brand in the database.
 */

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ maxRetries: 1 });
  return client;
}

const TOOL: Anthropic.Tool = {
  name: 'record_mentions',
  description: 'Record every tracked brand mentioned in the answer, in order of first appearance.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      mentions: {
        type: 'array',
        description: 'One entry per tracked brand that is mentioned. Omit brands that are absent.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            brand: {
              type: 'string',
              description: 'Exactly one of the tracked brand names supplied in the prompt.',
            },
            first_char_index: {
              type: 'integer',
              description: 'Character offset where this brand is first named in the answer.',
            },
            sentiment: {
              type: 'integer',
              enum: [-1, 0, 1],
              description:
                'How this answer characterises this brand: 1 positive/recommended, 0 neutral/descriptive, -1 negative/cautioned against.',
            },
            quote: {
              type: 'string',
              description: 'A short verbatim snippet (max ~25 words) supporting the sentiment.',
            },
          },
          required: ['brand', 'first_char_index', 'sentiment', 'quote'],
        },
      },
      other_brands: {
        type: 'array',
        description:
          'Product or company names in the same category that appear in the answer but are NOT in the tracked list. Empty if none.',
        items: { type: 'string' },
      },
    },
    required: ['mentions', 'other_brands'],
  },
};

const SYSTEM = `You extract brand mentions from AI-generated answers for a competitive analytics tool.

Rules:
- Only record brands from the tracked list you are given. Match case-insensitively and allow
  possessives, plurals and the listed aliases. An alias match counts as the canonical brand.
- A brand counts as mentioned only if the answer actually refers to the product or company.
  A word that merely resembles a brand name in ordinary prose does not count.
- NEVER record a brand because it plausibly belongs in an answer like this one. The only
  question is whether its name (or a listed alias) literally appears in the text. If you
  cannot point to the characters, it is not a mention. Answers about this category often
  omit well-known tools, and recording one that is absent shifts the reported rank of every
  brand that follows it.
- first_char_index is the offset of the FIRST time that brand is named in the answer text.
- sentiment describes only what THIS answer says about THAT brand, not your own opinion.
  Recommended, praised, or presented as a best choice is 1. Listed or described factually is 0.
  Criticised, warned about, or framed as a worse option is -1.
- other_brands collects same-category products or vendors that are NOT on the tracked list.
  Do not put tracked brands there. Do not invent names.
- Call the record_mentions tool exactly once. Never answer in prose.`;

export async function extractMentions(
  answerText: string,
  brands: Brand[]
): Promise<ExtractionResult> {
  if (!answerText.trim()) return { mentions: [], other_brands: [] };

  const roster = brands
    .map((b) => (b.aliases.length ? `- ${b.name} (aliases: ${b.aliases.join(', ')})` : `- ${b.name}`))
    .join('\n');

  const response = await getClient().messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'record_mentions' },
    messages: [
      {
        role: 'user',
        content: `Tracked brands:\n${roster}\n\n--- ANSWER START ---\n${answerText}\n--- ANSWER END ---`,
      },
    ],
  });

  const call = response.content.find((b) => b.type === 'tool_use');
  if (!call || call.type !== 'tool_use') return { mentions: [], other_brands: [] };

  const raw = call.input as {
    mentions?: Array<{ brand?: string; first_char_index?: number; sentiment?: number; quote?: string }>;
    other_brands?: string[];
  };

  // Snap model-supplied names back to the configured spelling; drop anything unrecognised.
  const canonical = new Map<string, string>();
  for (const b of brands) {
    canonical.set(b.name.toLowerCase(), b.name);
    for (const alias of b.aliases) canonical.set(alias.toLowerCase(), b.name);
  }

  const seen = new Set<string>();
  const ordered = (raw.mentions ?? [])
    .map((m) => ({
      brand: canonical.get(String(m.brand ?? '').trim().toLowerCase()),
      at: typeof m.first_char_index === 'number' ? m.first_char_index : Number.MAX_SAFE_INTEGER,
      sentiment: clampSentiment(m.sentiment),
      quote: typeof m.quote === 'string' ? m.quote.slice(0, 400) : '',
    }))
    .filter((m): m is { brand: string; at: number; sentiment: Sentiment; quote: string } => {
      if (!m.brand || seen.has(m.brand)) return false;
      seen.add(m.brand);
      return true;
    })
    .sort((a, b) => a.at - b.at);

  const mentions: ExtractedMention[] = ordered.map((m, i) => ({
    brand: m.brand,
    order: i + 1, // authoritative position, recomputed from first-appearance order
    sentiment: m.sentiment,
    quote: m.quote,
  }));

  const tracked = new Set(brands.map((b) => b.name.toLowerCase()));
  const other_brands = [
    ...new Set(
      (raw.other_brands ?? [])
        .map((s) => String(s).trim())
        .filter((s) => s.length > 1 && s.length < 60 && !tracked.has(s.toLowerCase()))
    ),
  ];

  return { mentions, other_brands };
}

function clampSentiment(value: unknown): Sentiment {
  return value === 1 || value === -1 ? value : 0;
}
