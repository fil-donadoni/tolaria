---
description: Rules for developing Game Rules Engine modules
globs:
    - "convex/gre/**/*.ts"
    - "convex/cards/**/*.ts"
---

# GRE Development Rules

When modifying files in `convex/gre/` or `convex/cards/`:

## Rules compliance

- Every game mechanic MUST reference its CR (Comprehensive Rules) section in code comments
- Before implementing a new rule or modifying existing behavior, verify against official CR using `/mtg-rules-check`
- Flag any deviation from CR explicitly — document what's simplified and why

## Testing requirement

- Every new function or behavior change MUST have corresponding tests in `convex/gre/__tests__/`
- Tests MUST reference the CR section they validate (e.g. `describe("lands (CR 305.2)")`)
- Run `bun run test` after any change — zero failures required

## Card testing convention (mandatory)

Every card with non-trivial behavior gets a dedicated `describe` block in the **parallel test file** of its set:

```
convex/cards/sets/lea.ts          →  convex/cards/sets/__tests__/lea.test.ts
convex/cards/sets/alpha.ts        →  convex/cards/sets/__tests__/alpha.test.ts
```

Shared fixtures live in `convex/cards/__tests__/setup.ts` (`makeInstance`, `makePlayer`, `makeState`, `pushSpell`). Import from there — do NOT duplicate fixture helpers in set tests.

Required coverage per card:

| Card has                       | GRE test                                                                              | Wire format test                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `resolve()` (spell)            | yes — push on stack, `resolveTopOfStack`, assert outcome                              | only if the effect is visible client-side                                     |
| `staticEffects[]` (layer 7c)   | yes — assert `getEffectivePower/Toughness` with and without the effect                | **YES, mandatory** — re-run the assertion after `projectPublicState`          |
| `staticAbilities[]` (keywords) | snapshot check on the definition (`expect(card.staticAbilities).toContain("flying")`) | not needed (keywords are already exercised by combat/rules tests generically) |
| `activatedAbilities[]`         | yes — trigger the ability via GRE entry point, assert state change                    | **YES, mandatory** if the ability's outcome is visible on the board           |

**Why the wire format test is mandatory for visible effects.** The server projects `GameState` → `PublicGameState` / `FullGameState` before it crosses the network (`convex/gameProjections.ts`). The projection strips `card.card` to `{ id }` and reshapes arrays (`library: { count }`, opponent `hand: null[]`). A feature that passes the GRE unit test can still be silently broken on the client if the engine reads fat fields that the projection strips. Wire format tests re-run the same assertion against the projected state and are the only tests that catch this class of bug.

Minimum wire format test pattern:

```ts
const state = makeState(/* scenario */);
// assert GRE behavior on fat state:
expect(getEffectiveToughness(state, target)).toBe(expected);
// assert the same behavior survives the projection:
const projected = projectPublicState(state, 1, viewerId);
const slimTarget = projected.players[i].battlefield.find(
    (c) => c.id === target.id
)!;
expect(getEffectiveToughness(projected, slimTarget)).toBe(expected);
```

## Code patterns

- All game state mutations are pure functions (no side effects, no async)
- Card definitions are DATA, not imperative code — use `resolve()` only when needed
- Types come from `convex/cards/types.ts` (CardDefinition, ManaCost, SpellContext) and `convex/gre/state.ts` (GameState, PlayerState, CardInstanceState)
- Constants and helpers live in `convex/gre/constants.ts` — never define locally
- Mana abilities use `useStack: false` (CR 605.3a)

## Card definition checklist

When adding/modifying cards in `convex/cards/sets/`:

- Verify mana cost against Scryfall
- Map keywords to `staticAbilities[]`
- Set `targetRequirement` for targeted spells
- Use `SpellContext` methods in `resolve()` — if a needed method doesn't exist, flag it
