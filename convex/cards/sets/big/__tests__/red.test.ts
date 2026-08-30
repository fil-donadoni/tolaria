// BIG — red card behavior tests (ADR 0043 colour split).
//
// Generous Plunderer's upkeep ability (`mayPay` gating a `createToken` +
// `reflexiveTrigger` combo, CR 603.12) is an explicit SKIP in the catalogue-
// wide DSL smoke sweep (`effectScriptSmoke.test.ts`: 'Op "mayPay" suspends
// for a Pay/Skip decision — covered by the card's own suspension/resume
// tests') because a live Pay/Skip decision can't be driven by a canned
// scenario. This file is that hand-written coverage: it drives the real
// suspend/resume pipeline (`applyMayPaySubmit`), asserting BOTH created
// Treasures — the controller's own (untapped) and the targeted opponent's
// (entered TAPPED, CR 508.4) — exist with the right controller and tap
// state. Unlike Minsc & Boo's −2 reflexive trigger
// (`clb/__tests__/multicolor.test.ts`), whose "any target" requirement has
// many legal targets and so suspends on a real `pendingTarget` choice, this
// card's `{ type: "player", controller: "opponent" }` requirement has
// exactly ONE legal target in a 2-player game — the engine auto-selects it
// (no real decision to offer), so the reflexive trigger is already targeted
// by the time it lands on the stack; a plain `resolveTopOfStack` resolves it.
import { describe, it, expect } from "vitest";
import { generousPlunderer } from "../red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    resolveTopOfStack,
} from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";

const PLUNDERER_ID = generousPlunderer.id;
const UPKEEP_ABILITY_ID = "generous-plunderer-upkeep-treasure";

/** Generous Plunderer on p1's battlefield, p2 with nothing. */
function boardWithPlunderer(): {
    state: GameState;
    plunderer: ReturnType<typeof makeInstance>;
} {
    const plunderer = makeInstance(PLUNDERER_ID, {
        id: "plunderer",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [plunderer] }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
    });
    return { state, plunderer: state.players[0].battlefield[0] };
}

/** Pushes the upkeep triggered ability directly onto the stack (the
 *  `clu/red.ts` test convention — exercises the ability's `effects[]` body,
 *  not the generic `matches()` trigger-scan machinery already covered
 *  elsewhere). */
function pushUpkeepTrigger(
    state: GameState,
    plunderer: CardInstanceState
): void {
    state.stack.push({
        ...plunderer,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: UPKEEP_ABILITY_ID,
        triggerSourceId: plunderer.id,
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        },
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Generous Plunderer — upkeep Treasure (CR 603.12 reflexive trigger)", () => {
    it("accepting creates the controller's Treasure, then a reflexive ability gives the targeted opponent a TAPPED Treasure", () => {
        const { state, plunderer } = boardWithPlunderer();
        pushUpkeepTrigger(state, plunderer);

        // Bare cost-free "you may" (issue #680) suspends on a may-pay decision.
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        // p1's own Treasure is created immediately, untapped.
        const ownTreasure = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes.includes("Treasure")
        );
        expect(ownTreasure).toBeDefined();
        expect(ownTreasure!.isTapped).toBe(false);

        // The reflexive ability is now its own object on the stack
        // (CR 603.12/603.3d), auto-targeting the sole legal opponent — a
        // 2-player game has no real "which opponent" decision to offer.
        const reflexive = state.stack.find((s) => s.reflexiveTrigger);
        expect(reflexive).toBeDefined();
        expect(reflexive!.targets).toEqual([{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);

        // The targeted opponent's Treasure enters TAPPED (CR 508.4).
        const opponentTreasure = state.players[1].battlefield.find(
            (c) => c.isToken && c.subtypes.includes("Treasure")
        );
        expect(opponentTreasure).toBeDefined();
        expect(opponentTreasure!.isTapped).toBe(true);
    });

    it("declining the may-pay creates no Treasure and no reflexive trigger", () => {
        const { state, plunderer } = boardWithPlunderer();
        pushUpkeepTrigger(state, plunderer);
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        expect(state.players[0].battlefield.some((c) => c.isToken)).toBe(false);
        expect(state.players[1].battlefield.some((c) => c.isToken)).toBe(false);
        expect(state.stack.some((s) => s.reflexiveTrigger)).toBe(false);
    });
});
