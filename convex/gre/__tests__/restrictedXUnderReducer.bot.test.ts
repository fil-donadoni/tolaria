// The Bot and a colour-restricted {X} under a generic reduction (CR 107.4b /
// 601.2f): it reaches the reduced X, and the shared pick answers the split park.
// The wire-boundary answer lives in `src/lib/ai/__tests__/owed-payment.bot.test.ts`.

import { describe, it, expect } from "vitest";
import { stoneCalendar } from "../../cards/sets/drk/colorless.cards";
import { soulBurn } from "../../cards/sets/ice/black.cards";
import { drainLife } from "../../cards/sets/lea/black.cards";
import { swamp } from "../../cards/sets/lea/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { enumerateMoves } from "../moves";
import { nextOwedPayment } from "../owedPayment";
import { pickForOwedPayment } from "../paymentPicks";
import type { GameState } from "../state";
import { getPlayer } from "../state";

const POOL0 = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

function board(spellId: string, swamps: number): GameState {
    const own = {
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield" as const,
    };
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(spellId, {
                        id: "spell",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    makeInstance(stoneCalendar().id, { ...own, id: "cal-0" }),
                    makeInstance(stoneCalendar().id, { ...own, id: "cal-1" }),
                    ...Array.from({ length: swamps }, (_, i) =>
                        makeInstance(swamp().id, { ...own, id: `swamp-${i}` })
                    ),
                ],
                manaPool: { ...POOL0 },
            }),
            makePlayer("p2"),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function parkedSplit(): GameState {
    const state = board(soulBurn().id, 0);
    getPlayer(state, "p1").manaPool.B = 4;
    state.pendingCast = {
        playerId: "p1",
        cardInstanceId: "spell",
        manaCost: { B: 1, "X/B/R": 1, X: 2 },
        tappedLandIds: [],
        keepPriority: false,
        chosenX: 3,
        restrictedXSplitChoice: { options: [0, 1, 2] },
    };
    return state;
}

describe("the Bot under a reducer (CR 107.4b / 601.2f)", () => {
    it("enumerates Drain Life up to the reduced X, with a tap plan, and no higher", () => {
        const moves = enumerateMoves(board(drainLife().id, 2), "p1").filter(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "spell"
        );
        const xs = new Set(
            moves.map((m) => (m as { chosenX?: number }).chosenX)
        );
        expect(xs.has(2)).toBe(true);
        expect(xs.has(3)).toBe(false);
    });

    it("the shared pick answers the split X first", () => {
        const state = parkedSplit();
        const owed = nextOwedPayment(state, "p1");
        expect(owed?.kind).toBe("cast:restrictedXSplitChoice");
        expect(pickForOwedPayment(state, "p1", owed!)).toEqual({
            mutation: "selectRestrictedXSplit",
            pointsOnX: 0,
        });
    });
});
