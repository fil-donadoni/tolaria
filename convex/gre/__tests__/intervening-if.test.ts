// Engine-level tests for CR 603.4d "intervening if". `resolveTopOfStack`
// re-evaluates `TriggeredAbility.interveningIf` against the current game
// state immediately before invoking `resolve`. If the predicate is false
// the trigger fizzles: it leaves the stack without invoking `resolve`,
// and a `TRIGGER_FIZZLED` event is queued so downstream triggers can
// react. The two required tests cover the false (fizzle) and true
// (resolves normally) branches; a third test covers the downstream
// reaction path via a witness trigger keyed on `TRIGGER_FIZZLED`.

import { describe, it, expect, beforeAll } from "vitest";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "../state";
import { resolveTopOfStack } from "../state";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition, GameEvent } from "../../cards/types";

const SOURCE_CARD_ID = "test-intervening-if-card";
const ABILITY_ID = "test-trigger";
const WITNESS_ID = "test-witness";

// Synthetic card whose trigger fizzles when its source is tapped at
// resolution. Mirrors Howling Mine's pattern but uses the engine-level
// `interveningIf` hook instead of an ad-hoc re-check inside `resolve`.
// The witness ability listens for TRIGGER_FIZZLED so the downstream-
// observability contract is exercised.
const testCard: CardDefinition = {
    id: SOURCE_CARD_ID,
    name: "Test Intervening-If Source",
    rarity: "common",
    types: ["Artifact"],
    triggeredAbilities: [
        {
            id: ABILITY_ID,
            oracleText:
                "At the beginning of the end step, if this is untapped, controller draws a card.",
            event: "PHASE_BEGIN",
            matches: (event) => event.type === "PHASE_BEGIN",
            interveningIf: (_event, self) => !self.isTapped,
            resolve: (ctx) => ctx.drawCards(ctx.controller, 1),
        },
        {
            id: WITNESS_ID,
            oracleText:
                "Whenever a trigger fizzles, this source's controller gains 1 life.",
            event: "TRIGGER_FIZZLED",
            matches: (event) => event.type === "TRIGGER_FIZZLED",
            resolve: (ctx) => ctx.gainLife(ctx.controller, 1),
        },
    ],
};

beforeAll(() => {
    registerTokenDefinition(testCard);
});

function makeBareCard(
    id: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: SOURCE_CARD_ID },
        types: ["Artifact"],
        subtypes: [],
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

function makeBarePlayer(id: string, library: CardInstanceState[]): PlayerState {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library,
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

/** Seeds a game with one battlefield source on p1 and a phase-begin trigger
 *  already pushed onto the stack via `triggeredAbilityId` / `triggerSourceId`
 *  / `triggerEvent`. `sourceTapped` controls whether the source is tapped at
 *  resolution time — the only variable the intervening-if predicate reads. */
function setupState(opts: { sourceTapped: boolean }): GameState {
    const source = makeBareCard("src-1", { isTapped: opts.sourceTapped });
    const libraryCard: CardInstanceState = {
        id: "lib-1",
        card: { id: SOURCE_CARD_ID },
        types: ["Artifact"],
        subtypes: [],
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
        isTapped: false,
    };
    const event: GameEvent = {
        type: "PHASE_BEGIN",
        phase: "END_STEP",
        activePlayerId: "p1",
    };
    const stackItem: StackItem = {
        ...source,
        zone: "stack",
        id: "stack-1",
        castById: "p1",
        triggeredAbilityId: ABILITY_ID,
        triggerSourceId: source.id,
        triggerEvent: event,
    };
    const p1 = makeBarePlayer("p1", [libraryCard]);
    p1.battlefield = [source];
    const p2 = makeBarePlayer("p2", []);
    return {
        players: [p1, p2],
        stack: [stackItem],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "END_STEP",
        rngSeed: 0,
        rngCounter: 0,
    };
}

describe("intervening-if (CR 603.4d)", () => {
    it("fizzles the trigger when the predicate is false at resolve time", () => {
        const state = setupState({ sourceTapped: true });
        resolveTopOfStack(state);
        // The fizzling trigger left the stack without invoking `resolve`
        // (no card drawn). The witness trigger fired on TRIGGER_FIZZLED and
        // landed on the stack, restarting priority at the active player.
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(WITNESS_ID);
        expect(state.stack[0].triggerEvent).toMatchObject({
            type: "TRIGGER_FIZZLED",
            triggerSourceId: "src-1",
            triggeredAbilityId: ABILITY_ID,
            reason: "intervening-if-false",
        });
    });

    it("resolves the trigger normally when the predicate is true at resolve time", () => {
        const state = setupState({ sourceTapped: false });
        resolveTopOfStack(state);
        // Trigger resolved: one card moved library → hand. No fizzle event
        // emitted, so the witness is not on the stack.
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("emits TRIGGER_FIZZLED into pendingEvents so witness triggers can react", () => {
        const state = setupState({ sourceTapped: true });
        resolveTopOfStack(state);
        // Resolve the witness trigger that the fizzle emission produced.
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21);
        expect(state.stack).toHaveLength(0);
    });
});
