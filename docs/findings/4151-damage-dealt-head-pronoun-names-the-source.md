---
title: "it" behind a "deals damage to a creature" head is bound to the source, not the damaged creature
discoveredBy: 4151
status: draft
confidence: low
---

**What is wrong.** `headPronounReferent` answers `"source"` for every
`damage-dealt` head whose source is `self`, whatever recipient the head names.
So `"Whenever this creature deals damage to a creature, destroy it."` binds "it"
to the creature that DEALT the damage. CR 608.2h and plain English bind it to
the nearer noun — the damaged creature.

**Evidence.** `convex/oracle/grammar/shared/triggerHead.ts`, `headPronounReferent`
`case "damage-dealt"`. The same rule shipped before PR #4215 as `headNamesSource`,
so this is pre-existing; what changed is the SURFACE it can be reached from,
because the pronoun is now also read in a mid-sentence object position
(`"… destroy it"`, `"… tap it"`) and not only as a sentence-leading "It".

The head already carries the fact needed to fix it: `recipient: "creature"` names
the damaged permanent, and `DAMAGE_DEALT.damagedPermanent` is an already-censused
object field (`convex/cards/eventFields.ts`) — the `damagedPlayer` twin the
`recipient: "opponent"` branch of `headAntecedents` uses for "that player".

**Why it may not deserve its own issue.** No corpus card reaches it: every
printed "deals damage to a creature" head this grammar accepts is followed by a
sentence naming its subject outright, and a sweep of the compiled corpus found
zero cards whose body reads a pronoun behind that head. It is one line of
lowering (`recipient === "creature"` → `{ ref: "$event.damagedPermanent" }`) plus
a fixture, so it is a natural rider on whichever Grammar Gap first prints the
form, rather than a ticket that stands on its own.
