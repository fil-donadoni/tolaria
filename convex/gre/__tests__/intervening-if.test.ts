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

const WASKICKED_SOURCE_ID = "test-intervening-if-waskicked-card";
const WASKICKED_ABILITY_ID = "test-trigger-waskicked";

// Synthetic card exercising the resolve-time `selfView` allowlist
// (`gre/state.ts`, CR 603.4d) for the `wasKicked` field specifically (issue
// #1753 added `wasKicked`/`chosenXOnCast` to that hand-built allowlist
// alongside the pre-existing combat-history fields). No shipped card reads
// `self.wasKicked` from an `interveningIf` today — `pouncingKavu` and its
// siblings read it only from `staticEffects.applies`, a different read path
// — so without this test the allowlist line has zero coverage: it always
// EXECUTES (any interveningIf trigger walks the whole object literal), but
// nothing ever proves the copied VALUE is the real one instead of a silently
// dropped `undefined`.
const wasKickedTestCard: CardDefinition = {
    id: WASKICKED_SOURCE_ID,
    name: "Test Intervening-If wasKicked Source",
    rarity: "common",
    types: ["Artifact"],
    triggeredAbilities: [
        {
            id: WASKICKED_ABILITY_ID,
            oracleText:
                "At the beginning of the end step, if this was kicked, controller draws a card.",
            event: "PHASE_BEGIN",
            matches: (event) => event.type === "PHASE_BEGIN",
            interveningIf: (_event, self) => self.wasKicked === true,
            resolve: (ctx) => ctx.drawCards(ctx.controller, 1),
        },
    ],
};

beforeAll(() => {
    registerTokenDefinition(testCard);
    registerTokenDefinition(wasKickedTestCard);
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

/** Seeds a game with one battlefield source on p1 and a phase-begin trigger
 *  already pushed onto the stack, exactly like `setupState` above, except the
 *  source's `wasKicked` field (not `isTapped`) is the variable the
 *  intervening-if predicate reads. */
function setupWasKickedState(opts: { wasKicked: boolean }): GameState {
    const source = makeBareCard("wk-src-1", {
        card: { id: WASKICKED_SOURCE_ID },
        wasKicked: opts.wasKicked || undefined,
    });
    const libraryCard: CardInstanceState = {
        id: "wk-lib-1",
        card: { id: WASKICKED_SOURCE_ID },
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
        id: "wk-stack-1",
        castById: "p1",
        triggeredAbilityId: WASKICKED_ABILITY_ID,
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

// Issue #1753 review finding 3 — `wasKicked` (alongside `chosenXOnCast`) was
// added to the resolve-time `selfView` allowlist at `gre/state.ts:4331-4332`,
// a behaviour change to trigger machinery shared by every kicker card, with
// zero coverage: no shipped card reads `self.wasKicked` from an
// `interveningIf` (only from `staticEffects.applies`, a different read path
// entirely). These two prove the allowlist actually threads the real value
// through — dropping the `wasKicked: sourceCard.wasKicked` line from the
// allowlist would make the "kicked" case below fizzle exactly like the
// "not kicked" case, since both would read `undefined`.
describe("intervening-if allowlist — wasKicked (issue #1753, CR 603.4d / 614.1c)", () => {
    it("fizzles when wasKicked is unset at resolve time", () => {
        const state = setupWasKickedState({ wasKicked: false });
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("resolves normally, reading the real wasKicked value through the selfView allowlist", () => {
        const state = setupWasKickedState({ wasKicked: true });
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });
});
