// CR 702.66 / 601.2g (issue #1336, parent PRD #702, ADR 0063) — the bot's
// resolution of the parked graveyard-exile CAST cost that delve introduces.
//
// Without this the bot stalls exactly the way the mana-spend park (#1446) and
// the attack-tax park (CR 508.1c/1g) once did: `pendingCast` blocks
// `passPriority`, the picker lives OUTSIDE `pendingChoices[]` so no Worker
// search surfaces a move for it, and `enumerateMoves` returns [] while a
// pendingCast is live. The fix is a compile-time-exhaustive `BotAction` kind
// (`cast-exile-cost`) with its own `botActionRealisation` branch and a direct
// `selectCastExileCost` mutation in the driver.
//
// Deterministic single-scenario tests (project convention: single preset
// scenarios + deterministic unit assertions, never self-play), driven through
// the REAL wire boundary (`projectPublicState` → `buildBotView` →
// `decideBotAction`).

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { enumerateMoves } from "@convex/gre/moves";
import type { PendingCast } from "@convex/gre/state";
import {
    botActionRealisation,
    chooseCastExileCost,
    decideBotAction,
} from "../brain";
import { buildBotView } from "../bot-view";

const BOT = "u1-p2";
const HUMAN = "u1-p1";

const TREASURE_CRUISE = getCardByName("Treasure Cruise").id; // {7}{U}, delve
const ISLAND = getCardByName("Island").id;
const MOUNTAIN = getCardByName("Mountain").id;

/** `n` cards in the bot's graveyard as delve fuel. */
function fuel(n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(MOUNTAIN, {
            id: `gy${i}`,
            controllerId: BOT,
            ownerId: BOT,
            zone: "graveyard",
        })
    );
}

function baseState(lands: number, gyCount: number, pendingCast?: PendingCast) {
    const cruise = makeInstance(TREASURE_CRUISE, {
        id: "cruise",
        controllerId: BOT,
        ownerId: BOT,
        zone: "hand",
    });
    const bot = makePlayer(BOT, {
        hand: [cruise],
        graveyard: fuel(gyCount),
        battlefield: Array.from({ length: lands }, (_, i) =>
            makeInstance(ISLAND, { id: `isle${i}`, controllerId: BOT })
        ),
    });
    return makeState({
        players: [makePlayer(HUMAN), bot],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        phase: "PRECOMBAT_MAIN",
        ...(pendingCast ? { pendingCast } : {}),
    });
}

/** The bot's own delve cast parked on the picker, mirroring what `announceCast`
 *  builds off a two-land board with seven graveyard cards. */
function parkedDelveCast(offset: { min: number; max: number }) {
    return baseState(2, 7, {
        playerId: BOT,
        cardInstanceId: "cruise",
        manaCost: { X: 7, U: 1 },
        tappedLandIds: [],
        exileFromGraveyardChoice: {
            count: 0,
            excludeInstanceId: "cruise",
            offsetGeneric: offset,
        },
    });
}

describe("bot dispatch for the delve cast cost (CR 702.66)", () => {
    it("classifies the new kind as its own direct-mutation realisation", () => {
        // Compile-time exhaustiveness is enforced by `assertNever`; this pins
        // the runtime classification the driver branches on.
        expect(botActionRealisation("cast-exile-cost")).toBe("cast-exile-cost");
    });

    it("decides a legal exile pick instead of stalling on the parked cast", () => {
        const state = parkedDelveCast({ min: 4, max: 7 });
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);

        expect(view.castExileChoice).toEqual({
            candidateIds: ["gy0", "gy1", "gy2", "gy3", "gy4", "gy5", "gy6"],
            required: 4,
            maximum: 7,
        });

        const action = decideBotAction(view);
        expect(action.kind).toBe("cast-exile-cost");
        expect(
            action.kind === "cast-exile-cost" ? action.cardInstanceIds : []
        ).toEqual(["gy0", "gy1", "gy2", "gy3"]);
        // Not `none` / `pass` — a stall would show up as either of those, and
        // the Worker cannot help (enumerateMoves is empty while a cast parks).
        expect(enumerateMoves(state, BOT)).toEqual([]);
    });

    it("exiles NOTHING when delving is optional — mana already covers the cost", () => {
        const state = parkedDelveCast({ min: 0, max: 7 });
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        const action = decideBotAction(view);
        expect(action).toEqual({ kind: "cast-exile-cost", cardInstanceIds: [] });
    });

    it("never emits more picks than the graveyard holds", () => {
        expect(
            chooseCastExileCost({
                candidateIds: ["a", "b"],
                required: 5,
                maximum: 9,
            })
        ).toEqual(["a", "b"]);
    });

    it("stays quiet when the parked cast belongs to the OPPONENT", () => {
        const state = parkedDelveCast({ min: 4, max: 7 });
        state.pendingCast!.playerId = HUMAN;
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.castExileChoice).toBeUndefined();
    });

    it("stays quiet once the pick is already recorded", () => {
        const state = parkedDelveCast({ min: 4, max: 7 });
        state.pendingCast!.exileFromGraveyardChoice!.pickedCardIds = ["gy0"];
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.castExileChoice).toBeUndefined();
    });
});

describe("bot cast enumeration with delve (CR 601.2g probe)", () => {
    it("offers Treasure Cruise off a SHORT board when the graveyard can pay", () => {
        const state = baseState(2, 7);
        const moves = enumerateMoves(state, BOT);
        const cast = moves.find(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "cruise"
        );
        expect(cast).toBeDefined();
        // The tap plan covers ONLY what delve does not: {U} + the one generic
        // the second Island can pay, i.e. both lands, never more.
        expect(
            cast && cast.kind === "cast-spell" ? cast.tapPlan.length : -1
        ).toBe(2);
    });

    it("does NOT offer it when neither mana nor graveyard can close the gap", () => {
        const state = baseState(2, 3);
        const moves = enumerateMoves(state, BOT);
        expect(
            moves.some(
                (m) => m.kind === "cast-spell" && m.cardInstanceId === "cruise"
            )
        ).toBe(false);
    });
});
