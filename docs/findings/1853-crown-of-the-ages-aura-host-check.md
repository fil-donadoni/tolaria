---
title: Crown of the Ages can legally target an Aura that isn't attached to a creature
discoveredBy: 1853
status: draft
confidence: medium
---

**What is wrong.** Crown of the Ages — "{4}, {T}: Attach target Aura attached
to a creature to another creature." — has no host-relation check on its
`targetRequirement`, so it can legally target ANY Aura in play, including one
attached to a land or unattached, not just one already attached to a
creature. Same bug CLASS as issue #1853 (Pyramids/Savaen Elves/Miracle
Worker's "attached to a land/creature" clauses), but on a different card
shape: this ability MOVES the Aura to a new creature host rather than
destroying it, and its `resolve()` body picks the new host via a secondary
`requestChoice` — a materially different card, so it wasn't folded into
#1853's fix.

**Evidence.** `convex/cards/sets/ice/colorless.ts:532-536`:

```ts
targetRequirement: {
    type: "Enchantment",
    subtypeFilter: "Aura",
    count: 1,
},
```

No `attachedToFilter` (the new declarative field #1853 added,
`convex/cards/types.ts`), so `getLegalTargets`/`selectTarget` offer/accept
any Aura regardless of its current host. `resolve()`
(`convex/cards/sets/ice/colorless.ts:537-561`) reads the OLD host
(`ctx.getAttachedTo(aura.id)`) only to exclude it from the new-host candidate
list — it never verifies the aura had a creature host to begin with. Picking
an Aura attached to a land (or unattached) still runs the full
choose-a-new-creature-host flow and reattaches it, which the oracle text
doesn't license.

**Why it may not deserve its own issue yet.** Low real-world impact — Crown
of the Ages is the only card in the current pool with this exact "move an
Aura between creatures" template, so the blast radius is one card, and the
fix is now mechanical: add `attachedToFilter: { types: "Creature" }` to its
`targetRequirement` (the primitive #1853 built specifically covers this
shape). Whether that's worth a standalone ticket or gets folded into the next
`ice/colorless.ts` pass is a call for triage, not this PR.
