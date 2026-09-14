// Position repetition — the Bot's decision history (issue #3590).
//
// CR 104.4b: a loop of MANDATORY actions is a draw; "Loops that contain an
// optional action don't result in a draw." CR 732.5 obliges nobody to stop an
// optional one, so the Bot has to. `repetition.ts` fingerprints a position and
// remembers what the seat chose there; `searchWithTrace` denies those moves the
// next time the seat stands in the same position.

import { describe, expect, it } from "vitest";
import {
    emptyRepetitionHistory,
    positionFingerprint,
    recordRepetition,
    repeatedMoveKeys,
    repetitionMoveKey,
} from "../repetition";
import { buildPositionFromSpec } from "../blade/build";
import { enumerateMoves } from "../../moves";
import { moveKey, searchWithTrace } from "../../search";
import { cloneGameState } from "../../clone";
import type { Move } from "../../moves";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

const HARPY_POSITION: ScenarioSpec = {
    cards: [
        { name: "Aluren", owner: "me", zone: "battlefield" },
        { name: "Cavern Harpy", owner: "me", zone: "hand" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        { name: "Plains", owner: "opp", zone: "battlefield" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 6,
    landCount: 0,
    libraryCount: 20,
};

function harpyCast(state: ReturnType<typeof buildPositionFromSpec>): Move {
    const cast = enumerateMoves(state, state.players[0].id).find(
        (m) => m.kind === "cast-spell"
    );
    expect(cast).toBeDefined();
    return cast!;
}

describe("positionFingerprint (issue #3590)", () => {
    it("is the same for a clone", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        expect(positionFingerprint(cloneGameState(state))).toBe(
            positionFingerprint(state)
        );
    });

    it("ignores battlefield ORDER — a permanent that left and returned is appended at the end (CR 403.1)", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const moved = cloneGameState(state);
        moved.players[1].battlefield.reverse();
        expect(moved.players[1].battlefield.length).toBe(2);
        expect(positionFingerprint(moved)).toBe(positionFingerprint(state));
    });

    it("ignores bookkeeping a loop lap bumps: allocator cursors and per-turn tallies", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const lapped = cloneGameState(state);
        lapped.nextInstanceId = (lapped.nextInstanceId ?? 0) + 7;
        lapped.spellsCastThisTurn = 3;
        lapped.players[0].spellsCastThisTurn = 3;
        lapped.players[0].spellsCastThisGame = 3;
        expect(positionFingerprint(lapped)).toBe(positionFingerprint(state));
    });

    it("sees real progress: a counter, a life point, a card changing zone", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const base = positionFingerprint(state);

        const countered = cloneGameState(state);
        countered.players[1].battlefield[0].counters = { "+1/+1": 1 };
        expect(positionFingerprint(countered)).not.toBe(base);

        const hurt = cloneGameState(state);
        hurt.players[1].life -= 1;
        expect(positionFingerprint(hurt)).not.toBe(base);

        const drawn = cloneGameState(state);
        drawn.players[0].hand.push(drawn.players[0].library.pop()!);
        expect(positionFingerprint(drawn)).not.toBe(base);
    });

    it("keeps who holds priority and the banked passes — a pass means something else with one banked", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const banked = cloneGameState(state);
        banked.passCount = (banked.passCount ?? 0) + 1;
        expect(positionFingerprint(banked)).not.toBe(
            positionFingerprint(state)
        );
    });
});

describe("recordRepetition / repeatedMoveKeys (issue #3590)", () => {
    it("remembers a move against the position it was chosen from", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const cast = harpyCast(state);
        const history = recordRepetition(undefined, state, cast);
        expect([...repeatedMoveKeys(history, state)]).toEqual([
            repetitionMoveKey(cast),
        ]);
        // The search's own root key — the deny-set compares the two.
        expect(repetitionMoveKey(cast)).toBe(moveKey(cast));
    });

    it("never records pass — the floor is never denied", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const history = recordRepetition(undefined, state, { kind: "pass" });
        expect(repeatedMoveKeys(history, state).size).toBe(0);
    });

    it("is scoped to one turn: a new turn starts an empty history", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const history = recordRepetition(undefined, state, harpyCast(state));
        const later = cloneGameState(state);
        later.turn += 1;
        expect(repeatedMoveKeys(history, later).size).toBe(0);
        const next = recordRepetition(history, later, { kind: "pass" });
        expect(next.turn).toBe(later.turn);
        expect(Object.keys(next.chosen)).toEqual([]);
    });

    it("does not mutate the history it was given", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const empty = emptyRepetitionHistory();
        recordRepetition(empty, state, harpyCast(state));
        expect(empty.chosen).toEqual({});
    });
});

describe("searchWithTrace with a decision history (issue #3590)", () => {
    it("denies the move already chosen at this position, leaving pass", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const history = recordRepetition(undefined, state, harpyCast(state));
        const { move } = searchWithTrace(
            state,
            state.players[0].id,
            { iterations: 30 },
            0xb1ade,
            undefined,
            history
        );
        expect(move).toEqual({ kind: "pass" });
    });

    it("denies nothing at a position the seat has not occupied", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const elsewhere = cloneGameState(state);
        elsewhere.players[1].life -= 3;
        const history = recordRepetition(
            undefined,
            elsewhere,
            harpyCast(elsewhere)
        );
        expect(repeatedMoveKeys(history, state).size).toBe(0);
        // Byte-identical to a search with no history at all.
        const a = searchWithTrace(
            state,
            state.players[0].id,
            { iterations: 30 },
            7,
            undefined,
            history
        ).move;
        const b = searchWithTrace(
            state,
            state.players[0].id,
            { iterations: 30 },
            7
        ).move;
        expect(a).toEqual(b);
    });
});
