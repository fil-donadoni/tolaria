---
title: The Sideboard zone's header toolbar row has no scroll port, so any narrowing of the zones pane's width strands more of it
discoveredBy: 2585
status: draft
confidence: high
---

**What is wrong.** `deck-zone-surface.tsx:507-535` lays out each zone's header
row (title + filter/grouping/ordering/card-size controls) as a `flex-wrap`
row whose trailing cluster (`ml-auto flex min-w-0 flex-wrap items-center gap-2
self-center md:shrink-0`, line 535) does not shrink below its children's
min-content width. When that cluster's natural width exceeds the zone's own
box, the excess is clipped by an ancestor with `overflow-hidden` and no
scroll port (`min-h-0 min-w-0 flex-1 overflow-hidden`) — content past the
clip edge is genuinely unreachable by any gesture (`stranded`, not
`reachable`, in `scripts/ui-gate/probe.js`'s vocabulary). The comment at
`deck-zone-surface.tsx:525-534` already documents this exact mechanism from
issue #2511 ("the pane clips … unreachable by any gesture (4 stranded
controls at 844x390, 1 at 390x844) … Above `md` nothing changes").

**Evidence.** Issue #2585's dock split (`deck-builder-shell.tsx`) narrows the
zones pane's own width at landscape-and-roomy viewports (it now shares the row
with a bounded-width source-panel dock instead of owning the full width). The
Sideboard zone's box is a fixed ~25% share of that width
(`--split-main`/`splitDefault` 3/4, `deck-zones-surface.tsx:278`), so the
narrower total directly shrinks the Sideboard's own box, and more of its
already-overflowing toolbar row clips:

| viewport | zones-pane width | Sideboard box width | stranded/occ (before → after #2585) |
| -------- | ---------------- | ------------------- | ----------------------------------- |
| 1440×900 | 1440 → 1088      | 354 → 266           | 3 → 7 (the 4 color-filter pips)     |
| 1180×820 | 1180 → 828       | ~290 → 202          | 6 → 6+2occ+3 = 9 stranded, 2 occ    |

Measured live via CDP `getBoundingClientRect()` against `feat/issue-2585` and
`main` on the same account/deck (`docs/findings/2585-*` receipt in the PR).

**Why it may not deserve its own issue.** It is not a NEW bug — it is #2511's
already-accepted, already-documented trade-off ("Above `md` nothing changes:
`shrink-0` still protects the controls from a long zone title" was already an
approximation, not a guarantee, and 3/6 controls were already stranded at
these two viewports before #2585 touched anything). #2585 only widens the
blast radius by reducing the zones pane's available width, which any future
width-reducing change to this shell would do identically. The actual fix —
give the trailing toolbar cluster its own `overflow-x-auto` scroll port so
overflow becomes `reachable` instead of `stranded` — is a one-line change
`deck-zone-surface.tsx` owns, independent of the dock split, and is exactly
the kind of "zone toolbar" surface #2585's own scope explicitly excludes
touching. Worth a slice under #2511 or the ADR 0101 tablet/desktop chrome
work, not a re-open of #2585.

---

## Addendum (round-2 fixup, PR #2653): dropping `shrink-0` outright trades stranding for a NEW starve at 820×1180 — the lane cannot see it because `/decks/create` walks an empty Sideboard

Round 1 of this PR's review rejected the literal suggestion to delete
`deck-zone-surface.tsx:535`'s `md:` gate (that would have pinned the cluster
at max-content on EVERY viewport, re-creating #2511's original stranding on
phones) in favour of dropping the `shrink-0` token outright, so the cluster
shrinks and wraps at every width instead of clipping. That is still the right
call — it took `ctrlsStranded`/`ctrlsOcc` at every `check:ui` viewport back to
0 (see `scripts/ui-gate/budgets.json`'s `deck-builder` entries, re-recorded
2026-08-20). But it is a trade, not a pure win, and the previous version of
this file did not say so.

**Measured on this branch (`feat/issue-2585`), same deck/account, 820×1180
tablet-portrait, real Sideboard content (not the empty one `/decks/create`
walks) — an A/B on the ONE `md:shrink-0` token, nothing else differing:**

| state                          | Sideboard header row | Sideboard card port | verdict                                                                         |
| ------------------------------ | -------------------- | ------------------- | ------------------------------------------------------------------------------- |
| WITH `md:shrink-0` (pre-fixup) | 86px                 | 300px               | toolbar cluster overflows its box by **583px** with no scroll port — `stranded` |
| WITHOUT `shrink-0` (shipped)   | 203px                | 183px               | cluster wraps ~5 rows instead of clipping — port is now `starved`               |

`--card-h` at this viewport resolves to `calc(max(4.5rem, min(8rem, 18vw,
9.5dvh)) * 1.25 * 7 / 5)` ≈ **196px** (read via `getComputedStyle` on the
port element, not assumed). The shipped port (183px) is BELOW one card tile —
the probe's own `starved` shape (`scripts/ui-gate/probe.js`) — confirmed with
a real (non-empty) Sideboard: this deck carries only one Sideboard card
(Shivan Dragon) and the port already starves; the round-2 reviewer's own
measurement on a fuller Sideboard (134px port) is the same shape at a lower
number, consistent with more colour pips/rows.

**Why `bun run check:ui` misses this.** Every runbook surface it walks builds
a deck through `/decks/create`, and that flow starts with an EMPTY Sideboard
— an empty zone has no card tiles to starve, so the probe's `starved` rule
never fires there regardless of how short the port gets. The defect only
exists once a real deck (constructed from a preset, or an in-progress edit)
has Sideboard cards, which is the common case in play but not in the walked
surface.

**Disposition — still a finding, not a fix, for the same reason as the
original entry above:** it is a further slice of the #2511 trade-off (a
toolbar cluster that neither fits alongside its zone's content nor has a
scroll port of its own), it is independent of the dock split #2585 shipped,
and the actual fix (give the trailing cluster its own `overflow-x-auto`, or
fold it behind `CompactChromeDisclosure` the same way the phone-shaped
viewports already do) is a `deck-zone-surface.tsx`-owned change #2585's scope
excludes. `scripts/ui-gate/budgets.json`'s `820x1180x2` `deck-builder`
`knownDebt` note has been corrected in the same PR to disclose this trade
instead of reading as a pure win.
