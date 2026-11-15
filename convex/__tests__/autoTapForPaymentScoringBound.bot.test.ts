// Full-path regression for the cost of Smart Auto-Tap's plan scoring (issue
// #9812): the REGISTERED `autoTapForPayment` handler over the stub
// `MutationCtx`, on the production board that failed with an opaque
// `Server Error` — seven any-colour lands paying {3}{W}{W}.
//
//   601.2g  If the total cost includes a mana payment, the player then has a
//           chance to activate mana abilities … before costs are paid.
//   605.1a  An activated ability is a mana ability if … it could add mana to
//           a player's mana pool when it resolves …
//
// The solver used to enumerate every land subset × mana-option assignment, so
// five-option lands reached the 512-plan cap and each plan paid a full
// `structuredClone` + `evaluate()` in `scoreAutoTapPlanPosition` — past the
// mutation's time limit. The bound asserted here is the deterministic count of
// those scorer calls, never wall-clock (that lives in `autoTap.perf.test.ts`).

import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { autoTapForPayment } from "../game";
import type { Id } from "../_generated/dataModel";
import { buildAutoTapSources } from "../gre/autoTap";
import * as evaluateModule from "../gre/evaluate";
import { manaGateBattlefields } from "../gre/constants";
import type { CardInstanceState, GameState } from "../gre/state";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const GEMSTONE_MINE = "09507f7f-c58f-4f57-b878-b39811a5b619";
const CITY_OF_BRASS = "f4e32327-380d-471e-813b-4c27477787ce";
const LLANOWAR_WASTES = "610b7cd5-5532-45a9-acfe-24a818034d1c";
const REFLECTING_POOL = "7b633ac2-bf98-42bd-8c26-8737a7d8edc7";
const KARMIC_GUIDE = "77d23045-905b-44cb-9af9-cc6ad717477d"; // {3}{W}{W}
const PLAINS = "b1623d57-4729-4796-b3f7-f1837a05c6ed";

const LAND_IDS = [
    "mine-1",
    "mine-3",
    "city-a",
    "city-b",
    "wastes-a",
    "wastes-b",
    "pool",
];

function card(
    def: string,
    id: string,
    owner: string,
    zone: CardInstanceState["zone"],
    extra: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(def, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone,
        ...extra,
    });
}

/** Forty-card library / a few graveyard cards: the clone the scorer used to
 *  pay per plan is the whole state, so the zones are part of the repro. */
function filler(owner: string, zone: "library" | "graveyard", n: number) {
    return Array.from({ length: n }, (_, i) =>
        card(PLAINS, `${owner}-${zone}-${i}`, owner, zone)
    );
}

/** Turn 16, P1's precombat main, empty stack: Karmic Guide parked as a
 *  pending cast over the reported seven untapped lands. */
function reportedBoard(): GameState {
    const battlefield = [
        card(GEMSTONE_MINE, "mine-1", "p1", "battlefield", {
            counters: { mining: 1 },
        }),
        card(GEMSTONE_MINE, "mine-3", "p1", "battlefield", {
            counters: { mining: 3 },
        }),
        card(CITY_OF_BRASS, "city-a", "p1", "battlefield"),
        card(CITY_OF_BRASS, "city-b", "p1", "battlefield"),
        card(LLANOWAR_WASTES, "wastes-a", "p1", "battlefield"),
        card(LLANOWAR_WASTES, "wastes-b", "p1", "battlefield"),
        card(REFLECTING_POOL, "pool", "p1", "battlefield"),
    ];
    return makeState({
        turn: 16,
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [card(KARMIC_GUIDE, "guide", "p1", "hand")],
                battlefield,
                library: filler("p1", "library", 40),
                graveyard: filler("p1", "graveyard", 6),
            }),
            makePlayer("p2", {
                library: filler("p2", "library", 40),
                graveyard: filler("p2", "graveyard", 6),
            }),
        ],
        pendingCast: {
            playerId: "p1",
            cardInstanceId: "guide",
            manaCost: { W: 2, X: 3 },
            tappedLandIds: [],
        },
    });
}

describe("autoTapForPayment on a five-colour land board (CR 601.2g, issue #9812)", () => {
    it("the board is the reported one: seven any-colour sources", () => {
        const state = reportedBoard();
        const sources = buildAutoTapSources(
            state.players[0].battlefield,
            manaGateBattlefields(state)
        );
        expect(sources.map((s) => s.cardId).sort()).toEqual(
            [...LAND_IDS].sort()
        );
        // The explosion needs many options per source, not many sources.
        expect(
            sources.filter((s) => s.options.length >= 2).length
        ).toBeGreaterThanOrEqual(5);
    });

    it("commits Karmic Guide with a five-land plan, scoring each land set once", async () => {
        const h = makeMutationCtx("p1", [gameStateSeed(reportedBoard(), 1)]);
        const scorer = vi.spyOn(evaluateModule, "evaluateAutoTapPosition");
        onTestFinished(() => scorer.mockRestore());
        await runMutation<{ gameId: Id<"games">; playerId: string }, unknown>(
            autoTapForPayment as unknown as Handler<never, never>,
            h.ctx,
            { gameId: GAME_ID, playerId: "p1" }
        );
        const after = h.state();
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((item) => item.id)).toContain("guide");
        // Five lands paid: tapped, or gone (the Gemstone Mine whose last
        // mining counter paid is sacrificed).
        const stillUntapped = after.players[0].battlefield.filter(
            (c) => LAND_IDS.includes(c.id) && !c.isTapped
        );
        expect(stillUntapped).toHaveLength(LAND_IDS.length - 5);
        // At most one score per 5-of-7 land set (C(7,5) = 21): every plan
        // that taps the same lands and leaves the same pool scores the same.
        // The unbounded solver scored the 512-plan cap.
        expect(scorer.mock.calls.length).toBeGreaterThan(0);
        expect(scorer.mock.calls.length).toBeLessThanOrEqual(21);
    });
});
