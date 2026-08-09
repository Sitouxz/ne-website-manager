/**
 * Turns whatever a failing call throws — a Supabase `PostgrestError`, an auth
 * error, a `fetch` rejection, a thrown `Error`, a bare string — into something
 * a non-technical person can act on.
 *
 * The CMS is used by mosque administrators, property agents and office
 * managers, not developers. Before this module, a duplicate blog slug surfaced
 * as `duplicate key value violates unique constraint "posts_client_id_slug_key"`
 * and an RLS denial as `new row violates row-level security policy for table
 * "posts"`. Neither tells the reader what they did or what to do next.
 *
 * Every result has a `message` that is always safe to show, and an optional
 * `detail` carrying the original technical text. UI should show `message` and
 * tuck `detail` behind a "Technical details" disclosure — support still needs
 * the raw string, the person writing a blog post does not.
 *
 * Design notes:
 *  - Matching is on Postgres SQLSTATE codes first (stable), message text only
 *    as a fallback (Supabase/PostgREST wording changes between versions).
 *  - Unrecognised errors get a generic message plus the raw text as `detail`,
 *    never a raw dump as the headline. A wrong-but-calm message beats an
 *    accurate-but-unreadable one for this audience.
 *  - Pure and dependency-free so it can be used from both `'use client'`
 *    editors and server route handlers.
 */

export interface FriendlyError {
  /** Plain-language, always safe to show to any user. */
  message: string;
  /** Original technical text, for a collapsed "Technical details" disclosure. */
  detail?: string;
}

/**
 * What the user was acting on, used to make messages concrete
 * ("A post with this web address already exists" rather than "Already exists").
 * Pass the singular, lowercase noun the UI itself uses — `'post'`, `'page'`,
 * `'property'`, `'image'`, `'form'`.
 */
export interface ErrorContext {
  entity?: string;
  /** What the user was trying to do, when it isn't a save — e.g. `'delete'`. */
  action?: 'save' | 'delete' | 'upload' | 'load';
}

/** Shape of a Supabase/PostgREST error. Structural, so no import is needed. */
interface PostgrestLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  status?: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asPostgrestLike(err: unknown): PostgrestLike | null {
  if (!isRecord(err)) return null;
  const { code, message, details, hint, status } = err;
  const has = (v: unknown) => typeof v === 'string' || typeof v === 'number';
  if (!has(code) && !has(message) && !has(status)) return null;
  return {
    code: typeof code === 'string' ? code : null,
    message: typeof message === 'string' ? message : null,
    details: typeof details === 'string' ? details : null,
    hint: typeof hint === 'string' ? hint : null,
    status: typeof status === 'number' ? status : null,
  };
}

/** Raw technical text for the `detail` disclosure, or undefined when there's nothing useful. */
function rawText(err: unknown): string | undefined {
  if (typeof err === 'string') return err || undefined;
  const pg = asPostgrestLike(err);
  if (pg) {
    const parts = [pg.code ? `[${pg.code}]` : null, pg.message, pg.details, pg.hint].filter(Boolean);
    return parts.length ? parts.join(' — ') : undefined;
  }
  if (err instanceof Error) return err.message || undefined;
  return undefined;
}

const ENTITY_FALLBACK = 'item';

/** "post" -> "A post", "image" -> "An image". */
function indefinite(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `An ${noun}` : `A ${noun}`;
}

/**
 * Recovers a human noun from a Postgres constraint name when the caller didn't
 * pass one — `posts_client_id_slug_key` -> `post`. Best-effort only.
 */
function entityFromConstraint(text: string): string | null {
  const match = /constraint "([a-z_]+)"/i.exec(text);
  if (!match) return null;
  const table = match[1].split('_')[0];
  if (!table) return null;
  const singular: Record<string, string> = {
    posts: 'post',
    pages: 'page',
    properties: 'property',
    media: 'image',
    collections: 'collection',
    collection: 'entry',
    clients: 'client',
    profiles: 'team member',
    forms: 'form',
    redirects: 'redirect',
  };
  return singular[table] ?? null;
}

/**
 * Which field a unique violation was about, phrased the way the UI labels it.
 * `slug`/`path` are shown to users as "web address", never as "slug".
 */
function uniqueFieldPhrase(text: string): string {
  if (/slug|path/i.test(text)) return 'web address';
  if (/email/i.test(text)) return 'email address';
  return 'name';
}

function friendly(message: string, err: unknown): FriendlyError {
  const detail = rawText(err);
  return detail ? { message, detail } : { message };
}

/**
 * Converts any thrown value into a `FriendlyError`.
 *
 * @param err Whatever was caught, or a Supabase `{ error }` value.
 * @param ctx Optional nouns that make the message concrete.
 */
export function humanizeError(err: unknown, ctx: ErrorContext = {}): FriendlyError {
  if (err == null) {
    return { message: 'Something went wrong. Please try again.' };
  }

  const pg = asPostgrestLike(err);
  const text = [pg?.message, pg?.details, pg?.hint].filter(Boolean).join(' ')
    || (err instanceof Error ? err.message : typeof err === 'string' ? err : '');
  const code = pg?.code ?? '';

  const entity = ctx.entity ?? entityFromConstraint(text) ?? ENTITY_FALLBACK;

  // --- Offline / unreachable -------------------------------------------------
  // A `fetch` rejection is a TypeError with a browser-specific message; treat
  // any of them as "you're offline", which is nearly always the real cause.
  if (err instanceof TypeError && /fetch|network/i.test(text)) {
    return friendly("Couldn't reach the server. Check your internet connection and try again.", err);
  }
  if (isRecord(err) && err.name === 'AbortError') {
    return friendly('That took too long and was stopped. Please try again.', err);
  }

  // --- Permission ------------------------------------------------------------
  // RLS denials arrive as 42501, and also as a plain message on some paths.
  if (code === '42501' || /row-level security|insufficient privilege|permission denied/i.test(text)) {
    const doing = ctx.action === 'delete' ? 'delete this' : 'make that change';
    return friendly(
      `You don't have permission to ${doing}. Ask your site administrator if you need access.`,
      err
    );
  }

  // --- Session ---------------------------------------------------------------
  if (code === 'PGRST301' || /jwt expired|invalid jwt|token .*expired/i.test(text)) {
    return friendly('Your session has expired. Please sign in again.', err);
  }
  if (/invalid login credentials/i.test(text)) {
    return friendly("That email or password isn't right. Please check and try again.", err);
  }
  if (/email not confirmed/i.test(text)) {
    return friendly('Please confirm your email address first — check your inbox for the link.', err);
  }

  // --- Conflicts and validation ---------------------------------------------
  if (code === '23505' || /duplicate key|already exists/i.test(text)) {
    const field = uniqueFieldPhrase(text);
    return friendly(
      `${indefinite(entity)} with this ${field} already exists. Please choose a different one.`,
      err
    );
  }
  if (code === '23503') {
    return ctx.action === 'delete'
      ? friendly(
          `This ${entity} is still being used somewhere else, so it can't be deleted yet. Remove it from where it's used first.`,
          err
        )
      : friendly(`Something this ${entity} links to no longer exists. Please pick it again.`, err);
  }
  if (code === '23502' || /null value in column|violates not-null/i.test(text)) {
    return friendly('A required field is empty. Please fill in everything marked required.', err);
  }
  if (code === '23514' || /violates check constraint/i.test(text)) {
    return friendly("One of the values isn't allowed here. Please pick one of the available options.", err);
  }
  if (code === '22001' || /value too long/i.test(text)) {
    return friendly('One of your entries is too long. Please shorten it and try again.', err);
  }
  if (code === '22P02' || /invalid input syntax/i.test(text)) {
    return friendly("One of the values isn't in the right format. Please check your entries.", err);
  }

  // --- Not found -------------------------------------------------------------
  if (code === 'PGRST116' || pg?.status === 404 || /no rows|not found/i.test(text)) {
    return friendly(
      `That ${entity} could not be found. It may have been deleted by someone else.`,
      err
    );
  }

  // --- Uploads ---------------------------------------------------------------
  if (/payload too large|exceeded the maximum|file size/i.test(text)) {
    return friendly('That file is too large to upload. Please use a smaller file.', err);
  }
  if (/mime type|not supported|invalid file type/i.test(text)) {
    return friendly("That file type isn't supported. Please use a JPG, PNG, WebP or PDF.", err);
  }

  // --- Server ----------------------------------------------------------------
  if (typeof pg?.status === 'number' && pg.status >= 500) {
    return friendly('The server had a problem saving that. Please try again in a moment.', err);
  }

  // --- Fallback --------------------------------------------------------------
  const verb =
    ctx.action === 'delete' ? 'deleting'
    : ctx.action === 'upload' ? 'uploading'
    : ctx.action === 'load' ? 'loading'
    : 'saving';
  return friendly(`Something went wrong while ${verb}. Please try again.`, err);
}

/** Convenience wrapper for call sites that only need the sentence. */
export function errorMessage(err: unknown, ctx: ErrorContext = {}): string {
  return humanizeError(err, ctx).message;
}
