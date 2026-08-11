# NE Website Manager design system

The implementation references these approved working concepts:

- `ne-cms-dashboard-concept.png`
- `ne-cms-builder-concept.png`
- `ne-cms-mobile-editor-concept.png`

## Direction

The product keeps the Neu Entity white-and-blue character: a true-white canvas,
confident royal blue, crisp near-black typography, thin cool-gray rules, and
purposeful editorial spacing. It should feel capable, direct, and easy to scan.

## Tokens

| Role | Value |
| --- | --- |
| Brand blue | `#1557E8` |
| Brand blue hover | `#1048C7` |
| Pale blue selection | `#EEF4FF` |
| Ink | `#101319` |
| Secondary text | `#475569` |
| Muted text | `#64748B` |
| Border | `#DDE3EC` |
| Canvas/surface | `#FFFFFF` |
| Subtle surface | `#F7F9FC` |
| Warning | `#B45309` |
| Danger | `#DC2626` |

Use a bold modern grotesk-like hierarchy with the existing sans-serif stack.
Interface controls remain compact but never below a 40 px target. Focus is a
visible blue ring, not a suppressed browser outline.

## Container model

- App shell: blue navigation rail, white contextual top bar, white workspace.
- Dashboard: open lists and tables with a single right context rail; no metric
  card grid or decorative hero.
- Builders: library, sortable canvas, and inspector; one visible live preview.
- Editors: main document plus inspector on desktop; single column and a bottom
  settings sheet/action bar on mobile.
- Cards are reserved for objects that need containment. Section boundaries use
  rules, spacing, and headings before decorative containers.

## Shared interactions

- One selected website is visible and authoritative everywhere.
- `Ctrl/Cmd + K` opens global command search.
- Ordered structures use drag handles, keyboard movement, optimistic save,
  and Undo.
- Saving and publishing are distinct, state-aware actions.
- Destructive actions are labelled and confirmed.

## Icon treatment

Use the existing Lucide outline family at 16–20 px with consistent 2 px stroke.
Icon-only buttons require an accessible name and a 40 px target.

## Responsive rules

- At 1024 px, secondary rails may collapse beneath the primary content.
- At 768 px, the sidebar becomes a drawer and editors become one column.
- Mobile publishing/settings open in a semantic sheet; primary save and preview
  actions remain available in a sticky bottom bar.
- No core workflow may introduce document-level horizontal overflow at 390 px.
