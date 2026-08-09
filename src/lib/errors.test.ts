import { describe, expect, it } from 'vitest';
import { errorMessage, humanizeError } from './errors';

/** A Supabase PostgrestError as it actually arrives at a call site. */
function pgError(code: string, message: string, details?: string) {
  return { code, message, details: details ?? null, hint: null };
}

describe('humanizeError', () => {
  it('never shows raw Postgres text as the headline message', () => {
    const err = pgError(
      '23505',
      'duplicate key value violates unique constraint "posts_client_id_slug_key"'
    );
    const result = humanizeError(err, { entity: 'post' });
    expect(result.message).not.toMatch(/duplicate key|constraint|violates/i);
    expect(result.message).toBe(
      'A post with this web address already exists. Please choose a different one.'
    );
  });

  it('keeps the technical text available as detail for support', () => {
    const err = pgError('23505', 'duplicate key value violates unique constraint "posts_slug_key"');
    const result = humanizeError(err);
    expect(result.detail).toContain('23505');
    expect(result.detail).toContain('duplicate key');
  });

  it('recovers the entity noun from the constraint name when none is passed', () => {
    const err = pgError('23505', 'duplicate key value violates unique constraint "pages_client_id_path_key"');
    expect(humanizeError(err).message).toBe(
      'A page with this web address already exists. Please choose a different one.'
    );
  });

  it('calls a slug or path a "web address", never a slug', () => {
    const slug = pgError('23505', 'duplicate key ... constraint "posts_client_id_slug_key"');
    const path = pgError('23505', 'duplicate key ... constraint "pages_client_id_path_key"');
    for (const err of [slug, path]) {
      expect(humanizeError(err).message).toContain('web address');
      expect(humanizeError(err).message).not.toMatch(/slug|path/i);
    }
  });

  it('uses "email address" for a duplicate email', () => {
    const err = pgError('23505', 'duplicate key value violates unique constraint "profiles_email_key"');
    expect(humanizeError(err).message).toContain('email address');
  });

  it('picks the right article for a vowel-initial noun', () => {
    const err = pgError('23505', 'duplicate key');
    expect(humanizeError(err, { entity: 'image' }).message).toMatch(/^An image/);
    expect(humanizeError(err, { entity: 'post' }).message).toMatch(/^A post/);
  });

  it('explains an RLS denial as a permission problem, not a policy violation', () => {
    const err = pgError('42501', 'new row violates row-level security policy for table "posts"');
    const result = humanizeError(err);
    expect(result.message).not.toMatch(/row-level security|policy|table/i);
    expect(result.message).toContain("don't have permission");
    expect(result.message).toContain('administrator');
  });

  it('tailors the permission message when the action was a delete', () => {
    const err = pgError('42501', 'permission denied');
    expect(humanizeError(err, { action: 'delete' }).message).toContain('delete this');
  });

  it('tells the user to sign in again when the session expired', () => {
    expect(humanizeError(pgError('PGRST301', 'JWT expired')).message).toContain('sign in again');
  });

  it('handles a wrong password without leaking which half was wrong', () => {
    const result = humanizeError({ message: 'Invalid login credentials', status: 400 });
    expect(result.message).toBe("That email or password isn't right. Please check and try again.");
  });

  it('explains a foreign-key violation differently for delete vs save', () => {
    const err = pgError('23503', 'violates foreign key constraint');
    expect(humanizeError(err, { entity: 'image', action: 'delete' }).message).toContain(
      "can't be deleted yet"
    );
    expect(humanizeError(err, { entity: 'image' }).message).toContain('no longer exists');
  });

  it('turns a not-null violation into "a required field is empty"', () => {
    const err = pgError('23502', 'null value in column "title" violates not-null constraint');
    expect(humanizeError(err).message).toContain('required field is empty');
  });

  it('turns a check violation into a "pick an allowed option" message', () => {
    const err = pgError('23514', 'new row violates check constraint "posts_status_check"');
    expect(humanizeError(err).message).toContain('available options');
  });

  it('reports a too-long value in plain language', () => {
    expect(humanizeError(pgError('22001', 'value too long for type character varying(80)')).message)
      .toContain('too long');
  });

  it('treats a missing row as deleted-by-someone-else', () => {
    const err = pgError('PGRST116', 'JSON object requested, multiple (or no) rows returned');
    expect(humanizeError(err, { entity: 'post' }).message).toBe(
      'That post could not be found. It may have been deleted by someone else.'
    );
  });

  it('treats a fetch rejection as an offline problem', () => {
    const result = humanizeError(new TypeError('Failed to fetch'));
    expect(result.message).toContain('internet connection');
  });

  it('treats an aborted request as a timeout', () => {
    const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(humanizeError(err).message).toContain('took too long');
  });

  it('explains an oversized upload', () => {
    expect(humanizeError({ message: 'Payload too large', status: 413 }, { action: 'upload' }).message)
      .toContain('too large');
  });

  it('explains an unsupported file type with examples', () => {
    const result = humanizeError({ message: 'mime type image/tiff is not supported' });
    expect(result.message).toContain('JPG');
  });

  it('asks the user to retry on a 5xx', () => {
    expect(humanizeError({ message: 'Internal Server Error', status: 500 }).message)
      .toContain('try again in a moment');
  });

  it('falls back to a calm message that names the action, not the error', () => {
    const err = pgError('XX000', 'some internal thing exploded in a way nobody mapped');
    const result = humanizeError(err, { action: 'delete' });
    expect(result.message).toBe('Something went wrong while deleting. Please try again.');
    expect(result.detail).toContain('exploded');
  });

  it('handles null and undefined without throwing', () => {
    expect(humanizeError(null).message).toBe('Something went wrong. Please try again.');
    expect(humanizeError(undefined).message).toBe('Something went wrong. Please try again.');
  });

  it('handles a bare string', () => {
    const result = humanizeError('something odd happened');
    expect(result.message).toContain('Something went wrong');
    expect(result.detail).toBe('something odd happened');
  });

  it('never returns an empty or technical-looking message for any input', () => {
    const inputs: unknown[] = [
      null,
      undefined,
      '',
      'x',
      new Error('boom'),
      new TypeError('Failed to fetch'),
      pgError('23505', 'dup'),
      pgError('42501', 'rls'),
      { status: 500 },
      { weird: true },
      42,
    ];
    for (const input of inputs) {
      const { message } = humanizeError(input);
      expect(message.length).toBeGreaterThan(10);
      expect(message).toMatch(/[.!]$/);
      expect(message).not.toMatch(/constraint|violates|pgrst|sqlstate|null value|row-level/i);
    }
  });
});

describe('errorMessage', () => {
  it('returns just the sentence', () => {
    const err = pgError('23505', 'duplicate key value violates unique constraint "posts_client_id_slug_key"');
    expect(errorMessage(err, { entity: 'post' })).toBe(
      'A post with this web address already exists. Please choose a different one.'
    );
  });
});
