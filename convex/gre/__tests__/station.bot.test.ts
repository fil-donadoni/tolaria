// Bot reachability for Station (CR 702.184a, issue #10528) — the three seams a
// new mechanic owes (`.claude/rules/gre-development.md` § Bot reachability):
//
//   1. REACHABLE?  `enumerateMoves` offers the station activation, tapping
//      another creature (never the station permanent itself; the planner
//      names its cheapest fodder), and only at CR 307.5 sorcery timing.
//   2. ANSWERABLE?  The only choice is the tapped creature, which rides the
//      move (`costPicks.tapOtherIds`); no target, no mode.
//   3. WANTED?  The `counters` valuer scores the script above zero.
//
// Plus the search path: applying the enumerated move in the tree records the
// tapped creature on the pushed item, so it resolves for the creature's power
// exactly as live play does (`applyActivationCostsForSearch`).

import { describe, expect, it } from "vitest";
import type { GameState } from "../state";
import { resolveTopOfStack } from "../state";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveInSearch } from "../search";
import { dslAbilityScriptValue } from "../ai/cardScriptValue";
import { getDefinition } from "../../cards";
import {
    CHARGE_COUNTER,
    STATION_ABILITY_ID,
} from "../../cards/abilities/station";
import {
    BEAR_ID,
    OX_ID,
    SPACECRAFT_ID,
} from "../../cards/__tests__/station.helper";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(SPACECRAFT_ID, {
                        id: "ship",
                        controllerId: "p1",
                        ownerId: "p1",
                        staticSeq: 1,
                    }),
                    makeInstance(BEAR_ID, {
                        id: "bear",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(OX_ID, {
                        id: "ox",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

function stationMoves(state: GameState) {
    return enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" && m.abilityId === STATION_ABILITY_ID
    );
}

describe("Station — Bot reachability (CR 702.184a)", () => {
    it("enumerates the station activation, tapping another creature", () => {
        const moves = stationMoves(board());
        expect(moves.length).toBeGreaterThan(0);
        const tapped = moves.flatMap((m) => m.costPicks?.tapOtherIds ?? []);
        expect(tapped.length).toBeGreaterThan(0);
        expect(tapped).not.toContain("ship");
        for (const m of moves) expect(m.targets).toEqual([]);
    });

    it("does not enumerate it outside sorcery timing (CR 307.5)", () => {
        const state = board();
        state.phase = "BEGIN_COMBAT";
        expect(stationMoves(state)).toEqual([]);
    });

    it("values the script above zero (the `counters` valuer)", () => {
        expect(
            dslAbilityScriptValue(getDefinition(SPACECRAFT_ID))
        ).toBeGreaterThan(0);
    });

    it("the search path resolves for the tapped creature's power", () => {
        const state = board();
        const move = stationMoves(state).find((m) =>
            (m.costPicks?.tapOtherIds ?? []).includes("bear")
        );
        expect(move).toBeDefined();
        applyMoveInSearch(state, "p1", move!);
        expect(state.stack.at(-1)?.costTapped?.id).toBe("bear");
        resolveTopOfStack(state);
        const ship = state.players[0].battlefield.find((c) => c.id === "ship")!;
        expect(ship.counters?.[CHARGE_COUNTER]).toBe(2);
    });
});
