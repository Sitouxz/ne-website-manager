# The Site Runtime

**Date:** 13 August 2026
**Status:** proposal, not a plan. Nothing here should be built before the decision
in "Why now" is taken.
**Companion to:** `cms-multitenancy-plan.md` (which this extends by one layer) and
`cms-opportunity-scan-2026-08-13.md` (which this supersedes in ambition).

---

## The observation

The multi-tenancy plan opens with a thesis worth re-reading:

> onboarding a new client is configuration rather than code

Stages 1–5 delivered that thesis **for content**. A new client's content model is now
a dropdown in the New Client dialog: collections, capabilities, globals and navigation
all arrive from a template in `src/lib/templates/catalog.ts`, no repo access required.
That was the right fight and it was won.

But look at what onboarding client #4 actually costs today, now that the content half
is free:

| Layer | Cost of client #4 | Status |
| --- | --- | --- |
| Content model | Dropdown | **Solved** (Stage 5) |
| CMS modules | Row update (`capabilities`) | **Solved** (Stage 3) |
| Tenant isolation | Automatic (RLS) | **Solved** |
| Publishing | Automatic (webhooks + config) | **Solved** |
| **The website itself** | **Design + a bespoke Next.js repo + SDK wiring + deploy + a domain + maintenance forever** | **Untouched** |

The plan eliminated the small cost and left the large one. Every remaining unit of NE's
scaling problem now lives in that last row: 3 client repos today, 20 later. Twenty
Next.js major upgrades. Twenty dependency-audit surfaces. Twenty deployment configs.
Twenty codebases drifting away from each other and from whatever NE's design system
looked like the year each was built. And a services business where every new client
requires a build, which is the definition of revenue that does not compound.

**The proposal is to extend the plan's own thesis one layer up: the client website
stops being a repo and becomes a row.**

---

## What it is

One multi-tenant Next.js application — the **Site Runtime** — deployed once, serving
every NE client site. A request arrives on `alislah.sg`; the runtime resolves the
hostname to a `client_id`, loads that client's theme, navigation, globals and page
composition from Supabase, and renders. The same deployment serves
`kamalkarim.com` and every client after it.

This is a well-trodden path, not an invention: it is exactly what
[Vercel for Platforms](https://vercel.com/docs/multi-tenant) exists to support, with the
Domains API handling programmatic custom domains and SSL, and hostname-based routing
in middleware doing the tenant resolution. The
[platforms starter kit](https://vercel.com/templates/next.js/platforms-starter-kit) is
the reference implementation.

**A page becomes a composition of blocks.** Each client gets its own **block registry** —
a namespaced set of React components NE designs for that client (`alislah/PrayerTimes`,
`kamal-karim/ListingSearch`, plus a shared library of `Hero`, `RichText`, `CardGrid`,
`ContactForm`). The CMS stores which blocks a page uses, in what order, with what
content. The runtime renders them.

### This is not the page builder PRODUCT.md rejects

PRODUCT.md's anti-reference is *"a completely free-form page builder that can silently
break Neu Entity's custom-coded client sites."* A per-client block registry is the
opposite of free-form: an editor can only place blocks NE built and designed for that
specific site, in slots NE allowed. They cannot invent a layout, change a colour, or
break a breakpoint. The UX audit already prescribed exactly this and called it the safe
direction — *"a controlled visual CMS: site-specific block registries"*. It is the same
distinction [Storyblok draws](https://www.storyblok.com/mp/pagebuilder-cms) between
component-block authoring and a page builder.

**Design differentiation is preserved because the registry is per client.** What gets
shared across all twenty sites is the *runtime* — routing, rendering, caching, image
handling, forms, analytics, SEO, the upgrade path. Not the look. Two NE sites can share
zero blocks and still share one deployment.

---

## Why now, specifically

Because **Decision 3 in the multi-tenancy plan is the door, and it is currently open.**

> **3. Page sections:** are page sections a `repeater` field on pages (reuses Stage 1
> wholesale), or a separate block model? Recommend the repeater — it's one system to
> build and maintain, and pages become just another schema.

That recommendation is already correct on its own terms. But it is worth more than the
plan claims, because *once a page is a list of typed, ordered sections, it is already a
render tree.* The gap between "page sections as a repeater" and "a generic renderer that
walks the repeater and mounts a component per section type" is small — and it only stays
small if the section schema is designed with rendering in mind rather than as a
free-form field bag.

Decide Decision 3 *knowing where it leads*, and the runtime costs one well-shaped schema
plus a renderer. Decide it as a local convenience and the schema will need redoing later.
That is why this document exists now rather than after Stage 4.

---

## Why it is not a rewrite

The instinctive objection is "we have three live sites, we can't migrate them." Correct —
and unnecessary.

**New clients are born on the runtime. Existing sites move only when they were going to
be rebuilt anyway.**

Client #4 is the first runtime-native site. Al-Islah, Kamal Karim and Zheng He keep
their repos and their v1/v2 SDKs, indefinitely, with no cutover deadline and no
degradation — the SDK's byte-for-byte v1 compatibility guarantee already protects them.
A repo-based site migrates the next time a client commissions a redesign, which is
billable work NE would be doing regardless. There is never a big-bang weekend.

This is the property that makes the bet asymmetric: **the downside is capped at the cost
of building client #4's site twice**, and the upside compounds across every client after.

---

## What it deletes

Not just "we stop making repos." Whole subsystems in this codebase exist only to bridge
the gap between the CMS and a separate site, and stop being needed for runtime-native
clients:

- **The SDK generator** (`src/lib/sdk/generate.ts`, 734 lines) and its v1/v2 compatibility
  burden. The runtime queries Supabase directly. No generated client, no version skew,
  no `?v=2` opt-in.
- **The GitHub PR push machinery** (`api/admin/push-integration`, 189 lines) — there is
  no repo to push to.
- **The preview-token round trip.** Today: mint a token, open a URL on the client's site,
  which calls *back* into the CMS with a shared secret, which re-implements every RLS
  rule by hand because the service-role client bypasses them. On the runtime, preview is
  the same render with `status != 'published'` — one code path, and the most delicate
  security surface in the repo disappears rather than being hardened again.
- **Publish webhooks and revalidation secrets** for runtime-native clients — the runtime
  invalidates its own cache. `webhook_deliveries` stays for legacy repo sites only.
- **N× dependency upgrades.** One Next.js major, once.

And it makes the expensive item from the last scan nearly free: **click-to-edit visual
editing needs no stega encoding, no source maps, and no SDK bump when you own the
renderer.** The runtime knows which block and field produced every element because it
mounted it.

---

## The honest risks

This is the section that decides it. Each risk below is stated at full strength before
the mitigation, because a proposal that survives only a flattering summary is not worth
taking.

### 1. Blast radius — the real one

Today a bad deploy breaks one client site. On the runtime, a bad deploy breaks **all of
them**, including a mosque's prayer times during Ramadan. The platform-engineering
literature is blunt about this: with a shared runtime *"you become the isolation layer"*,
and [a single bad deploy affects the entire business](https://northflank.com/blog/kubernetes-multi-tenancy).

**Mitigations, in order of importance:**
- **Per-client runtime version pinning.** A client row names a runtime version; deploys
  roll forward one cohort at a time. This is non-negotiable and must exist from day one,
  not be retrofitted.
- Canary the smallest client first, always.
- Per-tenant circuit breakers and rate limits so one client's traffic spike or bad block
  cannot starve the others.
- Keep the runtime boring. See "what must never go in it" below.

**Residual risk after mitigation: real but bounded.** It is a genuine trade — twenty
independent small failure surfaces for one large one that is monitored properly. The
honest argument for taking it is that twenty unmonitored repos fail *silently and
individually*, which the multi-tenancy plan already identifies as the failure mode NE
cannot see ("a silently stale site is found by the client").

### 2. Per-client custom code

Some client work will not be a block: a mortgage calculator, a map with custom
clustering, a booking integration. If those live in the shared runtime, they are shared
failure surface.

**Mitigation:** blocks are **first-party code NE writes**, not tenant-supplied — which is
what keeps this out of the untrusted-execution territory the isolation research warns
about (no microVMs, no sandboxing). The rule is that custom blocks are lazily imported,
error-bounded per block (one broken block renders a fallback, not a white page), and
namespaced per client. Anything that cannot be expressed as an error-bounded block is a
signal that this client should stay on a bespoke repo. **Keeping that exit open is part
of the design, not an admission of failure.**

### 3. It concentrates NE's entire delivery capability in one system

Every client site depends on one codebase, one Supabase project, one Vercel account. That
is a business-continuity question as much as a technical one, and it deserves an explicit
answer (backups, restore drills, a documented "how to eject a client to a static export"
path) before client #5, not after client #15.

### 4. The scope trap

The failure mode for this class of project is that the runtime slowly becomes a CMS-driven
website builder with a visual layout editor, breakpoint controls and a colour picker —
which is the anti-reference PRODUCT.md explicitly rejects, arrived at one reasonable
increment at a time.

**The guardrail, written down now:** the runtime renders blocks NE designed. Editors
choose *which* blocks and *what content*. Editors never control layout, spacing,
typography or colour. If a client wants a different look, NE writes a block or a theme —
that is billable design work, and it is the thing NE is actually good at.

### What must never go in the runtime

Auth, the CMS dashboard, admin routes, anything with the service-role key, anything
touching another client's data. The runtime is a **read-mostly renderer** — public
content out, form submissions and analytics events in, and nothing else. That constraint
is what keeps the blast radius survivable and the RLS story simple.

---

## The commercial half

The runtime is the cost side. Here is why it is worth doing rather than merely elegant.

NE currently sells **websites** — project revenue, which restarts at zero after every
delivery. The industry moved: [retainers are now the primary model for 78% of agencies,
up from 64% in 2023](https://www.arjankc.com.np/blog/b2b-agency-retainer-pricing-2026-benchmark/),
with SMB clients typically at $2.5k–12k/month. The standard framing is that projects
build proof and retainers build stable agencies.

This CMS already contains most of a retainer product and nobody is charging for it:
content, media, forms and **leads**, analytics with rollups, **social via Metricool**,
SEO auditing and redirects, team access. That is not a website admin panel. That is a
marketing operations workspace with a website attached — and the four things a client
would actually pay monthly for are already in the database.

What is missing to sell it is small next to the runtime: a client-facing monthly report
(the data exists), the site-health sweep from the opportunity scan (the check functions
exist), and a price. The runtime is what makes the margin work — a retainer against a
bespoke repo is a support cost; a retainer against a shared runtime is a product.

**The sequencing that follows:** the runtime is the enabler, the retainer is the revenue,
and the retainer is sellable to the three existing repo-based clients *before* the runtime
ships. Do not wait for the runtime to start charging.

---

## What I looked at and rejected

**White-labelling the platform to other agencies.** There is a real
[white-label CMS market](https://instawp.com/what-is-white-label-cms/) — Dorik,
Microweber, CrafterCMS all sell to agencies. It is the wrong move here. It converts NE
into a software company with support obligations, billing, documentation, SLAs and a
roadmap owned by strangers, competing with Webflow and Dorik below and Storyblok above,
from a team of one. The runtime's value to NE is *internal leverage*; selling it trades
that leverage for a harder business. Revisit at 20+ internal clients and never before.

**A generic AI page-generation feature.** Builder.io leads with it. For NE it inverts the
value proposition: clients pay NE for design judgment, and a button that generates
layouts is a button that competes with the thing being sold. AI belongs in the boring
places identified in the opportunity scan — alt text, search descriptions, bulk content
operations — not in composition.

---

## If this is taken, the order is

```
0.  Decide Decision 3 as a render tree, not a field bag       ← the only urgent item
1.  Ship the retainer product on the existing repo sites      ← revenue now, no runtime needed
2.  Build the block registry + renderer against ONE page
    of ONE existing site, served from the runtime in parallel ← proves it or kills it cheaply
3.  Version pinning + per-client theming + custom domains
4.  Client #4 is born runtime-native                          ← the real test
5.  Click-to-edit, which is now nearly free
6.  Migrate a legacy site only when it is being redesigned anyway
```

Step 2 is deliberately the smallest thing that can fail. One page, rendered two ways,
compared. If the runtime cannot reproduce an existing NE-designed page faithfully, the
whole proposal is wrong and it cost a week.

## What would make this the wrong call

Stated in advance so it can be checked honestly later:

- **Client count stays under ~6.** The runtime's payoff is amortised across sites; at 5
  clients, 5 repos is annoying but survivable and the bet does not clear its own cost.
- **NE's sites turn out to be less alike than expected.** If step 2 shows that a faithful
  NE page needs mostly bespoke blocks with almost no reuse, the runtime is a deployment
  optimisation wearing a strategy costume — still mildly useful, not worth this.
- **NE's growth plan is fewer, larger clients** rather than more of them. Then the
  constraint is design capacity, not delivery overhead, and this solves a problem NE
  does not have.
- **Solo-operator bus factor.** One shared runtime that only one person understands is a
  worse business risk than twenty boring repos any contractor could pick up.

---

## Sources

- [Vercel for Platforms — multi-tenant docs](https://vercel.com/docs/multi-tenant)
- [Platforms Starter Kit](https://vercel.com/templates/next.js/platforms-starter-kit)
- [Multi-tenant architecture with a single Next.js deployment](https://www.arunabh.me/blog/multitenant-nextjs-single-deploy)
- [What's the difference between Storyblok and a page builder?](https://www.storyblok.com/mp/pagebuilder-cms)
- [Kubernetes multi-tenancy: a 2026 guide to secure shared infrastructure — Northflank](https://northflank.com/blog/kubernetes-multi-tenancy)
- [Designing multi-tenant SaaS systems: isolation models and failure domains](https://aloknecessary.github.io/blogs/designing-multi-tenant-saas-systems/)
- [2026 B2B marketing agency retainer benchmark](https://www.arjankc.com.np/blog/b2b-agency-retainer-pricing-2026-benchmark/)
- [Retainer vs project-based pricing in 2026](https://taskip.net/retainer-vs-project-based-pricing/)
- [What is a white label CMS and why it's essential for agencies](https://instawp.com/what-is-white-label-cms/)
- [Multi-tenant CMS: scalable solutions with headless flexibility — FocusReactive](https://focusreactive.com/multi-tenant-cms/)
