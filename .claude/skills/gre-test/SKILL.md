---
name: gre-test
description: Generate vitest tests for GRE modules following project patterns. Creates test files with helpers, fixtures, and CR-referenced test cases.
argument-hint: "<module or feature to test>"
---

# GRE Test Generator

Generate vitest test files for Tolaria's Game Rules Engine, following established project patterns.

## Test file conventions

All GRE tests live in `convex/gre/__tests__/` and follow this structure:

### 1. Imports

```typescript
import { describe, it, expect } from "vitest";
// Import the functions being tested
import { functionUnderTest } from "../module";
// Import types
import type { CardInstanceState, GameState, PlayerState } from "../state";
import type { CardType } from "../../cards/types";
```

### 2. Test helpers (copy from existing tests, adapt as needed)

Three standard builders — always present:

```typescript
function makeCard(
    cardData: Record<string, unknown>,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: cardData,
        types: (cardData.types as CardType[]) ?? [],
        subtypes: (cardData.subtypes as string[]) ?? [],
        power: cardData.power as number | undefined,
        toughness: cardData.toughness as number | undefined,
        staticAbilities: (cardData.staticAbilities as string[]) ?? [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        isTapped: false,
        ...overrides,
    };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: "p1",
        name: "Player 1",
        bgColor: "#000",
        life: 20,
        deck: {},
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
    return {
        players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        ...overrides,
    };
}
```

**Note:** `makeCard` signature varies slightly between test files. In `phases.test.ts` it takes `overrides` with an optional `card` field. In `rules.test.ts` it takes `cardData` as first arg. Read existing test files to match the style closest to the module being tested.

### 3. Card fixtures

Define as `const` objects at the top, after helpers:

```typescript
const PLAINS = { name: "Plains", types: ["Land"], subtypes: ["Plains"] };
const LIGHTNING_BOLT = {
    name: "Lightning Bolt",
    manaCost: { R: 1 },
    types: ["Instant"],
};
```

### 4. Describe blocks — organized by CR section

```typescript
describe("functionName", () => {
    describe("topic (CR {number})", () => {
        it("describes expected behavior", () => {
            // Arrange
            const state = makeGameState({
                /* overrides */
            });
            // Act
            const result = functionUnderTest(state);
            // Assert
            expect(result).toBe(expected);
        });
    });
});
```

### 5. Naming conventions

- Describe blocks: function name → topic with CR reference
- Test names: declarative, behavior-focused ("creature can be cast when stack is empty")
- Negative tests: "does NOT..." or "cannot..."
- Edge cases: "does not throw when library is empty"

## What to test

For each function or rule:

1. **Happy path** — basic correct behavior
2. **Negative cases** — illegal actions, invalid states
3. **Edge cases** — empty zones, turn 1 special rules, 0 values
4. **CR compliance** — reference the specific rule number being validated

## Running tests

- `bun run test` — run all tests once
- `bun run test:watch` — watch mode

After generating tests, run `bun run test` to verify they pass.
