# Trigger-site event refs and list-valued capture

ADR 0048 shipped the `delayedTrigger` Op with **single-value, explicit**
`capture` and deliberately left two grammar gaps open (issues #865, #866).
This record closes both. They are the last pieces of trigger-site data access
the frozen grammar (bind/ref/if/forEach, ADR 0045) needs for the migration
backlog, and neither adds a structural construct or a new Op — both grow only
the **value grammar** and the **selector vocabulary**.

## `$event.<field>` — reading the firing event (issue #865)

An Effect Script at a **triggered-ability site** can read fields of the event
that fired it, via a reserved binding `$event` in the ordinary
`{ ref: "$event.<field>" }` shape. The field name is **flat and friendly**,
not the literal event shape:

```jsonc
// Battering Ram: "becomes blocked by a Wall → destroy that Wall at end of combat"
{
    "op": "delayedTrigger",
    "timing": "next-end-of-combat",
    "capture": { "$wall": { "ref": "$event.blockerId" } },
    "effects": [{ "op": "destroy", "target": { "ref": "$wall" } }],
}
```

A new **`EVENT_FIELD_REGISTRY`** — a name-authority table beside
`EFFECT_OP_REGISTRY` (ADR 0046) — maps `(GameEventType, field) → { family,
resolve }`. It is the single decision point:

- **Vocabulary is censused, not free-form.** A friendly field resolves through
  the table's `resolve(event)`, so `$event.damagedPlayer` can flatten a nested
  `TargetSelection` (`e.target.type === "player" ? e.target.id : undefined`)
  without a two-level ref — the ref regex stays single-level and the grammar
  stays frozen. Free-form `$event.<any GameEvent field>` was rejected: it
  gives no static family and turns a wrong field into a runtime skip instead
  of a CI failure, breaking validate.ts's dangling-ref guarantee.
- **Family typing is the table's job.** `$event.blockerId` is an object ref,
  `$event.damagedPlayer` a player ref; the validator reads the family off the
  row and checks the ref's position. `TriggeredAbility.event` is statically
  known, so validation is exact per trigger.
- **Scope is trigger-site-only.** `$event` is legal in a triggered ability's
  own effect script and in a `delayedTrigger` `capture` map nested in it;
  rejected in a delayed **body** (the event is gone at fire time), and at
  spell / activated sites (no firing event). The validator carries a
  trigger-site flag; the interpreter threads `top.triggerEvent` into the ctx
  at trigger sites (the seam `resolveTopOfStack` previously passed only to the
  imperative `resolve(ctx, event)` path).
- **LKI reuses the ADR 0048 capture semantics — no new machinery.** An
  `$event` object id is captured at trigger-fire (object alive), re-bound
  fresh at the effect's run; if the object has left by then the Op skips
  (CR 608.2b + 701.7c: destroying an absent permanent is a no-op). The three
  unblocked cards only **act** on the event object (destroy / poison), never
  **read** a characteristic of a departed one, so true CR 603.10 read-LKI
  (preserving a scheduling-time snapshot of a gone object's P/T) is not built
  here — it waits for a card that forces it.

**Conditional picks stay out.** Venom ("destroy _the other_ creature in the
pair") is expressed as **two triggered abilities** — the role discrimination
lives in the already-imperative `matches` (host-is-blocker vs host-is-attacker),
each with a clean single-field `$event` capture — rather than an id-equality
`if` predicate. Id-equality predicates are deferred as a demand-driven
capability tracked by a `$id-equality` classifier pseudo-blocker, not built
speculatively for one card (CLAUDE.md § Primitive reuse). BLOCKERS_CONFIRMED is
emitted per attacker-blocker pair, so the split fires correctly under
multi-block and banding.

## List-valued capture — freeze a set at scheduling (issue #866)

A `delayedTrigger` `capture` entry may resolve to **N** instance ids, read in
the delayed body as a `forEach`-iterable list binding. The payload widens to
`Record<string, string | string[]>` (a key holds a scalar or a list); the
capture source gains a `{ select: EffectListSelector }` variant; the body
iterates with a new `{ set: "bound", ref: "$partners" }` forEach selector.

```jsonc
// Venomous Breath: "at next end of combat, destroy all creatures that
//                   blocked or were blocked by target this turn"
{
    "op": "delayedTrigger",
    "timing": "next-end-of-combat",
    "capture": {
        "$partners": {
            "select": { "set": "combatPartners", "of": { "target": 0 } },
        },
    },
    "effects": [
        {
            "op": "forEach",
            "select": { "set": "bound", "ref": "$partners" },
            "effects": [{ "op": "destroy", "target": { "ref": "$each" } }],
        },
    ],
}
```

The `combatPartners` selector scans `state.combat.blockerAssignments`
bidirectionally (CR 509.1h — "blocked **or** were blocked by") and is resolved
at **scheduling (cast)** time, freezing the partner ids into the payload.
Members that leave the battlefield before the trigger fires stay in the frozen
list; their `destroy` is a no-op (CR 608.2b).

**Why freeze-at-cast, not evaluate-at-fire.** Evaluating the selector at the
end-of-combat fire is closer to the CR's "this turn" wording _in the
abstract_, but the engine's combat state is **live-only** — a creature that
dies is pruned from `blockerAssignments` (phases.ts). So a fire-time
`combatPartners-of-$target` returns an empty set when the **target itself**
died in combat, wrongly sparing the blockers that killed it. Freeze-at-cast
captures the pairing while every creature is still alive (blocks already
declared) and destroys the survivors at end of combat — the target's later
death is irrelevant. A fully CR-faithful fire-time evaluation would need a
turn-scoped block history that survives death; that is a larger engine change
for one card, deferred until demand appears.

## Consequences

- Two demand-driven capabilities: `$event` refs unblock Battering Ram, Nafs
  Asp, Venom; list capture unblocks Venomous Breath. Both grow their own
  vocabulary (`EVENT_FIELD_REGISTRY` rows, `EffectListSelector` members) one
  card at a time — the classifier pseudo-blockers `$event-ref` /
  `$list-capture` flip, and `$id-equality` is added for the deferred predicate.
- Both slices earn the full "new construct usage" test regime (interpreter
  unit + wire-format assertion once through `projectPublicState`); the list
  payload adds a `serialize.test.ts` round-trip with a non-empty `string[]`.
  The migrated cards ride the catalogue sweeps at zero per-card cost.
- The grammar stays frozen at four structural constructs — only the value
  grammar (`$event` ref family) and the selector vocabulary
  (`combatPartners`, `{ set: "bound" }`) grow. ADR 0045 is not reopened.
- Deferred, tracked, not built: id-equality `if` predicates; a general
  (non-capture) `combatPartners` forEach selector; true CR 603.10 read-LKI for
  departed event objects; a turn-scoped block history.
