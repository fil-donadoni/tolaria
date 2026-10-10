---
title: A `bind` named "$source" (or "$host") is accepted and silently reads the ability's own source
discoveredBy: 5410
status: draft
confidence: high
---

**What is wrong.** `validateEffectScript` accepts a `choice` Op with
`bind: "$source"`, although `$source` is one of the reserved
`ABILITY_BINDINGS` (`convex/gre/effects/validate.ts:8848`). At runtime the
stack item already carries a collected entry under that key, so
`requestChoice` (`convex/gre/state.ts`, `collectedChoices[step:choiceId]`)
returns the stored source snapshot instead of enqueueing the choice: the
player is never asked, and whatever reads the binding acts on the source
permanent itself.

**Evidence.** Found while authoring Protective Sphere (issue #5410): a draft
with `choice { bind: "$source" }` followed by
`forEach { select: { set: "bound", ref: "$source" } }` validated with zero
errors, and resolution put the prevention shield on the Sphere itself with no
choice raised. Renaming the binding (`$chosen`) fixed it. The validator
already rejects a picks binding in an object position, but not the
declaration of a reserved name.

**Why it may not deserve its own issue.** No shipped card does this today
(the draft never landed); it is an authoring trap, so a validator rule
("a `bind` may not shadow `$source`/`$host`/`$event`/`$target<N>`") is a small
guard rather than a behaviour fix.

**Adjacent.** The noted-mana cards (Jeweled Amulet, Ice Cauldron, Pentad
Prism) cite CR 106.10 for "mana spent". The printed 106.10 is about generic
mana symbols adding colourless mana. The spent record is CR 601.2h / 602.2b.
Issue #5410 cites 602.2b for its own lines and leaves those untouched.
