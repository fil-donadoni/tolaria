---
title: 25 cards hand-copy the same "whenever this creature attacks" matcher — no attackTrigger factory
discoveredBy: 2295
status: draft
confidence: low
---

**What is wrong.** `convex/cards/abilities/triggers/` holds a factory per trigger
shape — `enteredTrigger`, `diedTrigger`, `phaseTrigger`, `spellCastTrigger`,
`tappedTrigger`, `damageDealtTrigger`, `landfallTrigger`, … — but there is no
`attackTrigger`. Every "whenever this creature attacks" card writes the same three
lines inline:

```ts
event: "ATTACKERS_DECLARED",
matches: (event, self) =>
    event.type === "ATTACKERS_DECLARED" &&
    event.attackerIds.includes(self.id),
```

**Evidence.** `grep -rn 'event: "ATTACKERS_DECLARED"' convex/cards/sets` → 25 hits;
`grep -rn 'event\.attackerIds\.includes(self\.id)' convex/cards/sets` → the same 25.
Byte-identical in `drk/red.ts:230-249` (Cave People) and `drk/red.ts:466-483`
(Goblin Rock Sled Arm). The annihilator expansion this issue shipped
(`convex/cards/abilities/annihilator.ts`) is the 26th copy — it was left inline
deliberately rather than growing the change's blast radius.

Two nearby variants a factory would have to admit, which is why this is not a pure
mechanical extraction: the CONTROLLER-scoped form
(`event.attackingPlayerId === self.controllerId`, exalted —
`abilities/keywordTriggers.ts:58-61`) and the attacks-alone form
(`event.attackerIds.length === 1`).

**Why it may not deserve its own issue.** The duplicated code is three lines with
no branch and no state, and the "extract after the second" rule has been overridden
here 25 times without a bug being traced to it — the failure mode a factory prevents
(mismatched `self` vs `attackingPlayerId` scoping) has not actually occurred. It is
a tidiness ticket, best folded into the next set rollout that adds several attack
triggers at once, not cut on its own.
