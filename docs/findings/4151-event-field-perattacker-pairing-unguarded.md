---
title: $event.soleAttacker and $event.combatant are interchangeable to every guard, and mean opposite things
discoveredBy: 4151
status: draft
confidence: medium
---

**What is wrong.** Both `ATTACKERS_DECLARED` rows in `EVENT_FIELD_REGISTRY`
flatten the same shape — a length-1 `attackerIds` — but they encode opposite
claims about the firing, and nothing checks which one a body is entitled to.

- `soleAttacker` is CR 702.83's cardinality fact: a single id means the creature
  attacked ALONE. True only when the body reads the REAL batch event.
- `combatant` is CR 508.3a's per-creature subject: this firing's own attacker,
  whatever else attacked. True only under `TriggeredAbility.perAttacker`, where
  `collectTriggers` hands the ability a SYNTHETIC single-attacker event.

Swap them and both fail silently, in opposite directions:

- `perAttacker: true` + `$event.soleAttacker` → "attacks alone" reads TRUE for
  every attacker in a five-creature alpha strike.
- no `perAttacker` + `$event.combatant` → the row returns undefined the moment a
  second creature attacks, so the reading Op skips (CR 608.2b) and the card does
  nothing on the turn it matters.

**Evidence.** `convex/cards/eventFields.ts:95` (`soleDeclaredAttacker`, shared by
both rows) and the `combatant` row below it; the fan-out at
`convex/gre/triggers.ts` (`firingEvents`). Both shapes were probed during the
review of PR #4215: `validateAbilityEffectScript` returns `[]` for each, and
`collectTriggers` then produces the wrong firing count with no error anywhere.

A third, narrower version of the same gap: `collectTriggers`'
`oncePerEventBatch` branch iterates `events` rather than `firingEvents(ability,
events)`, so an ability carrying both flags gets the batch event and
`$event.combatant` resolves to nothing.

**Why it may not deserve its own issue.** None of the three is reachable today.
`resolveCompiledTrigger` sets `perAttacker` exactly when the head is
per-creature, so the compiler cannot emit a mismatched pair; no hand-written card
writes either shape; and neither `attacksTrigger` nor `attacksOrBlocksTrigger`
accepts `oncePerEventBatch`, so the two flags never meet. What makes it worth
writing down anyway is that all three failures are SILENT — no red test, no
quarantine, no log line — so the first hand-tail card that trips one will be
debugged from the board, not from a stack trace. The cheap shape is a catalogue
guard pairing the flag with the field (and a factory throw for the flag
collision), not a new subsystem.
