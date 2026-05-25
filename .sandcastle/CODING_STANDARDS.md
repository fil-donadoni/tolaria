# Coding Standards — Tolaria

Tolaria is an MTG gameplay engine. Rules correctness and real-time reactivity are the top priorities.

## Tech Stack

| Layer       | Technology                     |
| ----------- | ------------------------------ |
| Frontend    | React 19 + TypeScript + Vite 8 |
| Backend/DB  | Convex (real-time reactive)    |
| Auth        | @convex-dev/auth (Password)    |
| Package mgr | bun (host) / npm (container)   |
| TS          | ~5.9 strict mode               |
| Lint        | ESLint 9 flat config           |
| Format      | Prettier (80 char, 4 spaces)   |

## Architecture

- **GRE (Game Rules Engine)** runs server-side in Convex mutations. The client never validates rules.
- GRE is **authoritative**, **deterministic**, and **isolated** from transport.
- Frontend communicates only via public mutations in `convex/game.ts` — never imports from `convex/gre/`.
- Two tables: `game_state` (current snapshot, overwritten each action) and `game_events` (append-only log, source of truth).
- State saved **only at stable points** (when waiting for human input).
- Stack resolves one item at a time. After each resolution, priority restarts from active player. Both players must pass consecutively to advance.

## Domain Vocabulary

Use exact terms from `CONTEXT.md`. Key mappings:

| Use             | Avoid                         |
| --------------- | ----------------------------- |
| Player          | User (that's the auth entity) |
| Turn            | Round                         |
| Phase           | Step (we flatten both)        |
| Library         | Deck (ambiguous)              |
| Battlefield     | Board, field                  |
| Active Player   | Current player                |
| Permanent       | Card on board                 |
| Card Instance   | Card object                   |
| Card Definition | Card template                 |

## Type System

### Single source of truth — centralized types

- `convex/cards/types.ts` → `CardDefinition`, `SpellContext`, `ManaCost`, `TargetRequirement`, `ActivatedAbility`, `TriggeredAbility`
- `convex/gre/state.ts` → `GameState`, `PlayerState`, `CardInstanceState`
- `convex/gre/types.ts` → `Zone`, `Phase`, `CardAction`, `PendingChoiceKind`
- `convex/gre/constants.ts` → `LAND_SUBTYPE_MANA`, `PERMANENT_TYPES`, `isCreature()`, `isLand()`, `isAura()`
- Frontend re-exports via `src/types/cards.ts` and `src/types/game.ts`

**Never** define local game types or constants in components or test files.

### Player identity

`players[].id` is `v.string()` — do NOT type as `Id<"users">`. For solo games it's `${userId}-p1` / `${userId}-p2`.

## Code Organization

- **One React component per file** — no exceptions, no inline sub-components
- Extract visual state computation into named functions or dedicated files
- Use `useGameContext()` for shared game state — never prop-drill `GameState`
- All UI text in English
- No comments unless the WHY is non-obvious

## GRE Development Rules

### CR compliance (mandatory)

- Every game mechanic MUST reference its CR section in code comments
- Before implementing a new rule, verify against official Comprehensive Rules
- Flag any deviation explicitly — document what's simplified and why
- Cards follow modern Scryfall Oracle text, not printed/Alpha text

### Pure functions only

- All game state mutations are pure functions (no side effects, no async)
- Card definitions are DATA, not imperative code — use `resolve()` only when needed
- Mana abilities use `useStack: false` (CR 605.3a)

### Primitive reuse (mandatory)

Target scale is ~80k cards. Before adding a new `SpellContext` primitive:

1. **Decompose** — Can it be expressed as existing primitives in sequence?
2. **Generalize** — Can an existing primitive be parametrized?
3. **Orthogonality** — Does it represent a general zone/mana/life operation?
4. **Composition over flags** — Avoid booleans that change behavior

### Serialization

Every optional field on `GameState` must be added to `PERSISTED_OPTIONAL_KEYS` in `serialize.ts` (or `TRANSIENT_KEYS` if ephemeral). The drift guard test in `serialize.test.ts` catches omissions.

When adding a new optional field:

1. Add key to `PERSISTED_OPTIONAL_KEYS`
2. Add round-trip smoke test with non-empty value
3. Run tests — drift guard will catch omissions

### State compression

Three layers at the Convex storage boundary:

1. Library entries → `[instanceId, cardId]` tuples
2. Default stripping — omit fields equal to defaults
3. Definition coalescing — types/subtypes/power/toughness coalesce against card definition

`projectPublicState` / `projectFullState` strip fat fields for the wire (`card.card` → `{ id }`, opponent hand → `null[]`, library → `{ count }`).

## Card Definitions

### Structure

Three complexity levels:

1. **Pure data** — Vanilla creatures, basic lands (stats only)
2. **Declarative** — Triggered/activated/static abilities using templates (`enteredTrigger`, `diedTrigger`, `makeTapForMana`, etc.)
3. **Imperative** — `resolve()` for complex effects

### Checklist for new cards

- Verify mana cost against Scryfall
- Map keywords to `staticAbilities[]`
- Set `targetRequirement` for targeted spells
- Use existing `SpellContext` methods in `resolve()`
- Uncomment existing stubs (stub UUIDs map to card art) — do NOT create new `CardDefinition` if a stub exists

## Testing

### Quality gates (mandatory, no exceptions)

```bash
bun run check:all   # format + lint + type-check (zero errors)
bun run test        # vitest suite (zero failures)
```

Do NOT commit if either gate fails. In the Docker container, use `npm run` instead of `bun run`.

### Card tests

Card tests go in the **parallel test file** of the set:

```
convex/cards/sets/lea.ts  →  convex/cards/sets/__tests__/lea.test.ts
```

Shared fixtures from `convex/cards/__tests__/setup.ts` (`makeInstance`, `makePlayer`, `makeState`, `pushSpell`). Do NOT duplicate helpers.

### Required coverage per card

| Card has                       | GRE test | Wire format test                            |
| ------------------------------ | -------- | ------------------------------------------- |
| `resolve()` (spell)            | YES      | Only if effect is visible client-side       |
| `staticEffects[]` (layer 7c)   | YES      | **YES** — re-run after `projectPublicState` |
| `staticAbilities[]` (keywords) | snapshot | Not needed                                  |
| `activatedAbilities[]`         | YES      | **YES** if outcome is visible               |

### Wire format test pattern (mandatory for visible effects)

```ts
const state = makeState(/* scenario */);
expect(getEffectiveToughness(state, target)).toBe(expected);
// Same assertion must survive projection:
const projected = projectPublicState(state, 1, viewerId);
const slimTarget = projected.players[i].battlefield.find(
    (c) => c.id === target.id
)!;
expect(getEffectiveToughness(projected, slimTarget)).toBe(expected);
```

### GRE tests

- Tests reference CR section: `describe("lands (CR 305.2)")`
- Every new function or behavior change needs tests in `convex/gre/__tests__/`

### Preset scenarios

For new cards or gameplay features, add a `PRESET_SCENARIOS` entry in `src/components/debug/debug-panel.tsx` for one-click testing from the Debug panel.

## Anti-Patterns (do NOT)

- ✗ Import `convex/gre/` engine modules from frontend
- ✗ Define local types/constants that duplicate centralized ones
- ✗ Prop-drill `GameState` — use `useGameContext()`
- ✗ Write multiple components in one file
- ✗ Add card-specific `SpellContext` primitives — compose existing ones
- ✗ Use `any` types
- ✗ Write UI text in non-English
- ✗ Leave commented-out code or TODO comments
- ✗ Skip quality gates before committing
- ✗ Use `mutation` in GRE — pure functions only

## Commit Convention

```
RALPH: <summary> (<issue ref>)

- Key decisions made
- Files changed
- Blockers for next iteration
```
