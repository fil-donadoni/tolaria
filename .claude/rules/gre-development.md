---
description: Rules for developing Game Rules Engine modules
globs:
    - "convex/gre/**/*.ts"
    - "convex/cards/**/*.ts"
---

# GRE Development Rules

When modifying files in `convex/gre/` or `convex/cards/`:

## Rules compliance

- **CR-compliance is the default — never ask the user whether to follow the Comprehensive Rules.** When behavior is governed by the CR, implement it exactly as the CR specifies. Only surface a question when the CR is genuinely ambiguous, when intentionally simplifying/deferring, or when a design choice is not dictated by the CR. Verify the relevant CR text first (`/mtg-rules-check`) rather than asking.
- Every game mechanic MUST reference its CR (Comprehensive Rules) section in code comments
- Before implementing a new rule or modifying existing behavior, verify against official CR using `/mtg-rules-check`
- Flag any deviation from CR explicitly — document what's simplified and why

## Testing requirement

- Every new function or behavior change MUST have corresponding tests in `convex/gre/__tests__/`
- Tests MUST reference the CR section they validate (e.g. `describe("lands (CR 305.2)")`)
- Run `bun run test` after any change — zero failures required

## Card testing convention (mandatory)

Every set is a colour-split DIRECTORY (`sets/<code>/<colour>.ts`, ADR 0043), and
every card with non-trivial behavior gets a dedicated `describe` block in the
**parallel per-colour test file** matching the colour module the card lives in:

```
convex/cards/sets/lea/red.ts      →  convex/cards/sets/lea/__tests__/red.test.ts
convex/cards/sets/lea/blue.ts     →  convex/cards/sets/lea/__tests__/blue.test.ts
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

## End-to-end targeting test (mandatory for new target types)

When a new `TargetRequirement.type` value is introduced (e.g. `"spell-or-permanent"`), the following sites MUST be tested — GRE unit tests alone are NOT sufficient:

| Layer    | What to test                                                                       | File                                      |
| -------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| GRE      | `getLegalTargets` returns correct targets for the new type                         | `convex/gre/__tests__/` or card test file |
| Backend  | `selectTarget` mutation accepts the new type for both permanent and spell branches | `convex/game.ts` integration test         |
| Frontend | `matchesTargetRequirement` marks battlefield cards as clickable                    | `src/lib/__tests__/card-utils.test.ts`    |
| Frontend | `wantsSpellTarget` enables stack spell selection                                   | `src/components/board/` test              |
| Frontend | `TARGET_LABEL` has an entry (no raw fallback string)                               | `src/components/board/` test              |

**Rule: every feature that crosses the GRE → game.ts → UI boundary MUST have at least one integration test that exercises the full path. Two pieces passing individually but failing together is a shipped bug.**

## Exhaustive target-type matching

Code that switches on `TargetRequirement.type` values MUST use an exhaustive helper or explicitly list every member of the union. A raw `reqTypes.includes("spell")` that doesn't also handle `"spell-or-permanent"` is a bug. When adding a new type value, grep for every consumer and update all of them.

## Serialization requirement

Every optional field on `GameState` must be added to `PERSISTED_OPTIONAL_KEYS` in `serialize.ts` (or `TRANSIENT_KEYS` if intentionally ephemeral). The schema drift guard test in `serialize.test.ts` fails when a GameState key is missing from both sets — this prevents silent field loss across DB writes.

When adding a new optional field to `GameState`:

1. Add the key to `PERSISTED_OPTIONAL_KEYS` in `serialize.ts`
2. Add a round-trip smoke test in `serialize.test.ts` with a non-empty representative value
3. Run `bun run test` — the drift guard will catch omissions

## Code patterns

- All game state mutations are pure functions (no side effects, no async)
- Card definitions are DATA, not imperative code — use `resolve()` only when needed
- Types come from `convex/cards/types.ts` (CardDefinition, ManaCost, SpellContext) and `convex/gre/state.ts` (GameState, PlayerState, CardInstanceState)
- Constants and helpers live in `convex/gre/constants.ts` — never define locally
- Mana abilities use `useStack: false` (CR 605.3a)

## Primitive reuse (mandatory)

Target scale is ~80k cards. One dedicated `SpellContext` primitive per card does not scale — primitives must be small, orthogonal, and composable.

Before adding a new primitive to `SpellContext`:

1. **Decompose the effect.** Can it be expressed as a sequence of existing primitives? E.g. Timetwister = `moveZone(hand→library)` + `moveZone(graveyard→library)` + `shuffleLibrary` + `drawCards(7)`. No new primitive needed.
2. **Generalize, don't add.** If an existing primitive is almost right, parametrize it. `drawCards(player, n)` is "move N from library top to hand" — a `moveZone` with position/count parameters may subsume it and more.
3. **Orthogonality check.** New primitives should represent a general zone/mana/life operation (movement, mutation, lookup), not a card-shaped effect ("shuffleHandAndGraveyardIntoLibrary" fails this test; "moveZone" passes).
4. **Composition over flags.** Avoid adding boolean flags to existing primitives that change behavior — prefer calling a sequence of simpler primitives.

If after those checks a new primitive is still needed, flag it explicitly in the PR/implementation and document why it couldn't be composed.

## Card definition checklist

When adding/modifying cards in `convex/cards/sets/`:

- Verify mana cost against Scryfall
- Map keywords to `staticAbilities[]`
- Set `targetRequirement` for targeted spells
- Use `SpellContext` methods in `resolve()` — if a needed method doesn't exist, flag it
