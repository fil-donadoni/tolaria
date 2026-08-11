# ADR 0002 — Trigger factory architecture

**Status:** Accepted (2026-05-22)

## Context

The GRE event system (`PHASE_BEGIN`, `CREATURE_DIED`, `PERMANENT_ENTERED`,
`PERMANENT_LEFT`, `DAMAGE_DEALT`, `SPELL_CAST`, `PERMANENT_TAPPED`,
`STATE_CHECK`) scales: one event type covers a wide CR surface and cards
declare `TriggeredAbility` listeners via `matches`/`resolve` callbacks. The
authoring side does NOT scale: by ~30 LEA cards every trigger reimplements
the same scaffold (`event.type !== "X"` narrowing, scope check on
`controllerId`/`activePlayerId`/host, intervening-if absent or simulated). The
project targets ~80k cards. Without a factory layer, every new card will
add 5-15 lines of boilerplate to the trigger and reintroduce the same
narrowing bugs.

## Decision

Introduce a layer of **specialized factories** in
`convex/cards/abilities/triggers/` — one factory per game event kind — that
produce `TriggeredAbility` values from a declarative argument object.

### Factories

| Factory              | Event                    | Scope axis                                                             |
| -------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `phaseTrigger`       | `PHASE_BEGIN`            | `your` / `each` / `opponents` / `host-controller`                      |
| `diedTrigger`        | `CREATURE_DIED`          | `self` / `yours` / `opponents` / `any` / `another-yours` / `any-other` |
| `enteredTrigger`     | `PERMANENT_ENTERED`      | same as `diedTrigger`                                                  |
| `leftTrigger`        | `PERMANENT_LEFT`         | same as `diedTrigger` + optional `toZone`                              |
| `damageDealtTrigger` | `DAMAGE_DEALT`           | scope on source side, optional `target` discriminated union            |
| `damageTakenTrigger` | `DAMAGE_DEALT`           | scope on target side, optional `sourceFilter`                          |
| `spellCastTrigger`   | `SPELL_CAST`             | scope on caster (`you` / `opponents` / `any` / `self`)                 |
| `tappedTrigger`      | `PERMANENT_TAPPED`       | same as `diedTrigger`, plus optional `forMana` flag                    |
| `stateTrigger`       | `STATE_CHECK` (CR 603.8) | none — condition-only                                                  |

### Filter types

Per-domain filter types, separated by event kind (no shared base interface):

- `PermanentFilter` (already exists in `convex/cards/types.ts`, extended)
- `SpellFilter` (new — types/subtypes/colors only)
- `DamageSourceFilter` (new)
- `PlayerFilter` (new — relation/life constraints)

All filter types live in **new** `convex/cards/filters.ts`. The
`PermanentFilter` name stays (a permanent is on-battlefield by definition, CR
110.1 — `BattlefieldFilter` would be redundant).

### Trigger callback signature (resolve)

Each factory passes a **factory-specialized derived payload** to its `resolve`
callback. Example:

```ts
diedTrigger({
    scope: "yours",
    filter: { subtypes: "Elf" },
    resolve: (
        ctx,
        event,
        deadCreature: {
            id;
            controllerId;
            types;
            lastKnownPower;
            lastKnownToughness;
            damagedBySources;
        }
    ) => {
        /* ... */
    },
});
```

This delivers two benefits:

1. No `if (event.type !== "X") return;` narrowing inside `resolve`.
2. Last-known-information fields (CR 603.10) are **explicit on the payload**
   so card authors can't forget to read them.

### Intervening-if support

Two callback fields on every factory:

- `condition?: (event, self, state) => boolean` — CR 603.4, check-time only.
- `interveningIf?: (event, self, state) => boolean` — CR 603.4, checked at
  trigger-check time AND re-checked at resolve time. If false at resolve,
  the trigger fizzles.

The engine integrates `interveningIf` as a dedicated field on
`TriggeredAbility`: `resolveTopOfStack` re-evaluates it before invoking
`resolve` (rather than baking the re-check inside the factory's wrapped
resolve closure). This keeps fizzle semantics observable at the engine layer
for future event-log entries and downstream triggers reacting to fizzles.

`stateTrigger` has built-in intervening-if semantics per CR 603.8 — its
`condition` is automatically re-checked at resolve, no separate `interveningIf`
field exposed.

## Rationale

1. **Factory specialized per event** beats both a generic
   `eventTrigger<E>({ scope, filter, ... })` (heavy mapped types, fragile TS
   inference, error messages obscure) and a fluent builder
   (`trigger().on().scope().build()` — verbose for ~5-field shape, breaks
   data-driven idiom of the codebase, hard to keep `resolve` callback
   type-narrowed). Specialization mirrors the existing
   `makeTapForMana`/`makeDualLand` pattern.

2. **Separate filter types** beat a single extended `PermanentFilter` because
   each domain has distinct vocabulary: spells on stack have no `isToken`;
   damage sources may live on the stack rather than the battlefield; players
   need `lifeAtMost`/`lifeAtLeast` constraints that don't apply to permanents.
   Forcing one filter type produces optional-everywhere fields. The cost is
   ~4 small interfaces instead of 1 wide one — a trade for type
   self-documentation.

3. **Scope vocabulary parallelism** (the `self / yours / opponents / any /
another-yours / any-other` set shared across `diedTrigger`,
   `enteredTrigger`, `leftTrigger`, `tappedTrigger`) lets card authors learn
   one vocabulary and reuse it across every permanent-anchored factory. The
   factories differ only in event payload, not in how scope is reasoned
   about.

4. **Engine-level `interveningIf`** (rather than wrapping it inside the
   factory's `resolve`) is mandated by the project's "CR adherence 100%"
   guideline. CR 603.4 fizzling is a game-event-level concept; the engine
   should be able to log it, react to it, and present it in the UI as
   distinct from "trigger resolved but effect did nothing."

5. **Rollout via vertical slices.** Implementation order (`phaseTrigger`
   first, the rest by frequency-of-use) is captured in the project plan
   (`.claude/plans/`). Each slice: factory + matching card migrations +
   tests + zero changes to unrelated cards. Atomic, revertible per slice.

## Consequences

- 9 new factory files under `convex/cards/abilities/triggers/`.
- New file `convex/cards/filters.ts` with 4 filter types and matcher helpers.
- `TriggeredAbility` interface gains optional `interveningIf` field.
- `resolveTopOfStack` gains an intervening-if check before invoking
  `resolve` (~10 LOC engine change, one test in `gre/__tests__/`).
- All existing inline-literal `TriggeredAbility` declarations in
  `convex/cards/sets/lea.ts` are migrated to factory calls across slices 1-8.
- `makeUpkeepPayOrElse` (existing partial factory in `lea.ts`) becomes a
  thin wrapper around `phaseTrigger({ phase: "UPKEEP", scope: "your", ... })`.
- Future card sets (Alpha, Beta, Arabian Nights, etc.) declare triggers via
  factories only. New inline `TriggeredAbility` literals are a red flag in
  review — they signal either a missing factory (extend) or a true
  one-off (rare, document with comment).

## Out of scope

- Generic `eventTrigger<E>` unification — explicitly rejected, see Rationale 1.
- Filter base interface (`BaseFilter`) — defer until 4th filter type needs
  shared fields; pull up at that point only.
- Unified `zoneChangeTrigger` for non-battlefield exits — see ADR 0001.
