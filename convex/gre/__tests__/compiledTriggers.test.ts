// Compiled triggered-ability descriptors reach the engine as REAL triggers
// (issue #2698, CR 603.2 / 603.4 / 603.6a).
//
// The Oracle compiler cannot emit a `TriggeredAbility`: `matches` is a required
// closure and the compiler emits JSON only (ADR 0105). It emits a JSON
// DESCRIPTOR instead, and `expandCompiledTriggers` rebuilds the ability at the
// `expandDefinition` seam. Everything about that is invisible to a grammar
// test — a descriptor that lowered perfectly and rebuilt into an ability that
// never fires reads exactly like a correct compile — so the assertions below
// go through the ENGINE: a real entry event, the real trigger scan, the real
// stack, the real resolution.
//
// The tests deliberately register their fixtures with a
// `compiledTriggeredAbilities` field and NOTHING else, so a seam that stopped
// running (or an expander order that lost the field) fails here rather than
// showing up as a card that quietly does nothing in a game.

import { describe, it, expect } from "vitest";
import {
    createTokenPermanents,
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
    type GameState,
} from "../state";
import { registerTokenDefinition, getDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardDefinition, TokenSpec } from "../../cards/types";

/** A plain 1/1 creature token — the thing that ENTERS in every test below. */
const BEAR: TokenSpec = {
    name: "Test Bear",
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 1,
    toughness: 1,
    colors: ["G"],
};

/** A Goblin token — the board state the CR 603.4 condition counts. */
const GOBLIN: TokenSpec = {
    name: "Test Goblin",
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    colors: ["R"],
};

/** "Whenever another creature enters, you gain 1 life." — Essence Warden, as
 *  the compiler emits it. */
const WARDEN_ID = "test-2698-warden";
registerTokenDefinition({
    id: WARDEN_ID,
    name: "Test Warden",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    compiledTriggeredAbilities: [
        {
            id: "test-2698-warden-trigger",
            oracleText: "Whenever another creature enters, you gain 1 life.",
            head: {
                kind: "entered",
                scope: "any-other",
                filter: { types: ["Creature"] },
            },
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        },
    ],
} satisfies CardDefinition);

/** The same ability behind a CR 603.4 intervening-if: "…, if you control a
 *  Goblin, …". Not a printed card — the condition and the head are orthogonal
 *  and the pair that isolates the CONDITION is the one worth testing. */
const CONDITIONAL_ID = "test-2698-conditional";
registerTokenDefinition({
    id: CONDITIONAL_ID,
    name: "Test Conditional Warden",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    compiledTriggeredAbilities: [
        {
            id: "test-2698-conditional-trigger",
            oracleText:
                "Whenever another creature enters, if you control a Goblin, you gain 1 life.",
            head: {
                kind: "entered",
                scope: "any-other",
                filter: { types: ["Creature"] },
            },
            condition: {
                kind: "controls",
                filter: { subtypes: ["Goblin"] },
                atLeast: 1,
            },
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        },
    ],
} satisfies CardDefinition);

function boardWith(defIds: string[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: defIds.map((id, i) =>
                    makeInstance(id, {
                        id: `p1-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2", {}),
        ],
    });
}

describe("the expansion seam (ADR 0054, issue #2698)", () => {
    it("rebuilds the descriptor into a real triggered ability", () => {
        const expanded = getDefinition(WARDEN_ID);
        expect(expanded.triggeredAbilities).toHaveLength(1);
        const ability = expanded.triggeredAbilities![0]!;
        expect(ability.event).toBe("PERMANENT_ENTERED");
        // `matches` is the field the compiler cannot author — its presence
        // here IS the seam having run.
        expect(typeof ability.matches).toBe("function");
        expect(ability.effects).toEqual([
            { op: "gainLife", player: "controller", amount: 1 },
        ]);
    });

    it("CONSUMES the descriptor field, so the expanded definition carries no trace", () => {
        // Not tidiness: the gold harness compares an expanded compiled card to
        // a hand-written one, and a leftover descriptor would read as a
        // compiler defect on every trigger card.
        expect(
            getDefinition(WARDEN_ID).compiledTriggeredAbilities
        ).toBeUndefined();
    });
});

describe("a compiled ETB trigger fires and resolves (CR 603.6a)", () => {
    it("reaches the stack through the real trigger scan and gains the life", () => {
        const state = boardWith([WARDEN_ID]);
        const before = getPlayer(state, "p1").life;
        createTokenPermanents(state, BEAR, "p1", 1);
        processPendingActionTriggers(state);
        expect(state.stack.map((s) => s.triggeredAbilityId)).toEqual([
            "test-2698-warden-trigger",
        ]);
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(before + 1);
    });

    it("does not fire on the source's OWN entry (scope another/any-other)", () => {
        // `any-other` is the whole difference between Essence Warden and a
        // card that gains life off itself; a scope collapsed to `any` passes
        // every other assertion in this file.
        const state = boardWith([]);
        createTokenPermanents(state, BEAR, "p1", 1);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(0);
    });
});

describe("the CR 603.4 intervening-if gates the trigger", () => {
    it("does not trigger while the condition is false", () => {
        const state = boardWith([CONDITIONAL_ID]);
        createTokenPermanents(state, BEAR, "p1", 1);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(0);
    });

    it("triggers once the controller's board satisfies it", () => {
        const state = boardWith([CONDITIONAL_ID]);
        createTokenPermanents(state, GOBLIN, "p1", 1);
        // The Goblin's own entry is itself a qualifying event, and the
        // condition is already true as the trigger is checked (CR 603.4 —
        // checked when the ability would trigger, with the entry resolved).
        processPendingActionTriggers(state);
        expect(state.stack.map((s) => s.triggeredAbilityId)).toEqual([
            "test-2698-conditional-trigger",
        ]);
    });
});
