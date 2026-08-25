---
title: 39-68 controls per surface still measure under 44px at pointer: coarse
discoveredBy: 2593
status: triaged
issue: 2670
confidence: high
---

**What is wrong.** Issue #2593's prose asks for "every touch target ≥44px at
`pointer: coarse`" (ADR 0101 §2, WCAG 2.5.8). The token machinery for it exists
and works — `--control-h` resolves to 44px under `@media (pointer: coarse)`
(`src/index.css`) — but most controls never read it, so the rung is honoured
only where a component explicitly opted in. The gate already measures this and
nothing consumes the number: `probe.js` reports `small<n>` per surface, and
`budgets.json` has no ceiling for it.

**Evidence.** Measured by `bun run check:ui` on `feat/issue-2593`, `small` =
visible interactive targets whose smaller side is under 44px, at the coarse
viewports:

| surface       | 390x844x3 | 844x390x3 | 820x1180x2 | 1180x820x2 |
| ------------- | --------- | --------- | ---------- | ---------- |
| lobby         | 5         | 8         | 20         | 25         |
| deck-builder  | 12        | 25        | 65         | 65         |
| design-system | 16        | 21        | 21         | 21         |

The dense clusters are the deckbuilder's own: `deck-column-actions.tsx:72,90,102`
(the ✎ / ✕ / ✓ glyph buttons, `text-[11px]` with `px-0.5`) and
`zone-color-filter-toggles.tsx:40` (`size-6`, five of them at `gap-0.5`).

**Why #2593 did not fix it, and why that is not just deferral.** The obvious
remedy — grow the hit box without growing the paint, via a centred 44px
`::after` — is WRONG for exactly these clusters, and measurably so: at `gap-0.5`
(2px) two adjacent 24px controls given 44px hit areas OVERLAP by 18px, the later
sibling paints on top, and the earlier one becomes genuinely un-tappable near its
own edge. That is a real mis-tap and it would also show up as a `ctrlsOcc`
regression in the probe. Honouring 2.5.8 here means RE-SPACING the clusters (or
moving them into a menu), which is a layout decision about the Column header
band, not a token swap — and the deck-builder already carries `ctrlsStranded 9`
at tablet portrait, so the band has no spare height to give.

**Why it may not deserve its own issue.** It may be better as a `smallN` ceiling
added to `budgets.json` on the surfaces that are already clean, plus a line on
the PRD #2405 tracker, rather than a ticket of its own: the work is per-cluster
layout, not one change, and a single "make everything 44px" ticket would be
re-sliced immediately. Against that: it is the one acceptance-criterion phrase of
#2593 that shipped unmet, so leaving it only in a PR description loses it.

---

**RESOLVED INTO #2670 (2026-08-25).** This draft got a real ticket after all —
issue #2670 ("a11y: coarse-pointer targets below the ADR 0101 §2 44px rung —
#2593's unmet AC, currently drawer-only"). Every `smallN` ceiling this draft's
table measured now lives in `scripts/ui-gate/budgets.json` (issue #2658/#2660
wired the key in generally; #2670 is the first slice to actually lower one).
Re-verified line by line against HEAD, one entry per surface × viewport this
draft measured:

| surface       | 390x844x3             | 844x390x3              | 820x1180x2                | 1180x820x2                |
| ------------- | --------------------- | ---------------------- | ------------------------- | ------------------------- |
| lobby         | 5 → 10, STILL-OPEN †  | 8 → 10, STILL-OPEN †   | 20 → 22, STILL-OPEN †     | 25 → 15, STILL-OPEN †     |
| deck-builder  | 12 → 12, STILL-OPEN   | 25 → 19, PARTIAL-FIX ‡ | 65 → 23, PARTIAL-FIX (-1) | 65 → 46, PARTIAL-FIX (-1) |
| design-system | 16 → 16, STILL-OPEN § | 21 → 21, STILL-OPEN §  | 21 → 21, STILL-OPEN §     | 21 → 21, STILL-OPEN §     |

No entry is STALE — every control this draft named still exists and still
measures under 44px somewhere it renders; nothing closed by unrelated work.

- **† lobby** is outside this issue's target dirs (`src/components/lobby/`
  minus the `deck-builder/` subdirectory) — `docs/findings/`,
  `scripts/ui-gate/`, `src/components/deckbuilder/`,
  `src/components/lobby/deck-builder/`, `src/components/ui/` only. The
  numbers moved between #2593 and HEAD (mostly upward) from unrelated
  intervening work (nav/header churn, not a deliberate touch-target pass) —
  a correction to this draft's baseline, not a fix. Left for a future lobby
  slice.
- **‡ deck-builder 844x390x3** dropped 25 → 19 across #2585 (PR #2650/#2653,
  filters into a sheet/popover), #2662 (+2, a deliberate short-viewport
  trade documented on that cell), and #2665 (-9, the landscape-phone Column
  rung folding away rename/delete glyphs) — all landed before #2670 opened.
  This issue's own fix (`DeckFeaturedSelect`'s coarse-pointer rung) is
  DELIBERATELY carved out at this viewport (`short-viewport:min-h-0`, see
  the cell's own `knownDebt` note) — it does not move this number.
- The two `(-1)` deck-builder cells are #2670's OWN contribution this PR:
  `DeckFeaturedSelect`'s "Featured card" native `<select>`
  (`deck-featured-select.tsx`) now reaches the 44px rung at the two
  viewports where it costs nothing (`820x1180x2`) or where an 8px chrome
  reclaim on `SaveDeckBar` (`save-deck-bar.tsx`, `deck-source-dock:py-2`)
  more than pays for the 4px it costs the deck pane's `flex-1` share
  (`1180x820x2`) — full measurement in each cell's `knownDebt` note. The
  large remainder at both cells (this draft's own two dense clusters,
  `deck-column-actions.tsx` and `zone-color-filter-toggles.tsx`, plus the
  dock's 73×22px `Add Basic` trigger, `deck-builder-shell.tsx`) is
  DELIBERATELY left unfixed — re-spacing either cluster needs the Column/Zone
  header band to gain real height it does not have without breaking the
  `ctrlsStranded 0` / `starved 0` floor (`docs/findings/2581-deckbuilder-
toolbar-starved-by-touch-rung.md`), and growing the dock trigger the naive
  way was already measured to cost more chrome than #2670's own 8px reclaim
  recovers, dropping #2585's own ≥60% deck-pane floor (`docs/findings/2585-
add-basic-dock-trigger-touch-target.md`). Recorded as debt, not traded for
  a different red — see the `820x1180x2`/`1180x820x2` `knownDebt` notes in
  `scripts/ui-gate/budgets.json` for the full account, including the
  `.filter-chip` geometry recipe that was tried and measured (in
  `src/index.css`, above `.input-field`) and made `ctrlsStranded`/`ctrlsOcc`
  worse.
- **§ design-system** is unchanged — its three demo specimens use
  `src/components/ui/button.tsx`'s `xs`/`icon`/`icon-sm`/`icon-xs` size
  variants, whose retarget to the pointer-aware `--control-h-coarse` token
  is a DIFFERENT, separately-scoped slice (#2583) — "enlarging every board
  HUD glyph to a 44px square is a layout change that belongs to the touch-
  primitives slice (#2583), not the token slice" (`button.tsx`'s own
  comment). #2670 does not do #2583's work even though `src/components/ui/`
  is nominally a target dir here.

This draft is superseded by #2670 and the `knownDebt` notes it left in
`scripts/ui-gate/budgets.json` (the load-bearing, gate-enforced record going
forward); no further action on this file.
