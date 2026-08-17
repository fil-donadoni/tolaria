---
title: A permanent spell cannot create a delayed trigger as it resolves — only an ability body can
discoveredBy: 2392
status: draft
confidence: medium
---

**What is wrong.** CR 603.7a names three moments a delayed triggered ability can
be created: during the resolution of a spell or ability, as a replacement effect
is applied, or as the result of a static ability that lets a player take an
action. This engine covers only the second half of the first — the
`delayedTrigger` Op runs from an Effect Script, and a PERMANENT card runs no
script of its own when it resolves (`finalizeSpellResolution` puts it onto the
battlefield; `CardDefinition.effects` is an instant/sorcery-resolution path). So
a permanent whose printed text creates a delayed trigger _as the spell resolves_
has to arm it from an ETB triggered ability instead, which puts one extra object
on the stack that the real card never puts there.

**Evidence.** `convex/gre/effects/interpreter.ts:4610` (`delayedTrigger`) is
reachable only from an effect body; `convex/gre/triggers.ts:46`
(`buildDelayedTriggerStackItem`) carries no `triggerSourceId`, which is the other
half of the same shape — a delayed body cannot read `$source` and must capture
the scheduling object explicitly. Necromancy
(`convex/cards/sets/vis/black.ts`) is the first card to hit it: its second Oracle
sentence ("…the controller of the permanent it becomes sacrifices it at the
beginning of the next cleanup step") is armed by
`necromancy-cleanup-sacrifice`, an `enteredTrigger` whose only body is the
`delayedTrigger` Op.

**Why it may not deserve its own issue.** The outcome is identical in every case
we could construct, including the interesting one: if Necromancy leaves the
battlefield in response, the `$becomes` capture resolves to nothing and the
fired trigger sacrifices nothing (CR 608.2b) — which is exactly what the real
delayed ability does when it finds its permanent already gone. What is genuinely
observable is one extra stack object (respondable, Stifle-able) and the fact
that removing the enchantment before the arming trigger resolves prevents the
arming at all. Until a second card wants the same shape — and one where the
extra object matters — this is a note, not a ticket.
