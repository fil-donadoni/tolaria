---
title: Four cards found free/stale/genuinely-blocked during #1841's syntax-gap audit — not sliced here
discoveredBy: 1841
status: draft
confidence: medium
---

**What is wrong.** #1841's scope was narrowed to a `markers:lint` syntax gap
(resolving `TODO(issue #N)` refs, not only `tracked-by: #N`). Walking the
divergence-marker landscape while scoping that fix surfaced four cards whose
own markers are stale for reasons unrelated to the syntax gap — each is card
work belonging in its own slice, not this PR.

**Evidence.**

- **Rooting Kavu** (`convex/cards/sets/inv/green.ts:1059-1073`) — its marker
  reads as blocked, but the `{ set: "graveyard" }` `forEach` selector this
  card needs already shipped; the card looks freeable now.
- **Ancient Cornucopia** (`convex/cards/sets/big/green.ts:227-247`) — same
  shape: `maxTriggersPerTurn` already exists and looks like it frees this
  card's marker.
- **Gravebind** (`convex/cards/sets/ice/black.ts:1065-1090`) — its
  `tracked-by: #1841` marker is stale. The `delayedTrigger`/`next-upkeep` Op
  it names as missing shipped in #660, and Krovikan Fetish
  (`convex/cards/sets/ice/black.ts:1683-1690`, same file) already uses the
  exact pattern this card needs.
- **Lim-Dûl's Cohort** (`convex/cards/sets/ice/black.ts:1917-1937`) — the one
  of the four that is **genuinely still blocked**: no declarative "pick
  whichever creature ≠ self" combat-pair selector exists in the DSL today.

**Why it may not deserve its own issue (yet).** Each is a single-card
verification-and-implement task, not a new capability gap — the right unit is
one slice per card (three of them likely small once someone confirms the
freeing primitive really covers the Oracle text; Lim-Dûl's Cohort needs an
actual new selector, closer to a `/new-op`-shaped ticket). A human should
triage these into slices rather than one umbrella issue, since three are
"probably free now" and one is "still blocked, different reason."
