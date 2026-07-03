# delayedTrigger Op: inline body with explicit capture

The `delayedTrigger` Effect Script Op (CR 603.7, issue #838) grants a delayed
triggered ability — a future one-shot effect, not an immediate state change —
so its shape sets the pattern for every timing-shaped Op that follows. We
decided the delayed body is an **inline nested Effect Script on the Op
itself**, and everything the body needs from scheduling time crosses the
boundary through an **explicit `capture` map**.

```jsonc
{
    "op": "delayedTrigger",
    "timing": "next-end-step",
    "oracleText": "At the beginning of the next end step, destroy it.",
    "capture": { "$it": { "target": 0 } },
    "effects": [{ "op": "destroy", "target": { "ref": "$it" } }]
}
```

At scheduling, the interpreter resolves each `capture` value (target slot,
binding ref, literal) to a serializable string and stores it in the existing
`DelayedTriggerInstance.payload`; the body (pure JSON, like every Effect
Script) is persisted on the instance alongside it. At fire time the payload
becomes the body's initial binding environment and the interpreter runs the
body directly — no card-definition lookup.

## Considered options

- **Inline body on the Op (chosen).** The whole card reads like its oracle
  text in one script; consistent with `if`/`forEach`, which already nest
  `EffectOp[]` inline; the fired trigger is self-contained in game state.
  Cost: the body must be expressible entirely in registered Ops — a card
  whose delayed body needs an unshipped Op cannot migrate until that Op
  ships (it migrates in its LAST missing Op's issue).
- **Reference to a `delayedTriggers[]` template on the card definition.**
  Thinner state, unchanged fire path, but splits a card's script across two
  places and keeps the def-level template alive as a DSL construct forever.
- **Generic `grantTriggeredAbility` Op.** Delayed triggers as the one-shot
  case of trigger-granting. Overgeneral: no card in the backlog needs
  repeatable granted triggers, and CR 603.7 is its own category.

## Consequences

- `DelayedTriggerInstance` (and the stack item it fires into) carries the
  body script; the serialization drift guard covers the new optional fields.
- `cardDef.delayedTriggers[]` + `SpellContext.scheduleDelayedTrigger` remain
  as the legacy seam for `resolve()` cards until each migrates.
- Capture is single-value and explicit. Two known grammar gaps are tracked
  separately, not folded into the Op: event-field refs at trigger sites
  (`$event.<field>` — Venom, Battering Ram, Nafs Asp) and list-valued
  captures (Venomous Breath).
- The migration classifier unions a delayed body's primitives into its
  scheduling closure and marks the grammar gaps with pseudo-blockers, so the
  FREE tranche stays truthful.
