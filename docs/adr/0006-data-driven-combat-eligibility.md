# ADR 0006 — Data-driven combat eligibility (attack-restriction + attack-requirement)

**Status:** Accepted (2026-05-25)

## Context

CR 508.1 governs which creatures may or must attack. Before this ADR the
engine used two ad-hoc mechanisms:

1. **Attack restrictions (CR 508.1c)** — encoded as magic-string keywords on
   `staticAbilities` (e.g. `cant-attack-unless-defender-controls-Island`).
   `validateAttackerEligibility` in `combat.ts` parsed these strings with a
   regex, extracted the subtype, and checked the defender's battlefield. Each
   new restriction pattern required a new regex branch.

2. **Attack requirements (CR 508.1d)** — encoded as the `attacks-if-able`
   string in `staticAbilities`. `mustAttack` checked for the string directly.

This mirrored the problems solved by [ADR 0005][adr-0005] for untap-step
restrictions: every new card adds an engine branch, Oracle drift requires
multi-file changes, and the string-matching approach doesn't compose.

Meanwhile, block restrictions (CR 509.1b) were already data-driven via
`StaticBlockRestriction` on `staticEffects[]` since S2 — a predicate-based
approach where the engine collects and evaluates typed effect objects. The
attack side lagged behind.

## Decision

Add two new members to the `StaticEffect` union:

### `StaticAttackRestriction` (CR 508.1c)

```ts
interface StaticAttackRestriction {
    kind: "attack-restriction";
    id: string;
    predicate: (
        self: PermanentView,
        defenderBattlefield: readonly PermanentView[]
    ) => boolean;
    oracleText: string;
}
```

The predicate receives the attacking creature and the defending player's full
battlefield. Returns `true` when the attack is legal. This generalizes
"can't attack unless defender controls an Island" to any defender-battlefield
condition without engine changes.

### `StaticAttackRequirement` (CR 508.1d)

```ts
interface StaticAttackRequirement {
    kind: "attack-requirement";
    id: string;
    oracleText: string;
}
```

A marker effect — the engine collects it and forces the creature to attack
when otherwise eligible (not tapped, not summoning-sick, no defender keyword).
No predicate needed: the "if able" qualifier is handled by the engine's
existing eligibility check.

### Engine changes

- `validateAttackerEligibility` collects `attack-restriction` entries from
  the attacker's card definition via `collectAttackRestrictions` (mirrors
  `collectBlockRestrictions`) and evaluates each predicate. The regex parser
  for `cant-attack-unless-defender-controls-*` is removed.

- `hasAttackRequirement` checks whether the card definition carries an
  `attack-requirement` effect. `mustAttack` calls this instead of checking
  `staticAbilities.includes("attacks-if-able")`.

- Zero card-specific string checks remain in `combat.ts`.

### Card migrations

| Card        | Before                                              | After                                                        |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------ |
| Sea Serpent | `staticAbilities: ["cant-attack-unless-...Island"]` | `staticEffects: [{ kind: "attack-restriction", predicate }]` |
| Pirate Ship | same                                                | same pattern                                                 |
| Juggernaut  | `staticAbilities: ["attacks-if-able"]`              | `staticEffects: [{ kind: "attack-requirement" }]`            |

## Rationale

1. **Two-layer architecture.** The combat registry (keyword-level rules:
   defender, flying, fear, landwalk) handles rules shared by many cards. The
   `staticEffects[]` layer handles card-specific rules unique to one card.
   This mirrors [ADR 0005][adr-0005]'s split between engine-level dispatchers
   and card-level data.

2. **Consistency with S2.** Block restrictions already used this pattern.
   Aligning attack restrictions and requirements to the same shape means card
   authors learn one idiom for all combat eligibility rules.

3. **Predicate over regex.** A predicate can express any defender-battlefield
   condition (subtype presence, permanent count, color check) without new
   engine branches. The regex approach only supported subtype checks.

4. **No engine churn for new cards.** Future cards with attack restrictions
   (e.g. "can't attack unless you control an artifact") declare a predicate
   in their `staticEffects[]` — no `combat.ts` changes needed.

## Consequences

- `StaticEffect` union gains `StaticAttackRestriction` and
  `StaticAttackRequirement`.
- `combat.ts` no longer contains card-specific string checks. The engine
  iterates typed effect objects from the card registry.
- Frontend `player-battlefield.tsx` reads `staticEffects[]` for attack
  eligibility UI (mirroring the server logic).
- `KEYWORD_DISPLAY` map in `card-utils.ts` drops the removed keywords.
- All card set tests updated to verify data-driven effects.
- The `attacks-if-able` and `cant-attack-unless-defender-controls-*` strings
  are removed from the codebase (card defs + engine + frontend).

## Out of scope

- Aura-granted attack restrictions (e.g. an aura that prevents a creature
  from attacking) — would require `collectAttackRestrictions` to walk
  attached auras, same as `collectBlockRestrictions`. Not needed for LEA.
- Conditional attack requirements ("attacks each combat if able unless
  defender controls a Swamp") — no LEA cards have this pattern.
- Multi-player attack targeting (Two-Headed Giant, Archenemy) — single
  defender assumption.

[adr-0005]: ./0005-data-driven-untap-restrictions.md
