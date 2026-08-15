---
title: attackTargetExcessSink routes trample excess to the player when the attacked planeswalker has left the battlefield (CR 702.19f)
discoveredBy: 2444
status: draft
confidence: high
---

**What is wrong.** `bun run cr 702.19f`:

> If a creature without trample over planeswalkers is attacking a planeswalker,
> none of its combat damage can be assigned to the defending player, **even if
> that planeswalker has been removed from combat** or the damage the attacking
> creature could assign is greater than the planeswalker's loyalty.

The engine's excess sink does exactly the forbidden thing: when the attacked
planeswalker is no longer on the battlefield, it falls back to the defending
**player**, so a trampler whose planeswalker target died mid-combat spills its
excess onto the player's life total. Only a creature with "trample over
planeswalkers" may do that (CR 702.19e), and that keyword is explicitly
out of scope in this engine (`convex/gre/phases.ts:1492`).

**Evidence.** `convex/gre/damageAssignment.ts:62-72`:

```ts
export function attackTargetExcessSink(state, attackerId, defenderId): string {
    const pwId = state.combat?.attackTargets?.[attackerId];
    if (!pwId) return defenderId;
    const defender = getPlayer(state, defenderId);
    const pw = defender.battlefield.find((c) => c.id === pwId);
    return pw && isPlaneswalker(pw) ? pwId : defenderId; // <- CR 702.19f
}
```

Both consumers inherit it: the `phases.ts` seed builders
(`buildAutoDamageAssignments` / `buildDefaultDamageAssignments`) and
`convex/game.ts` `setDamageAssignment`'s `excessSinkIds`, so the illegal
assignment is both pre-filled AND accepted by the validator. The correct
behaviour is an **empty** sink: the excess is simply not assignable anywhere,
and the attacker's damage stops at its blockers.

This is pre-existing from #1220 (the function moved file in #2483 but the
`: defenderId` fallback is unchanged), and outside #2444's scope, which was the
lethal-damage _threshold_, not the sink's identity.

**Why it may not deserve its own issue.** It needs a planeswalker to be attacked
AND removed between declare-blockers and the damage step — a narrow window, and
the current fallback errs toward "damage happens" rather than a stuck game. The
fix is also entangled with the missing "trample over planeswalkers" keyword: a
correct implementation wants the keyword as the discriminator, not a hardcoded
empty sink, so it may belong to whatever ticket eventually ships CR 702.19e
rather than standing alone.
