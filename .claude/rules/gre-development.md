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
