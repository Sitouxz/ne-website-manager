/**
 * Pure helpers behind the editor's Google-result and social-card previews.
 *
 * Kept free of React and Supabase so the rules the preview shows — how long
 * a headline can be before Google cuts it, which image a share actually
 * uses — are unit-tested in one place and can't drift between the post and
 * page editors.
 */

/** Google truncates result titles by pixel width; ~60 characters is the usual safe budget. */
export const SEARCH_TITLE_LIMIT = 60;
/** Same character budget the editors already warn about for descriptions. */
export const SEARCH_DESCRIPTION_LIMIT = 160;

/** Shortens `text` to `limit` characters on a word boundary, adding an ellipsis when cut. */
export function truncateForSearch(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s.,;:!?-]+$/, '')}…`;
}

/**
 * The absolute public URL for a path on the client's site, or null when the
 * site URL isn't configured or isn't a valid URL.
 */
export function buildPublicUrl(websiteUrl: string | null | undefined, path: string): string | null {
  if (!websiteUrl) return null;
  try {
    const base = new URL(websiteUrl);
    const cleanPath = `/${path.replace(/^\/+/, '')}`;
    return new URL(cleanPath, base.origin).toString();
  } catch {
    return null;
  }
}

/** Google's breadcrumb-style display: `example.com › blog › my-post`. */
export function displayUrl(url: string | null): string {
  if (!url) return 'your-website.com';
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return [parsed.host, ...segments].join(' › ');
  } catch {
    return url;
  }
}

/** Host only, upper-cased the way most social cards render it. */
export function displayHost(url: string | null): string {
  if (!url) return 'YOUR-WEBSITE.COM';
  try {
    return new URL(url).host.toUpperCase();
  } catch {
    return url.toUpperCase();
  }
}

/** The image a share will actually use: the explicit social image, else the fallback (a post's cover). */
export function resolveShareImage(ogImageUrl: string | null | undefined, fallback: string | null | undefined): string | null {
  const explicit = ogImageUrl?.trim();
  if (explicit) return explicit;
  const backup = fallback?.trim();
  return backup || null;
}

/**
 * Validation message for a canonical URL input, or null when acceptable.
 * Empty is valid (it means "this page's own URL"); anything else must be an
 * absolute http(s) URL, because a relative canonical is resolved differently
 * by different crawlers.
 */
export function canonicalUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'Use a full web address starting with https://';
    }
    return null;
  } catch {
    return 'Use a full web address starting with https://';
  }
}
