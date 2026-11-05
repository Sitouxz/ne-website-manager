import { validateFieldDefs } from '@/lib/collections/validate';
import type { AppliedTemplate, SiteTemplate } from './types';

/**
 * Writes a `SiteTemplate` into a freshly created client.
 *
 * ## Failure policy
 *
 * Applying a template is deliberately NOT all-or-nothing, and does not roll
 * the client back. By the time this runs the client row and its login already
 * exist and are the valuable, hard-to-recreate part; the template is starter
 * content an admin can add or fix from the CMS in a minute. Deleting a working
 * client because one `menu_items` insert failed would be the more destructive
 * outcome by a wide margin.
 *
 * So every step is attempted, failures are collected, and the caller gets both
 * what landed and what did not — enough to tell the admin "the client is
 * ready, but the starter navigation didn't save" instead of failing opaquely
 * or silently pretending everything worked.
 *
 * ## Client type
 *
 * Takes a structurally-typed client rather than `SupabaseClient` so the unit
 * tests can drive it with `mockSupabase()`, following the same convention as
 * `notifyPublish` in `src/lib/publish.ts`.
 */

interface InsertResult {
  error: { message: string } | null;
}

export interface TemplateWriteClient {
  from(table: string): {
    insert(rows: Record<string, unknown>[]): PromiseLike<InsertResult>;
  };
}

export interface ApplyTemplateResult extends AppliedTemplate {
  /** Human-readable failures. Empty when everything landed. */
  errors: string[];
}

export async function applyTemplate(
  supabase: TemplateWriteClient,
  clientId: string,
  template: SiteTemplate,
): Promise<ApplyTemplateResult> {
  const errors: string[] = [];
  const result: ApplyTemplateResult = { collections: 0, globals: 0, navigation: 0, errors };

  // --- Collections -------------------------------------------------------
  // Validated before writing, not after: a template with a bad schema would
  // otherwise produce a collection whose schema page refuses to save, which is
  // a much more confusing state than "this collection was skipped".
  const collectionRows: Record<string, unknown>[] = [];
  for (const [index, collection] of template.collections.entries()) {
    const validation = validateFieldDefs(collection.fields);
    if (!validation.ok) {
      errors.push(`Collection "${collection.name}" was skipped: ${validation.errors.join('; ')}`);
      continue;
    }
    collectionRows.push({
      client_id: clientId,
      slug: collection.slug,
      name: collection.name,
      name_singular: collection.name_singular,
      description: collection.description ?? null,
      icon: collection.icon ?? null,
      storage: 'generic',
      native_table: null,
      fields: collection.fields,
      options: collection.options ?? {},
      is_system: false,
      sort_order: index,
    });
  }

  if (collectionRows.length > 0) {
    const { error } = await supabase.from('collections').insert(collectionRows);
    if (error) errors.push(`Collections could not be created: ${error.message}`);
    else result.collections = collectionRows.length;
  }

  // --- Globals -----------------------------------------------------------
  const globalRows = Object.entries(template.globals ?? {}).map(([key, value]) => ({
    client_id: clientId,
    key,
    value,
  }));

  if (globalRows.length > 0) {
    const { error } = await supabase.from('site_globals').insert(globalRows);
    if (error) errors.push(`Site settings could not be created: ${error.message}`);
    else result.globals = globalRows.length;
  }

  // --- Public navigation -------------------------------------------------
  // `link_type: 'url'` throughout: a template's nav points at pages on the
  // client's own website, which exist in their codebase, not at CMS
  // collections. Flat by design — the nav editor is two-level, but a starter
  // menu with nesting is a structure to undo rather than a head start.
  const navRows = (template.navigation ?? []).map((item, index) => ({
    client_id: clientId,
    location: 'public',
    label: item.label,
    link_type: 'url',
    url: item.url,
    icon: 'Link',
    sort_order: index,
    is_visible: true,
  }));

  if (navRows.length > 0) {
    const { error } = await supabase.from('menu_items').insert(navRows);
    if (error) errors.push(`Starter navigation could not be created: ${error.message}`);
    else result.navigation = navRows.length;
  }

  return result;
}

/** One line summarising what a template applied, for a toast or an activity log entry. */
export function describeApplied(result: AppliedTemplate): string {
  const parts: string[] = [];
  if (result.collections > 0) parts.push(`${result.collections} collection${result.collections === 1 ? '' : 's'}`);
  if (result.globals > 0) parts.push(`${result.globals} site setting${result.globals === 1 ? '' : 's'}`);
  if (result.navigation > 0) parts.push(`${result.navigation} menu item${result.navigation === 1 ? '' : 's'}`);
  if (parts.length === 0) return 'no starter content';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
