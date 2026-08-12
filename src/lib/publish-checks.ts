import type { FieldDef } from '@/lib/collections/types';
import { SEO_DESCRIPTION_KEY, SEO_TITLE_KEY, collectionHasSeoFields } from '@/lib/seo/entries';

/**
 * Publish preflight — the things worth saying out loud *before* content goes
 * live, for someone who will not think to check them.
 *
 * ## Warnings, never blocks
 *
 * Every check here produces a warning the user can publish straight past. The
 * product constraint is that the end users are mosque administrators and
 * office managers, and a validator that refuses to publish because an image
 * lacks alt text teaches them to fear the publish button. `validateEntry` is
 * the thing that blocks (it protects data shape); this protects quality, and
 * quality is the author's call.
 *
 * ## Wording
 *
 * Each message names the consequence on the live website rather than the rule
 * that was broken: "screen readers and Google can't tell what this picture
 * shows", not "missing alt attribute". Same reason the confirm dialogs say
 * what will happen to the website instead of "this cannot be undone".
 */

export type PublishWarningCode =
  | 'image-missing-alt'
  | 'seo-title-missing'
  | 'seo-description-missing'
  | 'seo-description-long'
  | 'link-placeholder'
  | 'empty-content';

export interface PublishWarning {
  code: PublishWarningCode;
  /** Plain-language, consequence-first. Rendered directly to the user. */
  message: string;
  /** `FieldDef.key` (or a repeater path) this came from, when it came from one. */
  field?: string;
}

/**
 * Google truncates descriptions past roughly this length. Not a hard rule —
 * hence a warning, and a generous threshold so it fires on "clearly too long"
 * rather than nagging about a well-judged 165-character sentence.
 */
const SEO_DESCRIPTION_MAX = 200;

/**
 * Hrefs that mean "I have not filled this in yet". Compared after
 * `normalizeHref`, so the constants and the input go through the same
 * lowercasing and trailing-slash trim rather than being normalized on only
 * one side — which is how `https://` silently stopped matching itself.
 */
const PLACEHOLDER_LINKS = new Set(
  ['#', 'http://', 'https://', 'https://example.com', 'http://example.com'].map(normalizeHref),
);

function normalizeHref(href: string): string {
  const lower = href.trim().toLowerCase();
  // Only trim a trailing slash that follows a path or host, never the one in
  // a bare scheme — `https://` must stay `https://`.
  return /^[a-z]+:\/\/.+/.test(lower) ? lower.replace(/\/+$/, '') : lower;
}

interface ImageLike { url?: unknown; alt?: unknown }

function isImageLike(value: unknown): value is ImageLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'url' in value;
}

function hasUsableUrl(image: ImageLike): boolean {
  return typeof image.url === 'string' && image.url.trim() !== '';
}

function missingAlt(image: ImageLike): boolean {
  return typeof image.alt !== 'string' || image.alt.trim() === '';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Walks a collection entry's `data` against its schema, including inside
 * repeater rows — an image with no description is no less invisible for being
 * nested two levels down in a page section.
 */
function walkFields(
  fields: FieldDef[],
  data: Record<string, unknown>,
  path: string,
  warnings: PublishWarning[],
): void {
  for (const field of fields) {
    const value = data[field.key];
    const fieldPath = `${path}${field.key}`;
    if (value === undefined || value === null) continue;

    switch (field.type) {
      case 'image': {
        if (isImageLike(value) && hasUsableUrl(value) && missingAlt(value)) {
          warnings.push({
            code: 'image-missing-alt',
            field: fieldPath,
            message: `"${field.label}" has no description, so screen readers and search engines can't tell what the picture shows.`,
          });
        }
        break;
      }

      case 'gallery': {
        if (!Array.isArray(value)) break;
        const withoutAlt = value.filter((item) => isImageLike(item) && hasUsableUrl(item) && missingAlt(item)).length;
        if (withoutAlt > 0) {
          warnings.push({
            code: 'image-missing-alt',
            field: fieldPath,
            message: `${withoutAlt} ${withoutAlt === 1 ? 'picture' : 'pictures'} in "${field.label}" ${withoutAlt === 1 ? 'has' : 'have'} no description, so screen readers and search engines can't tell what ${withoutAlt === 1 ? 'it shows' : 'they show'}.`,
          });
        }
        break;
      }

      case 'url': {
        const href = text(value);
        if (href !== '' && PLACEHOLDER_LINKS.has(normalizeHref(href))) {
          warnings.push({
            code: 'link-placeholder',
            field: fieldPath,
            message: `"${field.label}" still holds a placeholder link, so anyone clicking it on your website will go nowhere useful.`,
          });
        }
        break;
      }

      case 'repeater': {
        if (!Array.isArray(value) || !field.fields) break;
        value.forEach((row, index) => {
          if (typeof row !== 'object' || row === null || Array.isArray(row)) return;
          walkFields(field.fields!, row as Record<string, unknown>, `${fieldPath}[${index}].`, warnings);
        });
        break;
      }

      default:
        break;
    }
  }
}

export interface EntryPublishCheckInput {
  fields: FieldDef[];
  data: Record<string, unknown>;
}

/**
 * Warnings for a collection entry about to be published.
 *
 * SEO is only checked when the collection opted in by declaring the reserved
 * fields — the same rule the SEO audit uses, so the two never disagree about
 * whether an entry is supposed to have a search description at all.
 */
export function checkEntryBeforePublish({ fields, data }: EntryPublishCheckInput): PublishWarning[] {
  const warnings: PublishWarning[] = [];

  walkFields(fields, data, '', warnings);

  if (collectionHasSeoFields(fields)) {
    const seoTitle = text(data[SEO_TITLE_KEY]);
    const seoDescription = text(data[SEO_DESCRIPTION_KEY]);

    if (fields.some((f) => f.key === SEO_TITLE_KEY) && seoTitle === '') {
      warnings.push({
        code: 'seo-title-missing',
        field: SEO_TITLE_KEY,
        message: 'No search title, so Google will pick its own headline for this page.',
      });
    }
    if (fields.some((f) => f.key === SEO_DESCRIPTION_KEY)) {
      if (seoDescription === '') {
        warnings.push({
          code: 'seo-description-missing',
          field: SEO_DESCRIPTION_KEY,
          message: 'No search description, so Google will show a sentence of its own choosing under the headline.',
        });
      } else if (seoDescription.length > SEO_DESCRIPTION_MAX) {
        warnings.push({
          code: 'seo-description-long',
          field: SEO_DESCRIPTION_KEY,
          message: `The search description is ${seoDescription.length} characters, so Google will probably cut it off partway through.`,
        });
      }
    }
  }

  return warnings;
}

export interface ArticlePublishCheckInput {
  /** Rendered HTML of the body — `posts.content` / `pages.content`. */
  html: string;
  seoTitle: string | null;
  seoDescription: string | null;
  /** The cover image's alt text, when the record has a cover image at all. */
  coverUrl?: string | null;
  coverAlt?: string | null;
  /**
   * Extra single images the record carries as its own columns rather than in
   * a schema — `properties.hero_url`/`hero_alt`, say. Named so the warning can
   * say which one, since a bespoke editor has several.
   */
  images?: { label: string; url?: unknown; alt?: unknown }[];
  /** Image arrays stored as their own column, e.g. `properties.gallery`. */
  galleries?: { label: string; items?: unknown }[];
  /**
   * Set false for a record whose body is not the point — a property listing
   * is complete without a long description, so calling it "empty" is noise.
   */
  requireBody?: boolean;
}

/** As `checkEntryBeforePublish`, for a post or page. */
export function checkArticleBeforePublish(input: ArticlePublishCheckInput): PublishWarning[] {
  const warnings: PublishWarning[] = [];

  // Body images: parsed out of the stored HTML with a regex rather than a DOM
  // parser, deliberately. This runs in the editor on every publish, the input
  // is HTML this CMS produced through Tiptap, and the cost of a false negative
  // is one un-warned image — not a correctness or safety problem. Nothing here
  // renders the matched HTML; only counts come out.
  const imgTags = input.html.match(/<img\b[^>]*>/gi) ?? [];
  const bodyImagesWithoutAlt = imgTags.filter((tag) => {
    const alt = /\balt\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const value = alt?.[2] ?? alt?.[3] ?? '';
    return value.trim() === '';
  }).length;

  if (bodyImagesWithoutAlt > 0) {
    warnings.push({
      code: 'image-missing-alt',
      message: `${bodyImagesWithoutAlt} ${bodyImagesWithoutAlt === 1 ? 'picture' : 'pictures'} in the article ${bodyImagesWithoutAlt === 1 ? 'has' : 'have'} no description, so screen readers and search engines can't tell what ${bodyImagesWithoutAlt === 1 ? 'it shows' : 'they show'}.`,
    });
  }

  if (text(input.coverUrl) !== '' && text(input.coverAlt) === '') {
    warnings.push({
      code: 'image-missing-alt',
      field: 'cover',
      message: "The cover image has no description, so screen readers and search engines can't tell what it shows.",
    });
  }

  for (const image of input.images ?? []) {
    if (typeof image.url !== 'string' || image.url.trim() === '') continue;
    if (typeof image.alt === 'string' && image.alt.trim() !== '') continue;
    warnings.push({
      code: 'image-missing-alt',
      field: image.label,
      message: `"${image.label}" has no description, so screen readers and search engines can't tell what the picture shows.`,
    });
  }

  for (const gallery of input.galleries ?? []) {
    if (!Array.isArray(gallery.items)) continue;
    // `properties.gallery` uses `{ src, alt }` while the generic `gallery`
    // field type uses `{ url, alt }` — both are accepted rather than making
    // every caller normalise, since the check only needs "is there a picture
    // here, and does it have words".
    const withoutAlt = gallery.items.filter((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const row = item as { url?: unknown; src?: unknown; alt?: unknown };
      const hasImage = [row.url, row.src].some((v) => typeof v === 'string' && v.trim() !== '');
      return hasImage && !(typeof row.alt === 'string' && row.alt.trim() !== '');
    }).length;

    if (withoutAlt > 0) {
      warnings.push({
        code: 'image-missing-alt',
        field: gallery.label,
        message: `${withoutAlt} ${withoutAlt === 1 ? 'picture' : 'pictures'} in "${gallery.label}" ${withoutAlt === 1 ? 'has' : 'have'} no description, so screen readers and search engines can't tell what ${withoutAlt === 1 ? 'it shows' : 'they show'}.`,
      });
    }
  }

  if (text(input.seoTitle) === '') {
    warnings.push({
      code: 'seo-title-missing',
      field: 'seo_title',
      message: 'No search title, so Google will pick its own headline for this page.',
    });
  }

  const description = text(input.seoDescription);
  if (description === '') {
    warnings.push({
      code: 'seo-description-missing',
      field: 'seo_description',
      message: 'No search description, so Google will show a sentence of its own choosing under the headline.',
    });
  } else if (description.length > SEO_DESCRIPTION_MAX) {
    warnings.push({
      code: 'seo-description-long',
      field: 'seo_description',
      message: `The search description is ${description.length} characters, so Google will probably cut it off partway through.`,
    });
  }

  // Stripped of tags before measuring: `<p></p>` is what an emptied Tiptap
  // editor stores, and it is not content.
  if ((input.requireBody ?? true) && input.html.replace(/<[^>]*>/g, '').trim() === '' && imgTags.length === 0) {
    warnings.push({
      code: 'empty-content',
      message: 'This has no content yet, so the page will look empty to anyone who visits it.',
    });
  }

  return warnings;
}

/** A short headline for the warning panel, e.g. "3 things worth checking". */
export function summarizeWarnings(warnings: PublishWarning[]): string {
  if (warnings.length === 0) return '';
  return warnings.length === 1 ? '1 thing worth checking' : `${warnings.length} things worth checking`;
}
