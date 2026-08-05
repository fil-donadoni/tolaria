---
title: ClientPermanentFilter board-highlight mirror has no positive `supertypes` branch (fail-open snow highlighting)
discoveredBy: 2235
status: draft
confidence: medium
---

**What is wrong.** `matchesPermanentFilter` (`src/lib/card-utils.ts:600-`) —
the `ClientPermanentFilter` mirror that drives board-highlighting via
`useBattlefieldVisualState.ts:156-162` — has an `excludeSupertypes` (negative)
branch but no POSITIVE `supertypes` branch at all. When a sacrifice pick is a
real choice (2+ distinguishable snow lands, so `autoResolveFungible` doesn't
collapse it automatically), every land on the board lights up as a legal pick
for a `sacrificeFilter: { types: 'Land', supertypes: ['Snow'] }` cost —
snow or not.

**Evidence.** Reviewer of PR #2262 (issue #2235) wrote and ran a scratch test:
`matchesPermanentFilter(plainForest, { types: 'Land', supertypes: ['Snow'] })`
returned `true` for a non-snow Forest. Confirmed by reading
`src/lib/card-utils.ts:559-598` (the `ClientPermanentFilter` interface has
`excludeSupertypes` but no `supertypes` field) and the `matchesPermanentFilter`
body (no `filter.supertypes` check exists alongside the `excludeSupertypes`
check at line ~640).

**Why it is fail-OPEN, not fail-closed.** The `selectSacrifice` mutation still
rejects an illegal pick server-side, so this is degraded UX (every land looks
clickable, only the snow ones are actually accepted), not a dead affordance.
Before PR #2262 shipped Whiteout's `sacrificeCandidates` fix, the snow-sacrifice
picker could never be satisfied at all in this shape, so this is the first time
it matters in practice.

**Why it may not deserve its own issue.** The `legalActions` sacrifice
enumerator (`gre/legalActions.ts:601-616`) doesn't cover this picker either (it
is attack-tax-only) — so the mirror is the only authority the board has, and
fixing it properly requires: a new `supertypes?: string | string[]` field on
`ClientPermanentFilter`, a positive-match branch in `matchesPermanentFilter`
(presumably reading live status via `liveSupertypesOf`, mirroring the
`buildTriggerStateView` fix from this same PR), a `MIRROR_CENSUS.supertypes`
flip from `"adapter-only"` to `"mirrored"`, and a new parity test case in
`card-utils.test.ts`. Not a one-line addition, so out of scope for the #2235
fixup pass. Three shipped cards now reach a real (non-auto-resolved) snow
sacrifice choice: Sunstone, Glacial Crevasses, Whiteout — worth a line on an
existing tracker or its own slice ticket, human's call.
