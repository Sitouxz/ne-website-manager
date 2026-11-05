import type { FieldDef } from '@/lib/collections/types';
import type { ClientCapabilities, CollectionOptions } from '@/lib/supabase/types';

/**
 * Site templates — Stage 5 of `docs/cms-multitenancy-plan.md`.
 *
 * A template is the starting shape of a client's CMS: which collections exist
 * and what fields they hold, which modules are switched on, what the site's
 * globals and public navigation start as. Applying one turns onboarding from
 * "open the repo and write a migration" into "pick a template".
 *
 * ## Why these live in code, not in the database
 *
 * The plan sketched templates as `client_id IS NULL` rows in `collections`.
 * That works for collections alone, but a template is also capabilities,
 * globals and navigation — none of which that table can hold — so it would
 * need a grouping key smuggled into `options` to say which rows belong to
 * which template. Defining templates here instead:
 *
 *  - keeps a template reviewable in a diff, which matters because it decides
 *    what a real client's CMS looks like on day one;
 *  - lets `templates.test.ts` run every built-in template through
 *    `validateFieldDefs`, so a broken schema fails CI rather than a client's
 *    first login;
 *  - adds no table, honouring Stage 0's freeze in its strictest reading.
 *
 * The plan's target — "a new client onboarded end-to-end without opening the
 * repo" — is still met: onboarding is a dropdown. Authoring a *new template*
 * needs the repo, which is correct; a template is a product decision NE makes
 * once, not per client.
 *
 * If operators ever need to author templates themselves, the natural next
 * step is a `site_templates` table holding this same `SiteTemplate` shape as
 * JSONB, with this catalog as the seed. Nothing here blocks that.
 */

export interface TemplateCollection {
  slug: string;
  name: string;
  name_singular: string;
  description?: string;
  /** lucide-react icon name, matching `collections.icon`. */
  icon?: string;
  fields: FieldDef[];
  options?: CollectionOptions;
}

export interface TemplateNavItem {
  label: string;
  /** A path on the client's own website, e.g. `/about`. */
  url: string;
}

export interface SiteTemplate {
  slug: string;
  name: string;
  /** One line, shown in the picker. Written for an operator, not a developer. */
  description: string;
  /**
   * Capability overrides merged over `DEFAULT_CLIENT_CAPABILITIES`. Omit a key
   * to accept the default — a template should only state what it changes, so
   * a future capability doesn't silently arrive switched off.
   */
  capabilities?: Partial<ClientCapabilities>;
  collections: TemplateCollection[];
  /** `site_globals` rows, keyed by `site_globals.key`. */
  globals?: Record<string, Record<string, unknown>>;
  /** Public-facing navigation (`menu_items.location = 'public'`), in order. */
  navigation?: TemplateNavItem[];
}

/** What `applyTemplate` actually wrote, for the confirmation message. */
export interface AppliedTemplate {
  collections: number;
  globals: number;
  navigation: number;
}
