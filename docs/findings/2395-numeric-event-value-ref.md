---
title: The Effect Script DSL cannot read a numeric field off the triggering event
discoveredBy: 2395
status: draft
confidence: medium
---

**What is wrong.** Questing Beast's fourth clause — "it deals **that much** damage to target
planeswalker that player controls" — could not be authored as an Effect Script
and shipped as `resolve()` instead (`convex/cards/sets/eld/green.ts`, with the
`// protocol card:` justification the rules require).

**Evidence.** The blocker is not a missing Op. `dealDamage` exists; what is missing is a way
for `dealDamage.amount` to read the **firing event's damage amount**:

- `EVENT_FIELD_REGISTRY` (`convex/cards/mechanicsRegistry.ts:3629`) censuses
  only two families — `"object"` and `"player"` — and `EventFieldRow.resolve`
  returns an **id** (`string | undefined`). Its `DAMAGE_DEALT` block
  (`mechanicsRegistry.ts:3675-3689`) has `damagedPlayer` and
  `damagedPermanent`; there is no `amount`.
- `resolveEventRef` (`convex/gre/effects/interpreter.ts:220-234`) returns
  `{ family: "object" | "player"; id: string }`, so even a censused numeric row
  would have nowhere to land.
- `EffectValue` (`convex/cards/types.ts:10242-10258`) has no `$event`-numeric
  member.

**Why it may not deserve its own issue.** Three shipped cards already sit in exactly this hole and are explicitly
documented as "planned-migratable pending a triggering-event value ref" —
Jackal Pup (`convex/cards/sets/tmp/red.ts:80-88`, which states the gap in so
many words), El-Hajjâj (`convex/cards/sets/arn/black.ts`) and Living Artifact
(`convex/cards/sets/lea/green.ts`). So this is a **known** gap with a working
escape hatch, not a surprise, and the population it unblocks is small enough
that the migration classifier has never surfaced it as a top demand. Closing it
means a new `EffectValue` member plus a family widening across
`EVENT_FIELD_REGISTRY` / `resolveEventRef` / `validate.ts` / the Op valuers —
the full seven-site `/new-op` walk for four cards.

Counter-argument: "deals that much damage" is a common modern template
(Questing Beast, Jackal Pup, Boros Reckoner, Stuffy Doll, every damage-doubler
rider), so the population is larger than the four cards currently in the
catalogue, and each one costs an `aiEffects` shadow script that only
approximates the real amount.
