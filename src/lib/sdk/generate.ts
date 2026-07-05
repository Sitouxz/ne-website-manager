import type { FieldDef, FieldType } from '@/lib/collections/types';

/**
 * Single source of truth for generating `lib/cms.ts` — the TypeScript
 * source-code STRING pasted into a client site's own repository (a
 * *separate* codebase from this CMS). Task 7.2.
 *
 * Before this task, `src/app/api/client/[slug]/sdk/route.ts` and
 * `src/app/api/admin/push-integration/route.ts` each carried their own
 * near-duplicate `cmsLib`/`generateCmsLib` function. The two had drifted:
 * `sdk/route.ts`'s `CmsPost.status` was the literal `'published'` (correct —
 * the public feed it documents only ever returns published posts);
 * `push-integration/route.ts`'s was the full `'draft' | 'published' |
 * 'archived'` union (incorrect for this context). `generateV1Sdk` below uses
 * `sdk/route.ts`'s version as ground truth, since that's the one live client
 * sites (e.g. al-islah) actually fetch from today.
 *
 * ## v1 vs v2
 *
 * `generateV1Sdk` reproduces that live output BYTE-FOR-BYTE — this is a
 * hard backward-compatibility constraint (`sdk/route.ts` still serves v1 by
 * default; see that file). `generateV2Sdk` builds on top of it: its output
 * contains the *entire* v1 output unchanged (additional exports are appended
 * after it), so nothing that worked for a v1 integration stops working if a
 * client later upgrades.
 *
 * ## Two files for v2: `lib/cms.ts` (middleware-safe) vs `lib/cms-server.ts` (Node-only)
 *
 * v2 is split across TWO generated files/functions, not one, because of a
 * real Edge Runtime incompatibility:
 *
 *   - `generateV2Sdk` -> `lib/cms.ts`. Contains v1 unchanged plus every v2
 *     addition that does NOT require Node.js or App-Router-only APIs:
 *     `getCollection`/`getEntry`/per-collection helpers, `getGlobals`/
 *     `getNavigation`/`getAnnouncement`, `submitForm`, `getRedirects` +
 *     `PROXY_MIDDLEWARE_SNIPPET`. This file has NO top-level imports beyond
 *     what v1 already needs (none), so it is safe to `import` from a client
 *     repo's own `middleware.ts` — exactly what `PROXY_MIDDLEWARE_SNIPPET`
 *     itself recommends via `import { getRedirects } from './lib/cms'`.
 *     Next.js Middleware runs in the Edge Runtime by default on most
 *     Next.js versions client repos actually run, which does not support
 *     Node.js APIs (`crypto`) or App-Router server-only APIs (`next/headers`,
 *     `next/navigation`). If those imports lived in this file, a client
 *     following the generator's own middleware snippet would very likely
 *     hit a build failure the moment they imported anything from it.
 *   - `generateV2ServerSdk` -> `lib/cms-server.ts`. Contains ONLY
 *     `createPreviewHandler`/`createRevalidateHandler` and the Node/App-
 *     Router-only imports those two factories need (`crypto`'s
 *     `createHmac`/`timingSafeEqual`, `next/cache`, `next/headers`,
 *     `next/navigation`). Both handlers are meant to be wired into Route
 *     Handlers (`app/api/preview/route.ts`, `app/api/revalidate/route.ts`),
 *     which run in the Node.js runtime by default — never into
 *     `middleware.ts`. The file name and its own leading comment both say
 *     so explicitly, so a client integrator doesn't have to infer it.
 *
 * `lib/cms-server.ts` does not `import` anything from `lib/cms.ts` — it
 * declares its own local `CMS_BASE`/`CLIENT_SLUG` consts (interpolated the
 * same way v1's are) rather than importing them, since v1's own
 * `CMS_BASE`/`CLIENT_SLUG` are intentionally NOT exported (exporting them
 * would change `generateV1Sdk`'s byte-identical output, which is a hard
 * constraint — see above). Keeping `lib/cms-server.ts` self-contained this
 * way also means it never breaks if `lib/cms.ts` is missing or edited by
 * hand; the only relationship between the two files is that a client
 * usually has both.
 *
 * ## Collection helper naming convention
 *
 * Per collection, `generateV2Sdk` emits:
 *   - `<Pascal>Fields` — an interface for `collection_items.data`'s shape,
 *     derived from the collection's `FieldDef[]` (see `fieldTsType` below for
 *     the `FieldType` -> TS type mapping, taken from
 *     `FieldInput.tsx`'s documented data-shape contract).
 *   - `get<Pascal>(params?)` — list helper (e.g. slug `'sermons'` ->
 *     `getSermons()`), backed by the generic `getCollection<T>`.
 *   - `get<Pascal>Entry(slug)` — single-item helper (e.g. `getSermonsEntry`),
 *     backed by the generic `getEntry<T>`.
 * `<Pascal>` is `toPascalCase(collection.slug)`. Deliberately NOT derived
 * from `collection.name_singular`/pluralization of the slug for the
 * single-item helper (e.g. NOT `getSermon`) — English pluralization/
 * singularization of an arbitrary user-chosen slug is unreliable (`'faq'` ->
 * `'faqs'`? `'staff'` -> `'staffs'`?), and `name_singular` is free-form text
 * an editor typed into a form field, not guaranteed to produce a clean
 * identifier. Suffixing the SAME `<Pascal>(slug)` with `Entry` is fully
 * deterministic from data every collection already has.
 */

// ---------------------------------------------------------------------------
// v1 — byte-identical to the current live `sdk/route.ts#cmsLib` output.
// Do not change a single character of this template without updating the
// regression test in `generate.test.ts` AND confirming every already-
// integrated v1 client site (e.g. al-islah) can tolerate the change — v1 is
// the one already fetched and pasted into client repos today.
// ---------------------------------------------------------------------------

export function generateV1Sdk(slug: string, cmsBase: string): string {
  return `// lib/cms.ts - generated by NE Website Manager

const CMS_BASE = '${cmsBase}';
const CLIENT_SLUG = '${slug}';

export interface CmsPost {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  cover_url: string | null;
  category: string;
  tags: string[];
  status: 'published';
  seo_title: string | null;
  seo_description: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CmsPage {
  id: string;
  title: string;
  path: string;
  content: string;
  status: 'published';
  visibility: 'public';
  updated_at: string;
}

export type AnalyticsMetadata = Record<string, string | number | boolean | null>;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(\`\${CMS_BASE}\${path}\`, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(\`NE Website Manager request failed: \${res.status}\`);
  return res.json() as Promise<T>;
}

function getVisitorId() {
  if (typeof window === 'undefined') return undefined;
  const key = 'ne_visitor_id';
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    window.localStorage.setItem(key, id);
  }
  return id;
}

function getSessionId() {
  if (typeof window === 'undefined') return undefined;
  const key = 'ne_session_id';
  let id = window.sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    window.sessionStorage.setItem(key, id);
  }
  return id;
}

export function getPosts(params?: { category?: string; limit?: number }): Promise<CmsPost[]> {
  const search = new URLSearchParams();
  if (params?.category) search.set('category', params.category);
  if (params?.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return fetchJson<CmsPost[]>(\`/api/client/\${CLIENT_SLUG}/posts\${qs ? \`?\${qs}\` : ''}\`);
}

export function getPostBySlug(slug: string): Promise<CmsPost | null> {
  return fetchJson<CmsPost>(\`/api/client/\${CLIENT_SLUG}/posts/\${encodeURIComponent(slug)}\`)
    .catch(() => null);
}

export function getPages(): Promise<CmsPage[]> {
  return fetchJson<CmsPage[]>(\`/api/client/\${CLIENT_SLUG}/pages\`);
}

export function trackEvent(eventName: string, metadata: AnalyticsMetadata = {}) {
  if (typeof window === 'undefined') return Promise.resolve();

  const payload = {
    event_name: eventName,
    path: window.location.pathname,
    title: document.title,
    referrer: document.referrer,
    visitor_id: getVisitorId(),
    session_id: getSessionId(),
    metadata,
  };

  return fetch(\`\${CMS_BASE}/api/client/\${CLIENT_SLUG}/analytics\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify(payload),
  }).then(() => undefined).catch(() => undefined);
}

export function trackPageView(metadata: AnalyticsMetadata = {}) {
  return trackEvent('page_view', metadata);
}

export function installAnalytics() {
  if (typeof window === 'undefined') return;
  trackPageView();

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  const emit = () => window.setTimeout(() => trackPageView(), 0);

  history.pushState = function pushState(...args) {
    originalPushState.apply(this, args);
    emit();
  };
  history.replaceState = function replaceState(...args) {
    originalReplaceState.apply(this, args);
    emit();
  };
  window.addEventListener('popstate', emit);
}
`;
}

// ---------------------------------------------------------------------------
// v2 — collections, globals, forms, redirects (generateV2Sdk / lib/cms.ts),
// plus preview + revalidate handlers (generateV2ServerSdk / lib/cms-server.ts).
// ---------------------------------------------------------------------------

/** Minimal shape `generateV2Sdk` needs from a `collections` row (migration 007). */
export interface SdkCollectionInput {
  slug: string;
  name: string;
  name_singular: string;
  fields: FieldDef[];
}

/**
 * `FieldType` -> generated TS type, per `FieldInput.tsx`'s documented
 * `collection_items.data` shape contract (the exact source of truth cited in
 * the task brief). A field NOT marked `required` becomes an optional
 * interface member (`key?: T`) rather than `key: T | undefined` — matching
 * `validateEntry`'s own rule that a non-required field absent from `data` is
 * valid, so the generated type shouldn't claim the key is always present.
 */
function fieldTsType(type: FieldType): string {
  switch (type) {
    case 'text':
    case 'textarea':
    case 'url':
    case 'email':
    case 'date':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'select':
      return 'string';
    case 'multiselect':
      return 'string[]';
    case 'richtext':
      return '{ json: Record<string, unknown> | null; html: string }';
    case 'image':
      return '{ url: string; alt: string | null }';
    case 'gallery':
      return 'Array<{ url: string; alt: string | null }>';
    case 'json':
      return 'unknown';
    default:
      return 'unknown';
  }
}

/**
 * `some-slug_like-THIS` -> `SomeSlugLikeThis`. Splits on any run of
 * non-alphanumeric characters, title-cases each chunk. Used for both the
 * per-collection interface name and the per-collection helper function
 * names, so a given collection slug always maps to one consistent
 * identifier throughout the generated file.
 */
export function toPascalCase(input: string): string {
  return input
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

function generateCollectionSection(collection: SdkCollectionInput): string {
  const pascal = toPascalCase(collection.slug);
  const interfaceName = `${pascal}Fields`;

  const fieldLines = collection.fields
    .map((f) => `  ${f.key}${f.required ? '' : '?'}: ${fieldTsType(f.type)};`)
    .join('\n');

  return `/** Generated from the "${collection.name}" collection's field schema. */
export interface ${interfaceName} {
${fieldLines}
}

export function get${pascal}(params?: CmsCollectionParams): Promise<CmsCollectionItem<${interfaceName}>[]> {
  return getCollection<${interfaceName}>('${collection.slug}', params);
}

export function get${pascal}Entry(itemSlug: string): Promise<CmsCollectionItem<${interfaceName}> | null> {
  return getEntry<${interfaceName}>('${collection.slug}', itemSlug);
}
`;
}

// Imports needed only by `lib/cms-server.ts`'s two handler factories
// (createHmac/timingSafeEqual for createRevalidateHandler;
// revalidatePath/revalidateTag for the same; draftMode/redirect for
// createPreviewHandler). Deliberately NOT part of `generateV2Sdk`'s
// `lib/cms.ts` output — see the file header's "Two files for v2" section for
// why these must stay out of the middleware-safe file. Placed at the very
// top of `lib/cms-server.ts` because ES module import declarations are
// conventionally expected to lead a file (most lint configs flag "import
// after statement"), and this generated file will be dropped into a
// THIRD-PARTY repo whose lint rules this generator doesn't control.
const V2_SERVER_IMPORTS = `import { createHmac, timingSafeEqual } from 'crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { draftMode } from 'next/headers';
import { redirect } from 'next/navigation';
`;

/**
 * Ready-made snippet for a client repo's own `middleware.ts`, demonstrating
 * how to apply CMS-managed redirects (`getRedirects()`). Exported as a
 * plain string constant rather than this generator writing a live
 * `middleware.ts` file directly — Next.js only recognizes ONE
 * `middleware.ts` at a project's root, and this generator has no way to
 * know whether the client repo already has one with unrelated logic in it.
 * Silently overwriting it as a side effect of fetching `lib/cms.ts` would be
 * destructive; handing the integrator a snippet to merge in by hand is not.
 */
const PROXY_SNIPPET = `// Example middleware.ts snippet for CMS-managed redirects.
// Merge this into this site's own middleware.ts (or use as a starting point
// if it doesn't have one yet) — NOT auto-applied by lib/cms.ts itself.
//
// import { NextResponse } from 'next/server';
// import type { NextRequest } from 'next/server';
// import { getRedirects } from './lib/cms';
//
// let cachedRedirects: Awaited<ReturnType<typeof getRedirects>> | null = null;
// let cachedAt = 0;
// const REDIRECTS_CACHE_MS = 60_000;
//
// export async function middleware(request: NextRequest) {
//   const now = Date.now();
//   if (!cachedRedirects || now - cachedAt > REDIRECTS_CACHE_MS) {
//     cachedRedirects = await getRedirects();
//     cachedAt = now;
//   }
//   const match = cachedRedirects.find((r) => r.from_path === request.nextUrl.pathname);
//   if (!match) return NextResponse.next();
//   const url = request.nextUrl.clone();
//   url.pathname = match.to_path;
//   return NextResponse.redirect(url, match.permanent ? 308 : 307);
// }
`;

/**
 * The v2 "core" additions that don't depend on any particular client's
 * collections — generic collection helpers, globals/navigation/announcement,
 * form submission, and redirects + the proxy snippet. Deliberately does NOT
 * include `createPreviewHandler`/`createRevalidateHandler` — see
 * `buildV2ServerCore` below and the file header's "Two files for v2" section
 * for why those two live in the separate `lib/cms-server.ts` output instead.
 */
function buildV2Core(): string {
  return `export interface CmsCollectionItem<T = Record<string, unknown>> {
  id: string;
  slug: string;
  data: T;
  published_at: string | null;
  updated_at: string;
}

export interface CmsCollectionParams {
  limit?: number;
  offset?: number;
  sort?: 'sort_order' | 'published_at';
}

export function getCollection<T = Record<string, unknown>>(
  collectionSlug: string,
  params?: CmsCollectionParams
): Promise<CmsCollectionItem<T>[]> {
  const search = new URLSearchParams();
  if (params?.limit) search.set('limit', String(params.limit));
  if (params?.offset) search.set('offset', String(params.offset));
  if (params?.sort) search.set('sort', params.sort);
  const qs = search.toString();
  return fetchJson<CmsCollectionItem<T>[]>(
    \`/api/client/\${CLIENT_SLUG}/collections/\${collectionSlug}\${qs ? \`?\${qs}\` : ''}\`
  );
}

export function getEntry<T = Record<string, unknown>>(
  collectionSlug: string,
  itemSlug: string
): Promise<CmsCollectionItem<T> | null> {
  return fetchJson<CmsCollectionItem<T>>(
    \`/api/client/\${CLIENT_SLUG}/collections/\${collectionSlug}/\${encodeURIComponent(itemSlug)}\`
  ).catch(() => null);
}

export interface CmsMenuItem {
  id: string;
  location: 'cms_sidebar' | 'public';
  label: string;
  icon: string | null;
  link_type: 'collection' | 'url' | 'custom';
  collection_slug: string | null;
  url: string | null;
  parent_id: string | null;
  sort_order: number;
  is_visible: boolean;
  children: CmsMenuItem[];
}

export interface CmsAnnouncement {
  enabled: boolean;
  message: string;
  href?: string;
  variant: 'info' | 'success' | 'warning';
  starts_at?: string;
  ends_at?: string;
}

export interface CmsGlobals {
  footer?: { text: string; links: { label: string; href: string }[] };
  announcement?: CmsAnnouncement;
  theme?: { tokens: Record<string, string> };
  social?: Record<string, string>;
  contact?: { email?: string; phone?: string; address?: string };
  navigation: CmsMenuItem[];
  [key: string]: unknown;
}

export function getGlobals(): Promise<CmsGlobals> {
  return fetchJson<CmsGlobals>(\`/api/client/\${CLIENT_SLUG}/globals\`);
}

export async function getNavigation(): Promise<CmsMenuItem[]> {
  const globals = await getGlobals();
  return globals.navigation ?? [];
}

export async function getAnnouncement(): Promise<CmsAnnouncement | null> {
  const globals = await getGlobals();
  return globals.announcement ?? null;
}

export interface CmsFormSubmitResult {
  success: boolean;
  id?: string;
  error?: string;
  errors?: Record<string, string>;
}

export async function submitForm(formSlug: string, data: Record<string, unknown>): Promise<CmsFormSubmitResult> {
  const res = await fetch(\`\${CMS_BASE}/api/client/\${CLIENT_SLUG}/forms/\${encodeURIComponent(formSlug)}\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { success: false, error: body?.error ?? \`Request failed: \${res.status}\`, errors: body?.errors };
  }
  return body as CmsFormSubmitResult;
}

export interface CmsRedirect {
  from_path: string;
  to_path: string;
  permanent: boolean;
}

export async function getRedirects(): Promise<CmsRedirect[]> {
  const seo = await fetchJson<{ redirects: CmsRedirect[] }>(\`/api/client/\${CLIENT_SLUG}/seo\`);
  return seo.redirects ?? [];
}

${PROXY_SNIPPET.trimEnd()}
export const PROXY_MIDDLEWARE_SNIPPET = ${JSON.stringify(PROXY_SNIPPET)};
`;
}

/**
 * Generates the v2 `lib/cms.ts` source for one client — the middleware-safe
 * file. Contains the ENTIRE v1 output unchanged (see file header) plus every
 * v2 addition that doesn't require Node.js/App-Router-only APIs:
 * `getCollection`/`getEntry`/per-collection helpers, `getGlobals`/
 * `getNavigation`/`getAnnouncement`, `submitForm`, `getRedirects` +
 * `PROXY_MIDDLEWARE_SNIPPET`. `collections` should be the client's own
 * `storage = 'generic'` collections (native/global collections excluded by
 * the caller — see `sdk/route.ts`).
 *
 * Deliberately does NOT include `createPreviewHandler`/
 * `createRevalidateHandler` or any Node-only import — those live in the
 * separate `lib/cms-server.ts` output (`generateV2ServerSdk` below) so that
 * this file remains safe to `import` from a client repo's own
 * `middleware.ts` (see the file header's "Two files for v2" section).
 */
export function generateV2Sdk(slug: string, cmsBase: string, collections: SdkCollectionInput[]): string {
  const v1 = generateV1Sdk(slug, cmsBase);
  const core = buildV2Core();
  const collectionSections = collections.map(generateCollectionSection).join('\n');

  return `${v1}
// ---------------------------------------------------------------------------
// v2 additions — collections, globals, forms, redirects
// (preview + revalidate handlers are in the separate lib/cms-server.ts —
// see generateV2ServerSdk)
// ---------------------------------------------------------------------------

${core}
${collectionSections}`;
}

/**
 * Generates the v2 `lib/cms-server.ts` source for one client — the
 * server/Node-only companion file to `lib/cms.ts`. Contains
 * `createPreviewHandler`/`createRevalidateHandler` plus the Node.js
 * (`crypto`) and App-Router-only (`next/cache`, `next/headers`,
 * `next/navigation`) imports those two factories need. Meant to be imported
 * from Route Handlers (`app/api/preview/route.ts`, `app/api/revalidate/
 * route.ts`) — never from `middleware.ts` (see the file header's "Two files
 * for v2" section for why).
 *
 * Declares its own local `CMS_BASE`/`CLIENT_SLUG` consts rather than
 * importing them from `lib/cms.ts` — v1's own `CMS_BASE`/`CLIENT_SLUG` are
 * intentionally not exported (exporting them would change `generateV1Sdk`'s
 * byte-identical output), and keeping this file self-contained means it
 * never breaks if `lib/cms.ts` is missing, edited, or generated separately.
 *
 * ## Preview flow design (createPreviewHandler)
 *
 * `handlePreview` (CMS `posts/[id]/page.tsx`, Task 3.3) mints a
 * `preview_tokens` row and opens `{website_url}/api/preview?token=...` in a
 * new tab — a URL on the CLIENT'S OWN site. Nothing before this task
 * resolved that token into content, so `createPreviewHandler(secret)` here
 * is the generated CLIENT-SIDE half of that flow, paired with the new
 * CMS-side `GET /api/client/[slug]/preview?token=` endpoint
 * (`src/app/api/client/[slug]/preview/route.ts`).
 *
 * Flow: the client site's own `app/api/preview/route.ts` does
 * `export const GET = createPreviewHandler(process.env.CMS_PREVIEW_SECRET)`.
 * The returned handler:
 *   1. Reads `?token=` off its OWN incoming request (the URL the CMS opened).
 *   2. Calls back to the CMS's `/api/client/[slug]/preview?token=...`,
 *      passing `secret` as an `x-ne-preview-secret` header.
 *   3. On success, gets back `{ entityType, path, data }` for the draft/
 *      scheduled/in-review entity the token names.
 *   4. Enables Next's Draft Mode (`(await draftMode()).enable()`) and
 *      redirects the browser to `path` — the site's own normal rendering
 *      then picks up Draft Mode and (in code this generator does NOT write)
 *      fetches draft content instead of published.
 *   5. A non-OK callback (expired/invalid/wrong-client token) 404s here too,
 *      rather than silently enabling Draft Mode with no real content.
 *
 * `secret`'s role — reusing `client_publish_config.revalidate_secret`:
 * The task brief leaves `secret`'s exact value to this task's judgment. This
 * generator reuses the SAME `revalidate_secret` already stored in
 * `client_publish_config` (Task 7.1) rather than introducing a second,
 * preview-specific secret column: it is already the one shared value known
 * only to the CMS and that one client's site, provisioning a new column (and
 * migration) purely to hold a second copy of the same trust relationship
 * would be speculative for what this task needs. The CMS-side preview route
 * validates the `x-ne-preview-secret` header against that same value —
 * see that route's file for why the check is skipped (not required) when a
 * client hasn't configured Publishing yet, so a client on the v2 SDK who
 * hasn't set up `client_publish_config` isn't unable to preview at all.
 * This raises the bar over "possession of the token alone": a preview token
 * can leak via browser history, a referrer header, or analytics; requiring
 * a second, server-side-only secret the token itself never appears in means
 * a leaked token alone can't be replayed by a third party who doesn't also
 * hold the client site's own environment secret.
 */
export function generateV2ServerSdk(slug: string, cmsBase: string): string {
  return `// lib/cms-server.ts - generated by NE Website Manager
// Server/Node-only companion to lib/cms.ts. Do NOT import this file from
// middleware.ts — it uses Node.js APIs (crypto) and App-Router server-only
// APIs (next/headers, next/navigation) that are unsupported in the Edge
// Runtime, which Next.js Middleware uses by default. Safe to import from
// Route Handlers (app/api/.../route.ts) and other server-only code.
${V2_SERVER_IMPORTS}
const CMS_BASE = '${cmsBase}';
const CLIENT_SLUG = '${slug}';

export interface CmsPreviewEntity {
  entityType: 'post' | 'page' | 'collection_entry';
  path: string;
  data: Record<string, unknown>;
}

/**
 * Returns a Route Handler (\`GET\`) for this site's own \`app/api/preview/route.ts\`:
 *
 *   export const GET = createPreviewHandler(process.env.CMS_PREVIEW_SECRET!);
 *
 * \`secret\` must match this client's \`revalidate_secret\` configured in the
 * CMS's Settings -> Publishing tab (the same secret \`createRevalidateHandler\`
 * below verifies inbound webhooks with) — see the generator's own comments
 * for why this reuses that value rather than a second preview-only secret.
 */
export function createPreviewHandler(secret: string) {
  return async function GET(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    if (!token) return new Response('Missing token', { status: 400 });

    let res: Response;
    try {
      res = await fetch(
        \`\${CMS_BASE}/api/client/\${CLIENT_SLUG}/preview?token=\${encodeURIComponent(token)}\`,
        { headers: { 'x-ne-preview-secret': secret }, cache: 'no-store' }
      );
    } catch {
      return new Response('Preview lookup failed', { status: 502 });
    }

    if (!res.ok) return new Response('Invalid or expired preview link', { status: 404 });

    const entity = (await res.json()) as CmsPreviewEntity;

    const draft = await draftMode();
    draft.enable();

    redirect(entity.path);
  };
}

/**
 * Returns a Route Handler (\`POST\`) for this site's own \`app/api/revalidate/route.ts\`:
 *
 *   export const POST = createRevalidateHandler(process.env.CMS_REVALIDATE_SECRET!);
 *
 * Verifies \`x-ne-signature\` — a hex HMAC-SHA256 of the exact raw request
 * body, keyed by \`secret\` — using the SAME algorithm the CMS's
 * \`notifyPublish\`/\`signPayload\` (\`src/lib/publish.ts\`) uses to sign it, so
 * this must byte-for-byte match that scheme or every real delivery fails
 * verification. \`secret\` is this client's \`revalidate_secret\`, configured
 * in the CMS's Settings -> Publishing tab.
 */
export function createRevalidateHandler(secret: string) {
  return async function POST(req: Request): Promise<Response> {
    const rawBody = await req.text();
    const signature = req.headers.get('x-ne-signature') ?? '';
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    const valid = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
    if (!valid) return new Response('Invalid signature', { status: 401 });

    let payload: { entityType?: string; slug?: string | null };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response('Invalid JSON body', { status: 400 });
    }

    if (payload.slug) revalidatePath(\`/\${payload.slug}\`);
    if (payload.entityType) revalidateTag(payload.entityType);

    return Response.json({ revalidated: true });
  };
}
`;
}
