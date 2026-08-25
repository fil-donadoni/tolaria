---
title: applyMoveInSearch never applies bestow characteristics, so ISMCTS values every bestow cast as a creature
discoveredBy: 2705
status: draft
confidence: high
---

**What is wrong.** The engine has TWO wholesale reimplementations of "build a
StackItem from a `cast-spell` Move": the greedy 1-ply sandbox
`applyMoveForSearch` (`convex/gre/applyMove.ts`) and the ISMCTS in-tree
`applyMoveInSearch` (`convex/gre/search.ts`). Only the FIRST applies the CR
702.103b bestow characteristic change. The second — the one every rollout,
every blade scenario and all self-play route through — pushes the plain stack
item and resolves it, so a bestowed cast evaluates as "a creature body
entered", never as an Aura attached to a host granting it +N/+N. That is
exactly the class of bug issue #2705 had to avoid for morph, which is how it
was noticed.

**Evidence.** `convex/gre/applyMove.ts:869-884` has the branch:

```ts
if (move.alternativeCostId !== undefined &&
    move.alternativeCostId === tryGetDefinition(...)?.bestow?.id) {
    applyBestowCharacteristics(stackItem);
}
```

`convex/gre/search.ts:815-846` builds its own `stackItem` from the same fields
(`targets`, `chosenX`, `chosenModeId`, `castOffSorceryTiming`, `castFromGraveyard`)
and pushes it at `search.ts:857` with no bestow branch anywhere in the case.
`grep -n "applyBestowCharacteristics" convex/gre/` returns hits in
`applyMove.ts`, `bestow.ts` and `game.ts` only — never `search.ts`.

Both switches are also NOT compile-time exhaustive over `Move["kind"]` (no
`default: assertNever`), which is why this gap and the `turn-face-up` one were
both invisible to `tsc`. `src/lib/ai/executor.ts` was made exhaustive in #2705;
these two were left alone because each legitimately declines to handle four
kinds (`mulligan-bottom`, `madness-decline`, `rebound-decline`, `name-card`),
so making them exhaustive is a real decision about what those cases should do,
not a one-line addition.

**Why it may not deserve its own issue.** Springheart Nantuko (`mh3/green.ts`)
is the only shipped card with `bestow`, so the live blast radius today is one
card's valuation, and the ISMCTS tree may never enumerate it in a position that
matters. If a second bestow card ships — or if the exhaustiveness question is
taken up for the search appliers generally — it stops being a one-card
mispricing and becomes a structural claim about the search tree, which is when
it earns a ticket.
