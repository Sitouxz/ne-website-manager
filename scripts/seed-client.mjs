// Seeds (or re-seeds) a client's CMS content from a seed JSON exported by the
// client site's `export-cms-seed` script. Idempotent: select-then-update/insert
// everywhere; only `menu_items` (location='public', this client) is
// delete+reinsert since nav has no natural unique key.
//
// Usage:
//   node --env-file=.env.local scripts/seed-client.mjs \
//     --file ../zhenghelogistics/site/docs/cms-seed.json \
//     --website-url https://<site-domain> \
//     [--revalidate-url https://<site-domain>/api/revalidate] \
//     [--create-user editor@example.com <password>] [--dry-run]
//
// SEED_REVALIDATE_SECRET env var (never a flag — keeps it out of shell history
// files) sets client_publish_config.revalidate_secret when provided.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
function flag(name) {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1] ?? null
}
const DRY = args.includes('--dry-run')
const filePath = flag('--file')
const websiteUrl = flag('--website-url')
const revalidateUrl = flag('--revalidate-url') ?? (websiteUrl ? `${websiteUrl.replace(/\/+$/, '')}/api/revalidate` : null)
const createUserIdx = args.indexOf('--create-user')
const newUser = createUserIdx === -1 ? null : { email: args[createUserIdx + 1], password: args[createUserIdx + 2] }

if (!filePath || !websiteUrl) {
  console.error('Required: --file <seed.json> --website-url <url>')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (use node --env-file=.env.local)')
  process.exit(1)
}

const seed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
const db = createClient(url, key, { auth: { persistSession: false } })

function fail(step, error) {
  console.error(`FAILED at ${step}:`, error.message ?? error)
  process.exit(1)
}

async function selectOne(table, match) {
  const { data, error } = await db.from(table).select('*').match(match).maybeSingle()
  if (error) fail(`select ${table}`, error)
  return data
}

// `insertOnlyValues` are applied only when inserting a brand-new row — they
// are never sent on an update, so a routine re-seed can't clobber a value an
// operator has deliberately changed out-of-band (e.g. clients.is_active).
async function upsertBy(table, match, values, insertOnlyValues = {}) {
  const existing = await selectOne(table, match)
  if (DRY) {
    console.log(`[dry-run] ${existing ? 'update' : 'insert'} ${table}`, JSON.stringify(match))
    // Fake id must be a valid uuid: downstream selects filter on foreign-key
    // uuid columns (e.g. client_id), and a non-uuid placeholder would fail
    // those queries with "invalid input syntax for type uuid".
    return existing ?? { id: crypto.randomUUID() }
  }
  if (existing) {
    const { data, error } = await db.from(table).update(values).match(match).select().single()
    if (error) fail(`update ${table}`, error)
    return data
  }
  const { data, error } = await db.from(table).insert({ ...match, ...values, ...insertOnlyValues }).select().single()
  if (error) fail(`insert ${table}`, error)
  return data
}

// 1. Client
// is_active is insert-only: on re-seed of an existing client, leave whatever
// the operator has set (e.g. a deliberate deactivation) untouched.
const client = await upsertBy(
  'clients',
  { slug: seed.client.slug },
  { name: seed.client.name, website_url: websiteUrl },
  { is_active: true },
)
console.log(`client ${seed.client.slug} -> ${client.id}`)

// 2. Site globals (one row per key)
for (const [gKey, value] of Object.entries(seed.site_globals)) {
  await upsertBy('site_globals', { client_id: client.id, key: gKey }, { value })
  console.log(`site_globals.${gKey} ok`)
}

// 3. Navigation: delete+reinsert public menu for this client only
if (!DRY) {
  const { error: delErr } = await db.from('menu_items').delete().match({ client_id: client.id, location: 'public' })
  if (delErr) fail('delete menu_items', delErr)
  for (const item of seed.menu_items) {
    // Explicit location keeps the reinsert self-contained and in sync with
    // the delete's own scoping above, regardless of what the seed JSON has.
    const { error } = await db.from('menu_items').insert({ ...item, client_id: client.id, location: 'public' })
    if (error) fail('insert menu_items', error)
  }
}
console.log(`menu_items x${seed.menu_items.length} ok`)

// 4. Pages
for (const page of seed.pages) {
  const { path, ...values } = page
  await upsertBy('pages', { client_id: client.id, path }, values)
  console.log(`page ${path} ok`)
}

// 5. Forms
for (const form of seed.forms) {
  const { slug, ...values } = form
  await upsertBy('forms', { client_id: client.id, slug }, values)
  console.log(`form ${slug} ok`)
}

// 6. Collections + items
for (const [index, collection] of seed.collections.entries()) {
  const { slug, items, ...values } = collection
  const row = await upsertBy(
    'collections',
    { client_id: client.id, slug },
    { ...values, storage: 'generic', sort_order: index },
  )
  for (const [itemIndex, item] of items.entries()) {
    await upsertBy(
      'collection_items',
      { collection_id: row.id, client_id: client.id, slug: item.slug },
      { data: item.data, status: 'published', sort_order: itemIndex, published_at: new Date().toISOString() },
    )
  }
  console.log(`collection ${slug} (+${items.length} items) ok`)
}

// 7. Publish config (revalidate webhook target + shared secret)
const publishValues = { revalidate_url: revalidateUrl }
if (process.env.SEED_REVALIDATE_SECRET) publishValues.revalidate_secret = process.env.SEED_REVALIDATE_SECRET
await upsertBy('client_publish_config', { client_id: client.id }, publishValues)
console.log(`client_publish_config ok (secret ${process.env.SEED_REVALIDATE_SECRET ? 'set' : 'unchanged'})`)

// 8. Optional client_admin login
if (newUser?.email && newUser?.password && !DRY) {
  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email: newUser.email,
    password: newUser.password,
    email_confirm: true,
    user_metadata: { full_name: seed.client.name },
  })
  if (authErr) fail('create auth user', authErr)
  const { error: profErr } = await db
    .from('profiles')
    .update({ client_id: client.id, role: 'client_admin' })
    .eq('id', authData.user.id)
  if (profErr) fail('link profile', profErr)
  console.log(`client_admin user ${newUser.email} ok`)
}

console.log(DRY ? 'DRY RUN complete — no writes made' : 'Seed complete')
