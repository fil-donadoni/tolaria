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
`enchantRestriction` rides on — that one IS cleared, by
`clearGrantedEnchantRestriction`).

**The concrete consequence of the asymmetry.** Because the granted `"Aura"`
SUBTYPE survives a zone change while the granted enchant RESTRICTION does not,
a permanent that became an Aura at runtime and then died returns from the
graveyard still typed Aura but with no enchant clause of its own. If it has no
printed `targetRequirement` either — the Necromancy shape — it then has no legal
host at all, so CR 303.4g keeps it in the graveyard permanently: it can never
re-enter the battlefield by any non-cast means. That is parity with pre-#2471
behaviour (nothing changed about the subtype half) and it is the CR-correct
outcome for the restriction half taken alone, but the pair is only coherent if
BOTH halves die with the object. Fixing `grantedSubtypesAdd` is what makes it
coherent; the test
`CR 303.4g — an Aura whose ONLY clause was a runtime grant has no legal host on
re-entry and never enters`
(`convex/gre/__tests__/granted-enchant-restriction.test.ts`) pins the current
behaviour meanwhile.
