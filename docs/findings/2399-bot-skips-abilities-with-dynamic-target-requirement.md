---
title: enumerateAbilityMoves skips every ability with getTargetRequirement, so four shipped "another target" abilities are invisible to the bot
discoveredBy: 2399
status: draft
confidence: high
---

**What is wrong.** `enumerateAbilityMoves` refuses to enumerate any activated
ability that carries a dynamic `getTargetRequirement` closure. That closure is
also the only idiom shipped cards use to express Oracle's "**another** target",
so every card using it is an activated ability the search can never take — the
bot simply never activates them, on any board.

**Evidence.** The skip:

```
convex/gre/moves.ts:1088
    if (ability.canActivate || ability.getTargetRequirement) continue;
    // "Conditional abilities need a runtime predicate we don't replicate;
    //  leave them to a later slice."
```

The four shipped consumers of the idiom, each with a static
`targetRequirement` (used as the UI fallback) plus a
`getTargetRequirement: (source) => ({ …, excludeInstanceIds: [source.id] })`:

- `convex/cards/sets/mh1/white.ts:15` — Giver of Runes
- `convex/cards/sets/ecl/green.ts:23` — Formidable Speaker
- `convex/cards/sets/m20/colorless.ts:14` — Manifold Key
- `convex/cards/sets/dka/multicolor.ts:47` — Sorin, Lord of Innistrad (−6)

Issue #2399 shipped the alternative: `TargetRequirement.excludeSource` is now
honoured for activated abilities too, through the shared `applySelfExclusion`
(`convex/gre/rules.ts`), applied at the mutation's announce choke point
(`convex/game.ts`, `activateAbilityOnState`) AND in `enumerateAbilityMoves`'s own
tuple build. A card that declares the flag instead of the closure is therefore
both correctly gated and bot-visible — so the four above could be migrated
mechanically, deleting their `getTargetRequirement` entirely.

**Why it may not deserve its own issue.** The migration is four one-card edits
with no engine change left to make, so it may be better as a line on an existing
bot-coverage tracker than a ticket of its own. It is also worth checking first
whether the wider `canActivate` half of the same skip is the bigger fish: that
one has no equivalent declarative escape and covers many more abilities, and a
ticket that fixes only the `getTargetRequirement` half leaves the comment's
"later slice" promise half-kept.
