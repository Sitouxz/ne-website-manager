import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getActiveWorkspace } from '@/lib/workspace';
import {
  SUGGESTION_SCHEMA,
  SYSTEM_PROMPT,
  buildPrompt,
  clampSuggestion,
  isSuggestionEnabled,
  type SuggestionKind,
  type SuggestionResult,
} from '@/lib/ai/suggest';

/**
 * Suggests alt text and search metadata for content the editor is looking at.
 *
 * ## Why a server route
 *
 * The API key is server-only and must never reach the browser — the same
 * rule the service-role key follows. The editor posts what it has on screen
 * and gets back a string; nothing about the model is visible client-side,
 * which also means the model can be changed here without touching any
 * component.
 *
 * ## Authorisation
 *
 * Signed in, with a selected workspace. That is deliberately the whole bar:
 * this endpoint reads no tenant data (the caller supplies the content) and
 * writes nothing. What it does spend is money, so it is closed to anonymous
 * callers and rate-limited per user.
 *
 * ## Suggestion only
 *
 * The response is never persisted. The editor decides whether it becomes
 * content, and the ordinary save path applies — so a suggestion is subject
 * to exactly the same validation and publish checks as anything typed by
 * hand.
 */

const MODEL = 'claude-opus-5';

/**
 * Deliberately short outputs: alt text is capped at 125 characters and a
 * search description at 155, so the usual 16k default would only ever buy
 * headroom for a runaway. Thinking is off (permitted at the default `high`
 * effort and below) because there is no multi-step reasoning here — the
 * structured schema fixes the output shape, and the task is a single
 * description.
 */
const MAX_TOKENS = 1024;

const KINDS: SuggestionKind[] = ['alt', 'seo-description', 'seo-title'];

/**
 * Per-user, per-process ceiling. Not a security boundary — a serverless
 * deployment runs several instances — but enough that a stuck client
 * retrying in a loop cannot quietly run up a bill before anyone notices.
 * The tenant-facing protection is that the endpoint requires a session.
 */
const RATE_LIMIT_PER_MINUTE = 20;
const recentCalls = new Map<string, number[]>();

function withinRateLimit(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - 60_000;
  const calls = (recentCalls.get(userId) ?? []).filter((t) => t > cutoff);
  if (calls.length >= RATE_LIMIT_PER_MINUTE) return false;
  calls.push(now);
  recentCalls.set(userId, calls);
  return true;
}

interface Body {
  kind?: unknown;
  imageUrl?: unknown;
  context?: { title?: unknown; body?: unknown };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

export async function POST(req: Request) {
  if (!isSuggestionEnabled()) {
    return NextResponse.json(
      { error: 'Suggestions are not switched on for this installation.' },
      { status: 503 },
    );
  }

  const { user, activeClient } = await getActiveWorkspace();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (!withinRateLimit(user.id)) {
    return NextResponse.json({ error: 'Too many suggestions at once. Try again in a minute.' }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const kind = body.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as SuggestionKind)) {
    return NextResponse.json({ error: `kind must be one of: ${KINDS.join(', ')}.` }, { status: 400 });
  }

  const imageUrl = str(body.imageUrl);
  if (kind === 'alt' && !imageUrl) {
    return NextResponse.json({ error: 'An image is needed to describe.' }, { status: 400 });
  }

  const prompt = buildPrompt({
    kind: kind as SuggestionKind,
    imageUrl,
    context: {
      title: str(body.context?.title),
      body: str(body.context?.body),
      siteName: activeClient?.name,
    },
  });

  // For alt text the picture is the whole point — sending only the
  // surrounding words would produce a plausible description of the wrong
  // image, which is worse than no description at all.
  const content: Anthropic.ContentBlockParam[] =
    kind === 'alt' && imageUrl
      ? [{ type: 'image', source: { type: 'url', url: imageUrl } }, { type: 'text', text: prompt }]
      : [{ type: 'text', text: prompt }];

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      thinking: { type: 'disabled' },
      output_config: { format: { type: 'json_schema', schema: SUGGESTION_SCHEMA } },
      messages: [{ role: 'user', content }],
    });

    // A refusal or a truncation is a normal outcome, not an exception — both
    // arrive as a 200 with content that is not what was asked for, so they
    // are checked before anything is parsed.
    if (response.stop_reason === 'refusal') {
      return NextResponse.json(
        { error: 'The assistant declined to describe this one. Please write it yourself.' },
        { status: 422 },
      );
    }

    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({ error: 'No suggestion came back. Try again.' }, { status: 502 });
    }

    let parsed: SuggestionResult;
    try {
      parsed = JSON.parse(text.text) as SuggestionResult;
    } catch {
      return NextResponse.json({ error: 'The suggestion came back malformed. Try again.' }, { status: 502 });
    }

    const result = clampSuggestion(parsed, kind as SuggestionKind);
    if (!result.usable) {
      return NextResponse.json(
        { error: 'There was not enough here to describe accurately. Please write it yourself.' },
        { status: 422 },
      );
    }

    return NextResponse.json({ suggestion: result.suggestion });
  } catch (error) {
    // Typed SDK errors, most specific first — a rate limit is the caller's
    // cue to wait, everything else is ours to look at.
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Busy right now. Try again in a moment.' }, { status: 429 });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      console.error('AI suggestions: invalid ANTHROPIC_API_KEY');
      return NextResponse.json({ error: 'Suggestions are misconfigured. Contact Neu Entity.' }, { status: 503 });
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return NextResponse.json({ error: 'Could not reach the assistant. Try again.' }, { status: 504 });
    }
    if (error instanceof Anthropic.APIError) {
      console.error('AI suggestions: API error', error.status, error.message);
      return NextResponse.json({ error: 'The suggestion could not be generated.' }, { status: 502 });
    }
    throw error;
  }
}
