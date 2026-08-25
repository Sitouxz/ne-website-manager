/**
 * Moves a generic collection's entries into the first-class `posts` table.
 *
 * Written for Zhenghe, whose blog was set up as an `insights` collection and
 * so had no scheduling and no approval step — both live only on `posts`. The
 * mapping is deliberately explicit rather than clever, because the two shapes
 * genuinely differ: a collection entry keeps everything in `data` jsonb, while
 * a post has real columns.
 *
 *   data.title              -> title
 *   data.description        -> excerpt
 *   data.body.html          -> content
 *   data.body.json          -> content_json   (Tiptap doc, so the editor
 *                                              round-trips instead of
 *                                              re-parsing the HTML)
 *   data.coverImage.url/alt -> cover_url / cover_alt
 *   data.seoTitle/…         -> seo_title / seo_description
 *   status, published_at    -> carried across unchanged
 *
 * `data.eyebrow` and `data.date` have no column and are dropped on purpose:
 * every entry's eyebrow is already the site's own default, and `date` is
 * always the same day as `published_at`, which the site reads instead.
 *
 * Idempotent — an existing post with the same slug is updated, not duplicated.
 *
 *   node --env-file=.env.local scripts/collection-to-posts.mjs \
 *     --collection <uuid> [--apply]
 */

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const collectionId = args[args.indexOf('--collection') + 1]

if (!URL_ || !SVC) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!collectionId || collectionId.startsWith('--')) {
  console.error('Usage: --collection <uuid> [--apply]')
  process.exit(1)
}

const db = (path, init = {}) => fetch(`${URL_}${path}`, {
  ...init,
  headers: {
    apikey: SVC,
    Authorization: `Bearer ${SVC}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...(init.headers || {}),
  },
})

const [collection] = await (await db(`/rest/v1/collections?id=eq.${collectionId}&select=slug,name,client_id`)).json()
if (!collection) {
  console.error('Collection not found')
  process.exit(1)
}

const items = await (await db(`/rest/v1/collection_items?collection_id=eq.${collectionId}&select=slug,status,data,published_at,created_at`)).json()
const existing = await (await db(`/rest/v1/posts?client_id=eq.${collection.client_id}&select=id,slug`)).json()
const bySlug = new Map(existing.map((p) => [p.slug, p.id]))

console.log(`collection "${collection.name}" (${collection.slug}) — ${items.length} entries`)
console.log(`client already has ${existing.length} posts`)
console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`)

for (const item of items) {
  const d = item.data ?? {}
  const body = d.body ?? {}
  const cover = d.coverImage ?? null

  const html = typeof body === 'string' ? body : body.html
  const json = typeof body === 'string' ? null : (body.json ?? null)

  if (!d.title || !html) {
    console.log(`  ${item.slug}: SKIPPED — missing title or body`)
    continue
  }

  const post = {
    client_id: collection.client_id,
    title: d.title,
    slug: item.slug,
    content: html,
    content_json: json,
    excerpt: d.description ?? '',
    cover_url: cover?.url ?? null,
    cover_alt: cover?.alt ?? null,
    seo_title: d.seoTitle ?? null,
    seo_description: d.seoDescription ?? null,
    status: item.status,
    published_at: item.published_at,
  }

  const id = bySlug.get(item.slug)
  console.log(`  ${item.slug}: ${id ? 'update' : 'insert'} — "${post.title}" [${post.status}] ${html.length} chars${json ? ' +json' : ''}`)

  if (!APPLY) continue

  const res = id
    ? await db(`/rest/v1/posts?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(post) })
    : await db('/rest/v1/posts', { method: 'POST', body: JSON.stringify(post) })

  if (!res.ok) console.log(`    FAILED ${res.status}: ${(await res.text()).slice(0, 200)}`)
  else console.log('    ok')
}

if (!APPLY) console.log('\nNothing written. Re-run with --apply.')
