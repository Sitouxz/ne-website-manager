import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node
globalThis.HTMLElement = dom.window.HTMLElement

const { generateJSON } = await import('@tiptap/core')
const StarterKit = (await import('@tiptap/starter-kit')).default
const Link = (await import('@tiptap/extension-link')).Link ?? (await import('@tiptap/extension-link')).default
const Image = (await import('@tiptap/extension-image')).Image ?? (await import('@tiptap/extension-image')).default
// Must mirror RichTextEditor.tsx's `extensions` exactly, so the JSON this
// script generates is byte-for-byte what the editor itself would have
// produced from the same HTML. Placeholder is editor-chrome only and has no
// effect on the parsed document, so it is deliberately omitted.
const extensions = [
  StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: false, underline: false }),
  Link.configure({ openOnClick: false, autolink: true }),
  Image,
]

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const COLLECTION_ID = '96e8901d-e5d8-4ce1-aee9-53be6f85cffe'
const APPLY = process.argv.includes('--apply')

const db = (p, i = {}) => fetch(`${URL_}${p}`, { ...i, headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(i.headers || {}) } })

const items = await (await db(`/rest/v1/collection_items?collection_id=eq.${COLLECTION_ID}&select=id,slug,data`)).json()
console.log(`${items.length} insight entries; mode=${APPLY ? 'APPLY' : 'DRY RUN'}\n`)

for (const item of items) {
  const body = item.data?.body
  if (typeof body !== 'string') { console.log(`  ${item.slug}: already ${typeof body} — skipped`); continue }
  const json = generateJSON(body, extensions)
  const blocks = json.content?.length ?? 0
  console.log(`  ${item.slug}: ${body.length} chars HTML -> tiptap doc with ${blocks} top-level blocks`)
  if (!blocks) { console.log('    !! empty parse, refusing'); continue }
  if (APPLY) {
    const res = await db(`/rest/v1/collection_items?id=eq.${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ data: { ...item.data, body: { json, html: body } } }),
    })
    console.log('    updated ->', res.status)
  }
}

if (APPLY) {
  const [col] = await (await db(`/rest/v1/collections?id=eq.${COLLECTION_ID}&select=fields`)).json()
  const fields = col.fields.map((f) => {
    if (f.key === 'body') return { ...f, type: 'richtext', label: 'Body', help: 'Write the article here. Formatting, links and images are supported.' }
    if (f.key === 'date') return { ...f, type: 'date', help: 'Publication date shown on the article card.' }
    if (f.key === 'eyebrow') return { ...f, help: 'Small label above the title. Leave blank for "Insights".' }
    if (f.key === 'description') return { ...f, type: 'textarea', help: 'One or two sentences shown on the Insights listing and in search results.' }
    if (f.key === 'seoTitle') return { ...f, group: 'SEO', help: 'Optional. Defaults to the title.' }
    if (f.key === 'seoDescription') return { ...f, type: 'textarea', group: 'SEO', help: 'Optional. Defaults to the description.' }
    return f
  })
  const res = await db(`/rest/v1/collections?id=eq.${COLLECTION_ID}`, { method: 'PATCH', body: JSON.stringify({ fields }) })
  console.log('\nschema updated ->', res.status)
  console.log(JSON.stringify((await res.json())[0].fields, null, 1))
}
