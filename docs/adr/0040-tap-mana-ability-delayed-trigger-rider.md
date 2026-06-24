# Tap-mana-ability delayed-trigger rider (control-change-on-tap)

## Status

accepted

## Context

Rainbow Vale (FEM) reads "**{T}: Add one mana of any color. An opponent gains
control of this land at the beginning of the next end step.**" The mana add is a
mana ability (CR 605.1a — it adds mana, has no target, isn't a loyalty ability,
so it resolves immediately without the stack, `useStack: false`). But the second
sentence is a side effect that needs the **delayed-triggered-ability** machinery
(CR 603.7a): it arms an "at the beginning of the next end step" trigger that
hands the land to the opponent.

The engine already ships every piece in isolation:

- `scheduleDelayedTrigger` + a card-def `delayedTriggers[]` template (Rukh Egg,
  Berserk) — arms and later fires a delayed trigger at a named phase boundary.
- Indefinite `gainControl(target, newController)` with no condition (Ghazbán
  Ogre) — a one-way control reassignment that the conditional-control SBA does
  **not** revert.
- The choice-mana tap path (`manaChoices`) — the any-colour pick.

The gap is purely **plumbing**: a tap mana ability resolves through `tapUntap`,
whose only side effect is producing mana. The mana-ability `effect` callback
receives an `ActivatedAbilityContext` that exposes **only** `addMana` — it cannot
call `scheduleDelayedTrigger`. So a tap mana ability that also needs a
delayed-trigger side effect had no seam to express it. (The non-tap mana-cost
path `activateManaAbility` does run a full `SpellContext` `resolve`, but Rainbow
Vale's cost is `{T}`, not mana, so it routes through `tapUntap`.)

## Decision

Add a declarative field to `ActivatedAbility`:

```ts
armsDelayedTriggerOnTap?: {
    triggerId: string;
    timing: "next-end-step" | "next-end-of-combat"
          | "next-draw-step" | "next-main-phase";
};
```

When a tap mana ability carrying this field is **tapped for mana** (the tap
branch of `tapUntap`, i.e. mana was just produced — never on untap), the engine
appends a `DelayedTriggerInstance` to `GameState.delayedTriggers`, exactly as
`scheduleDelayedTrigger` would, with:

- `sourceCardId` = the source's card-definition id (which owns the
  `delayedTriggers[]` template),
- `controller` = the **activating player** (CR 113.7 — the delayed trigger is
  controlled by whoever activated the ability),
- `payload.sourceId` = the source permanent instance id, so the trigger resolver
  can find the land regardless of who now controls it.

Rainbow Vale's `delayedTriggers["rainbow-vale-handoff"]` resolves at the next
end step by giving the land to the single opponent of the activator
(2-player; PRD #566 §Out of Scope) via indefinite `gainControl`. On the
opponent's subsequent tap the same rider arms again and hands it back — the land
**ping-pongs**.

No new `GameState` / `CardInstanceState` field is introduced: the rider rides the
existing `delayedTriggers` array and `nextDelayedSeq` counter, both already
persisted.

## Consequences

- "{T}: Add mana. <delayed side effect at a named boundary>" is now expressible
  for any tap mana ability without widening the `ActivatedAbilityContext` or
  routing tap-mana resolution through the stack.
- The rider is gated on `producedThisActivation` (set only when the source was
  tapped for mana), so it never fires on untap and never on a sacrifice-only
  refund path.
- Reusable beyond Rainbow Vale: any future "tap for mana, then trigger later"
  land/rock (e.g. lands that bounce themselves at end of turn) can declare it.
- No regression risk for existing tap mana sources: the branch is `undefined` for
  every land, Mox, and mana rock shipped to date.
