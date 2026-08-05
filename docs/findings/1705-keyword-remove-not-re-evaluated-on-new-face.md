---
title: a targeted keyword-remove is not re-evaluated against a new face that gains the keyword for the first time
discoveredBy: 1705
status: draft
confidence: medium
---

**What is wrong.** #1705's replay (`convex/gre/identitySwap.ts`) rebuilds a permanent's
copiable values and replays the overlays recorded ON THE INSTANCE. That covers a
`keyword-remove` static (Gravity Sphere) in both directions where the record exists:

- the source HELD an occurrence → the hold splices one off the new face too, so the
  keyword stays gone (issue #1705 shape (b), covered by
  `convex/gre/__tests__/identitySwap.test.ts`);
- the source held nothing on the new face → the stale hold is dropped, so its later
  restore cannot conjure an occurrence (same file).

The gap is the case where the source recorded NOTHING because the OLD face did not
have the keyword, and the NEW face does. Front face has no flying, Gravity Sphere is
live, the permanent transforms into a flying back face: `removedKeywords` has no entry
to replay, so the back face flies. CR 613.1f says it should not — Gravity Sphere is a
continuous layer-6 effect applying to the OBJECT, and layer 1 changing underneath it
does not end it.

A blanket `ability-loss` source does NOT have this gap: `abilitiesSuppressedBy`
records the source itself (not the keywords), so the replay re-derives the whole
ledger from the new base (`replayLayer6Abilities`, the `blanketHolds` block).

**Evidence.** `convex/gre/state.ts:6302-6320` — the `keyword-remove` arm writes a
`removedKeywords` entry only inside `if (idx !== -1)`, i.e. only when the keyword was
present at apply time. `convex/gre/identitySwap.ts` `replayLayer6Abilities` can
therefore only replay removals that already happened; it has no `GameState` and no
access to the live source's `staticEffects[].applies` predicate.

**Why it may not deserve its own issue.** Reaching it needs a keyword-remove static,
plus an identity swap, plus a new face that prints the removed keyword where the old
one did not — and no shipped card pair does that today (no `CardDefinition` in the
catalogue carries a `backFace` at all; the only double-faced object is the Incubator
token spec, whose faces have no keywords). The structural fix is not a patch either:
it is re-running the live sources' layer-6 predicates against the new characteristics,
which is exactly what PRD #2064 / ADR 0082 (derive at read time from one continuous-
effects registry) does by construction. Plausibly a line on #2064 rather than a
ticket — but worth recording, because it is the one CR-visible hole the #1705 replay
deliberately leaves and nothing in the code says so.
