---
title: Damage-trigger recipient-type gates depend on an unstated "triggers collect before SBAs" invariant
discoveredBy: 1855
status: draft
confidence: medium
---

**What is wrong.** A `DAMAGE_DEALT` event says only `{ type: "permanent", id }`
— it carries no snapshot of the recipient's characteristics, unlike the SOURCE
side, which the emitter fully snapshots (`sourceTypes` / `sourceSubtypes` /
`sourceColors` / `sourceStaticAbilities`, CR 603.10 last-known information). So
every recipient-type gate re-reads the recipient off the LIVE battlefield at
`matches()` time, and is silently correct only for as long as nothing removes
the recipient between the damage and the trigger scan.

**Evidence.** `convex/cards/abilities/triggers/shared.ts:304-333`
(`passesTargetPermanentFilter`) looks the recipient up with `findPermanentInView`
and, when it is gone, synthesises `{ types: [], subtypes: [],
staticAbilities: [] }`. That fallback is deliberate and documented — it is what
lets Fungusaur's `controllerRelation: "self"` trigger still fire on lethal
damage — but it makes every TYPE-based filter fail closed on the same input.
The invariant that keeps it correct is ordering, stated nowhere near the code
that depends on it: `applyAllCombatDamage` calls `collectTriggers` at
`convex/gre/phases.ts:1777`, and the callers run `checkStateBasedActions`
afterwards (`convex/gre/__tests__/combat-planeswalker.test.ts:95-102`), so a
0-loyalty planeswalker (CR 704.5i) or a lethally-damaged creature is still on
the battlefield for the lookup.

Three consumers ride this today: Kaldra Compleat's
`filter: { types: "Creature" }` (`convex/cards/sets/mh2/colorless.ts:282`),
Psychic Frog's new `"player-or-planeswalker"` kind
(`convex/cards/sets/mh3/multicolor.ts`, this issue), and any future recipient
filter. `convex/cards/sets/mh3/__tests__/multicolor.test.ts` pins the lethal
case for the Frog specifically ("fires even when the damage is lethal to the
planeswalker"), but nothing pins the ORDERING itself — a refactor that moved
the SBA pass inside `applyAllCombatDamage`, ahead of `collectTriggers`, would
turn both cards silently inert and no test would name the cause.

The durable fix is symmetry: have the emitter snapshot the recipient the way it
already snapshots the source (`targetTypes` / `targetSubtypes` on
`DamageDealtEvent`, `convex/cards/types.ts:7795-7813`), so a recipient gate
never needs a live lookup. That is a schema-plus-serialization change touching
every `DAMAGE_DEALT` emission site, well outside this issue.

**Why it may not deserve its own issue.** The invariant genuinely holds today
and is CR-correct (CR 603.2 — triggers are collected from the event, before
state-based actions), so this is a robustness/legibility gap, not a live bug.
Two cards depend on it, both now covered by tests that would go red if the
behaviour changed — just not with a message that names the ordering. If the
recipient-snapshot idea is wanted anyway, it is better framed as one line on a
damage-event modernisation ticket than as a bug report.
