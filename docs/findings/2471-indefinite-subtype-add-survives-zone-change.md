---
title: An addSubtype-granted subtype survives a zone change (CR 400.7)
discoveredBy: 2471
status: draft
confidence: medium
---

**What is wrong.** The `addSubtype` Op grants a subtype INDEFINITELY (CR 613.1d,
layer 4) by mutating the instance in place — it pushes an `{ subtype, auraId:
"indefinite" }` marker onto `grantedSubtypesAdd` AND appends to `card.subtypes`.
Nothing clears either on a zone change, so a permanent that leaves the
battlefield keeps the grant on the very same instance. CR 400.7 makes the object
that leaves (and the one that returns) a new object, which should not carry it:
a creature made an Angel by Guide of Souls, then bounced and recast — or killed
and reanimated — comes back still an Angel.

**Evidence.** `convex/gre/state.ts:11891-11925` (`SpellContext.addSubtype`)
writes `grantedSubtypesAdd` + `subtypes` in place.
`convex/gre/state.ts:9952` (`resetBattlefieldTransientState`) deletes ~40 other
battlefield-only fields — `grantedStaticAbilities`, `grantedActivatedAbilities`,
`temporarySubtypeChange`, `indefiniteSubtypeSet`, `textChanges`, `wasKicked` —
but never `grantedSubtypesAdd`, and never restores `subtypes` for the
`addSubtype` case (the two subtype reverts it does perform are keyed on
`indefiniteSubtypeSet` / `temporarySubtypeChange`, which the ADD path does not
write). `removePermanentTo` (`convex/gre/state.ts:8489-8560`) likewise does not
touch it. The source-departure sweep at `convex/gre/state.ts:6818-6826` prunes
grants by SOURCE id, which by design never fires for the `"indefinite"`
sentinel. Shipped call sites that can reach the bad state:
`convex/cards/sets/bro/colorless.ts:129` and
`convex/cards/sets/mh3/white.ts:93`.

**Why it may not deserve its own issue.** Both shipped call sites add a
CREATURE subtype whose only consumers are tribal-ish reads, so the visible
consequence today is cosmetic (a wrong type line) rather than a rules divergence
anyone can exploit; it may be a line on the layer-system tracker rather than a
ticket. Counter-argument: the same in-place mutation is what the CR 400.7 reverts
right beside it exist to undo, so the omission looks like an oversight rather
than a decision, and it gets worse as soon as a card cares about the granted
subtype (a Kindred/changeling-style anthem, or the Aura grant this issue's
`enchantRestriction` rides on — that one IS cleared, at
`convex/gre/state.ts:8497-8506`).
