---
title: The token entry tail carries a park-time entersWith.counters snapshot, so a chained copy answer's counters are lost
discoveredBy: 2558
status: draft
confidence: low
---

**What is wrong.** `refreshOwedAsEnters` documents that a `copy` answer's newly
revealed `entersWith.counters` need no handling of their own because "every
entry tail re-derives the definition from the instance and applies them"
(`convex/gre/state.ts`). The TOKEN tail does not. `createTokenPermanents`
computes `entryCounters` once, before the CR 614 chokepoint, and stashes the
resulting `Record<string, number>` on `StagedEntry.tokenEntry.entryCounters`;
`finishTokenEntry` later replays exactly that snapshot. A definition the staged
token acquires AFTER the park — by answering a `copy` as-enters choice, CR 707.6
/ ADR 0100 D4 — contributes no counters.

**Evidence.**

- `convex/gre/state.ts` `createTokenPermanents` — `entryCounters` is computed
  from the spec (or, since #2558, from the copied definition) and passed into
  `stageAsEntersEntry`'s `tokenEntry`.
- `convex/gre/state.ts` `finishTokenEntry` — reads
  `opts.entryCounters ?? {}` and emits it; it never calls
  `applyEntersWithCounters` itself, so there is no re-derivation.
- `convex/gre/state.ts` `refreshOwedAsEnters` — the comment that assumes the
  re-derivation happens.
- Reachable shape: a token copy of a Clone-family permanent (Fractured
  Identity, `c17/multicolor.ts`, targeting a Clone), whose `copy` answer names
  a card with `entersWith.counters` — a token copy of Clone that copies
  Clockwork Beast would enter with no +1/+0 counters.

**Why it may not deserve its own issue.** It is two copy hops deep and no
shipped card composes them in a game likely to happen; the unparked token-copy
case (a direct copy of Clockwork Beast) IS correct and covered by
`entersWithCounters.test.ts`. Whether the spell and effect tails really do
re-derive — the claim the comment makes for them — was not verified here, so the
finding may generalise beyond the token row or may be the token row's alone.
