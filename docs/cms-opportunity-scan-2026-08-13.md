# NE CMS — Opportunity Scan

**Date:** 13 August 2026
**Method:** market scan of the 2026 headless CMS field (Sanity, Storyblok, Contentful,
Payload, DatoCMS, Strapi, Directus, Hygraph) and of agency content-ops practice,
filtered against what this repo already does.
**Filter applied:** only things that (a) a Neu Entity operator or a mosque
administrator would actually use, and (b) survive the Stage 0 freeze — no new
native tables, no per-client constants.

---

## Where this CMS already stands

Better than the scan expected. Against the 2026 feature checklists, NE CMS already
has: media library, rich text, revisions + restore, autosave, scheduled publishing,
draft preview tokens, dynamic collections with a real field system (`taglist`,
`repeater`, `number.format`, groups), site globals, forms + leads with honeypot,
SEO manager with redirects and audit, team roles + invites, HMAC publish webhooks
with a delivery log, per-client API keys, SDK v1/v2 codegen with a compatibility
guarantee, analytics rollups, activity log, onboarding templates, bulk actions.

The gaps below are not "missing table stakes." They are the four or five things the
commercial platforms shipped in the last 18 months, plus two integrity problems
this repo has that only bite at scale.

---

## 1. Content Releases — bundle changes, publish them together

**What the market did.** Sanity's flagship editorial feature of the last year is
[Content Releases](https://www.sanity.io/blog/introducing-content-releases): name a
release, add documents to it across content types, preview the whole thing as a set,
then publish on schedule or on demand — including *removals* for expired promotions.
It replaced the "DO NOT PUBLISH — waiting for the rest" convention every editorial
team invents on its own. It is an Enterprise add-on there, which is a fair signal of
how much they think it's worth.

**Why it fits here.** This CMS schedules *one entity at a time*
(`/api/cron/publish-scheduled`, every 5 minutes). But NE's real unit of work is not
one entity — it's a campaign: the Ramadan schedule entry, the homepage banner global,
a nav item, and three posts all need to go live at 00:00 together, and right now that
is four separately-scheduled items that will land in four separate revalidations, in
whatever order the cron happens to see them. A half-published campaign is exactly the
"silently stale site found by the client" failure the multi-tenancy plan already
worries about.

**What it touches.** A `releases` table + a nullable `release_id` on the publishable
entities; the existing cron flips the whole set in one transaction; `firePublishNotify`
fires **once** per release rather than once per row (a real efficiency win on the
webhook side); the preview route already supports every entity type, so a
release-level preview is mostly a list of existing preview links.

**Cost:** medium. **Value:** high. This is the best ratio in the scan.

---

## 2. An MCP server for the CMS

**What the market did.** By mid-2026, Sanity, Contentful, Storyblok, Strapi, Payload,
Directus, Hygraph and Kontent.ai all ship MCP servers — it went from novelty to
[expected component](https://www.rwit.io/blog/why-every-headless-cms-will-need-an-mcp-server-in-2026)
in about a year. The pattern that stuck is agent-with-write-access-to-drafts, not
autonomous publishing.

**Why it fits here — harder than for anyone else.** NE runs one operator across many
client sites, and that operator already works in Claude Code all day. Every bulk
content job this CMS will ever need — "fill the missing search descriptions for
al-islah", "migrate the 40 Kamal Karim properties into the `listings` collection",
"which entries reference this media item", "onboard client #4 from the services
template" — is either a bespoke UI screen or an MCP tool call. The UI screen serves a
mosque administrator; the MCP tool serves you. Building the second is much cheaper
than building the first, and Stage 4's properties migration is a concrete first job
for it.

**What it touches.** `src/app/api/mcp/route.ts` over the *existing* primitives:
`api_keys` with scopes already exists (`src/lib/api/auth.ts`), RLS already scopes every
query, `logActivity` already records who did what. Constrain writes to draft status
and let the human publish — that keeps the whole thing inside the existing
publish-RLS posture (migrations 015/016) rather than around it.

**Cost:** low-medium. **Value:** high, and disproportionately to NE specifically.

---

## 3. Click-to-edit visual preview

**What the market did.** Visual editing is the headline 2026 differentiator across
[dotCMS](https://www.dotcms.com/blog/top-5-visual-headless-cms-editors), Storyblok,
Sanity and DatoCMS. The mature implementation is not a page builder — it is
*overlays*: content is fetched in draft mode with source-map metadata encoded into the
strings ("stega"), a `<VisualEditing/>` component reads it from the DOM, draws a
click target on every editable element, and clicking it jumps the CMS to that exact
field. See [Sanity's App Router guide](https://www.sanity.io/docs/visual-editing/visual-editing-with-next-js-app-router)
and [DatoCMS's](https://www.datocms.com/docs/next-js/visual-editing).

**Why it fits here.** PRODUCT.md principle 4 is literally "show before committing,"
and the UX audit's prescription was "a controlled visual CMS, not a freeform page
builder" — which is precisely what overlays are. More importantly, **NE is in a rare
position to build this cheaply**: it owns both halves. `src/lib/sdk/generate.ts`
already generates the client site's data layer, so it can emit the editable-field
attributes at the same time. Nobody using Sanity gets to do that; they have to bolt
on a separate package.

**Honest cost.** This is the expensive one — it needs a preview pane in the editor, an
overlay script, a field-focus protocol between iframe and parent, and a v2 SDK bump
across three live client sites. Worth planning, not worth starting before items 1, 2
and 6.

---

## 4. AI assist with guardrails — alt text and search descriptions

**What the market did.** Of all the AI features CMS vendors shipped, the two with real
adoption are unglamorous: **alt-text generation** and **meta-description suggestion**,
both as *suggestions the editor accepts, edits or replaces* — never as silent
automation. Vendors that shipped autonomous generation report brand inconsistency and
SEO cannibalization.

**Why it fits here.** This CMS already knows exactly where these are missing, and
already says so: `src/lib/publish-checks.ts` warns "screen readers and Google can't
tell what this picture shows", and walks repeaters two levels deep to find them.
`isMissingSeo` powers the SEO manager and the dashboard count. Today those warnings
give a mosque administrator a job they don't know how to do. A "Suggest" button next
to the warning turns each one into a one-click fix, with the human still deciding —
which is the exact posture the publish-checks module already argues for ("warnings,
never blocks... quality is the author's call").

**What it touches.** `media.alt` already exists in migration 001. One server route, a
button in the media detail panel and the publish-preflight dialog. Nothing structural.

**Cost:** low. **Value:** medium-high, and it lands on the exact friction the product
already identified.

---

## 5. Localization — decide now, not after Stage 4

**Finding:** there is no locale concept anywhere in the codebase. Not a field, not a
column, not a route param.

**Why it's urgent rather than merely missing.** Singapore. A bilingual EN/ZH client is
not a hypothetical — Zheng He Logistics is already on the platform, and any mosque or
government-adjacent client can ask for ZH/MS/TA at any time. Today the only answers
are "duplicate every entry" or "a new native table," and the second one violates the
Stage 0 freeze. The reason to decide *now* is that Stage 4 migrates `properties` into
collections and effectively freezes the entry data shape for the platform's largest
content set; retrofitting locale afterwards means migrating it twice.

**The cheap decision.** Per-*entry* locale (`collection_items.locale` + a
`translation_of` self-reference) is far simpler than per-*field* locale, keeps the
existing SDK response shape intact for single-locale clients, and matches how the
field system already works. It does not need building now — it needs deciding now, and
recording in the multi-tenancy plan next to Decision 1.

---

## 6. Schema changes are silently destructive

**Finding, verified in code.** `src/app/(app)/cms/collections/[id]/schema/page.tsx`
supports add / remove / reorder only, with no rename. `handleRemoveField` drops the
field and cleans up `title_field` / `list_columns` / `list_filters` — and that is all
it does. The page never queries `collection_items`, so:

- Nobody is told how many existing entries hold data under that key.
- That data stays in `collection_items.data` as an orphan: invisible in the editor,
  unreachable, and gone from the next SDK type generation.
- There is no confirmation step. Removing a field with 40 entries behind it is one
  click, and the recovery path is re-adding the key at the exact original spelling.
- The live site's typed SDK loses the field on the next codegen.

**What the market does.** The consensus practice is
[additive-first with explicit deprecation](https://www.enterprisecms.org/guides/versioning-strategies-for-enterprise-content-models):
add before you remove, migrate in small batches, preview the impact of a breaking
change before removing the legacy field, keep schema in version control and review it
like a pull request.

**The proportionate fix here** — not a migration framework:

1. Count first. "This field has content in 23 of 40 entries" before the remove button
   does anything.
2. Deprecate rather than delete: hide from the editor, keep in the data and in the
   SDK, remove for real later.
3. Support rename as a real operation (key change + data key migration), since
   remove+re-add is currently the documented workaround and it destroys data.
4. Warn when a removed field is referenced by a published entry — the live site is
   about to lose it.

**Cost:** low. **Value:** high — this is the kind of bug that is invisible at 3 clients
and unrecoverable at 20. It should land *before* Stage 4, not after.

---

## 7. Process: a scheduled site-health sweep

**What the market does.** Agency practice converged on
[monthly QA sweeps](https://www.mass.gov/info-details/conducting-monthly-quality-assurance-qa-checks-on-your-web-content)
per client site: broken links, missing alt text, redirect problems, and redundant or
obsolete content. Governance platforms exist purely to do this across many sites.

**Why it fits here.** The cron infrastructure exists (`vercel.json` runs two jobs
already) and most of the checks are already written as functions —
`publish-checks.ts` finds missing alt and empty hrefs, `seo/audit.ts` finds missing
metadata, `media/usage.ts` finds orphan media, `webhook_deliveries` records every
failed revalidation. What's missing is anything that runs them *on a schedule against
already-published content*, rather than at the moment of publishing.

A weekly `/api/cron/site-health` writing a per-client report, surfaced on the
dashboard and emailed to the operator, converts a set of already-built functions into
the thing that separates an agency retainer from a CMS login: **NE finds the stale
page before the client does.** That is a commercial argument, not just a technical one.

---

## 8. Smaller, worth noting

- **`llms.txt` and markdown mirrors.** Only ~3% of sites publish one, and the honest
  reading of the evidence is that
  [AI crawlers mostly ignore the file](https://seeklab.io/blog/what-is-llmstxt-the-honest-2026-guide/)
  and read HTML anyway. But the SEO feed (`/api/client/[slug]/seo`) already knows every
  published path, so generating one is nearly free, and it is a visible deliverable to
  sell to clients asking about AI search. Do it when the seo feed gets its v2 bump —
  not as its own project, and without overselling it.
- **The public SEO feed still emits `{ path, updated_at }` only.** Already flagged in
  the multi-tenancy plan as needing a v2 opt-in. It blocks both the item above and any
  real AEO story.
- **Search is still a non-functional `div` in the top bar** (UX audit, P1). A command
  palette over content + media + clients + settings is the single highest-frequency
  interaction in a multi-client tool.

---

## Recommended sequence

```
Now, before Stage 4    6. Schema-change safety      (low cost, prevents data loss)
                       5. Localization DECISION     (costs nothing, saves a re-migration)

Next                   2. MCP server                (low-medium; makes Stage 4 itself easier)
                       1. Content Releases          (medium; the real editorial unlock)

Then                   4. AI alt text + descriptions (low; retires the top publish warnings)
                       7. Site-health cron          (low; mostly wiring existing functions)

Plan, don't start      3. Click-to-edit visual preview (needs an SDK v2 bump across 3 live sites)
```

---

## Sources

- [Introducing Content Releases — Sanity](https://www.sanity.io/blog/introducing-content-releases)
- [Content Releases: schedule and coordinate content launches — Sanity](https://www.sanity.io/content-releases)
- [Why Every Headless CMS Will Need an MCP Server in 2026 — RWIT](https://www.rwit.io/blog/why-every-headless-cms-will-need-an-mcp-server-in-2026)
- [Agentic CMS in 2026: Which Platform Is Actually AI-Ready? — FocusReactive](https://focusreactive.com/blog/agentic-cms/)
- [Top 5 Visual Headless CMS Editors — dotCMS](https://www.dotcms.com/blog/top-5-visual-headless-cms-editors)
- [Visual Editing with Next.js App Router — Sanity Docs](https://www.sanity.io/docs/visual-editing/visual-editing-with-next-js-app-router)
- [Next.js Visual Editing — DatoCMS Docs](https://www.datocms.com/docs/next-js/visual-editing)
- [Multi-tenant CMS: scalable solutions with headless flexibility — FocusReactive](https://focusreactive.com/multi-tenant-cms/)
- [Versioning strategies for enterprise content models — Enterprise CMS Guide](https://www.enterprisecms.org/guides/versioning-strategies-for-enterprise-content-models)
- [Using generative AI for content management — Magnolia](https://www.magnolia-cms.com/blog/generative-ai-content-management.html)
- [Conducting monthly QA checks on your web content — Mass.gov](https://www.mass.gov/info-details/conducting-monthly-quality-assurance-qa-checks-on-your-web-content)
- [What is llms.txt? The honest 2026 guide — SeekLab](https://seeklab.io/blog/what-is-llmstxt-the-honest-2026-guide/)
