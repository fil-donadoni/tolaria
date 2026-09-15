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
import type { GameState } from "../../state";
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

describe("positionFingerprint — live play and readers of an ignored tally (issue #3590 review)", () => {
    it("ignores the projection's save counter `seq` — every save bumps it, the position does not move", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const saved = { ...state, seq: 41 } as GameState;
        const resaved = { ...state, seq: 42 } as GameState;
        expect(positionFingerprint(resaved)).toBe(positionFingerprint(saved));
    });

    it("keeps the spell count while a storm card could read it (CR 702.40)", () => {
        const plain = buildPositionFromSpec(HARPY_POSITION);
        const plainLap = cloneGameState(plain);
        plainLap.spellsCastThisTurn = 1;
        plainLap.players[0].spellsCastThisTurn = 1;
        expect(positionFingerprint(plainLap)).toBe(positionFingerprint(plain));

        const storm = buildPositionFromSpec({
            ...HARPY_POSITION,
            cards: [
                ...HARPY_POSITION.cards,
                { name: "Brain Freeze", owner: "me", zone: "hand" },
            ],
        });
        const stormLap = cloneGameState(storm);
        stormLap.spellsCastThisTurn = 1;
        stormLap.players[0].spellsCastThisTurn = 1;
        expect(positionFingerprint(stormLap)).not.toBe(
            positionFingerprint(storm)
        );
    });
});

describe("recordRepetition / repeatedMoveKeys (issue #3590)", () => {
    it("remembers a move against the position it was chosen from", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const cast = harpyCast(state);
        const history = recordRepetition(
            undefined,
            state,
            state.players[0].id,
            cast
        );
        expect([
            ...repeatedMoveKeys(history, state, state.players[0].id),
        ]).toEqual([repetitionMoveKey(cast)]);
        // The search's own root key — the deny-set compares the two.
        expect(repetitionMoveKey(cast)).toBe(moveKey(cast));
    });

    it("never records pass — the floor is never denied", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const history = recordRepetition(
            undefined,
            state,
            state.players[0].id,
            { kind: "pass" }
        );
        expect(repeatedMoveKeys(history, state, state.players[0].id).size).toBe(
            0
        );
    });

    it("is scoped to one turn: a new turn starts an empty history", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const history = recordRepetition(
            undefined,
            state,
            state.players[0].id,
            harpyCast(state)
        );
        const later = cloneGameState(state);
        later.turn += 1;
        expect(repeatedMoveKeys(history, later, later.players[0].id).size).toBe(
            0
        );
        const next = recordRepetition(history, later, later.players[0].id, {
            kind: "pass",
        });
        expect(next.turn).toBe(later.turn);
        expect(Object.keys(next.chosen)).toEqual([]);
    });

    it("does not mutate the history it was given", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const empty = emptyRepetitionHistory();
        recordRepetition(empty, state, state.players[0].id, harpyCast(state));
        expect(empty.chosen).toEqual({});
    });
});

describe("no progress within one step (issue #3590)", () => {
    it("still denies when only the OPPONENT's side moved and the seat is no better off — a lap that tutors for them", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const me = state.players[0].id;
        const history = recordRepetition(
            undefined,
            state,
            me,
            harpyCast(state)
        );
        const lapped = cloneGameState(state);
        lapped.players[1].hand.push(lapped.players[1].library.pop()!);
        expect(positionFingerprint(lapped)).not.toBe(
            positionFingerprint(state)
        );
        expect(repeatedMoveKeys(history, lapped, me).size).toBe(1);
    });

    it("allows the move again once the lap made progress — the opponent lost life", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const me = state.players[0].id;
        const history = recordRepetition(
            undefined,
            state,
            me,
            harpyCast(state)
        );
        const drained = cloneGameState(state);
        drained.players[1].life -= 1;
        expect(repeatedMoveKeys(history, drained, me).size).toBe(0);
    });

    it("a different step is a different key — the same move in the next phase is not a repeat", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const me = state.players[0].id;
        const history = recordRepetition(
            undefined,
            state,
            me,
            harpyCast(state)
        );
        const later = cloneGameState(state);
        later.phase = "POSTCOMBAT_MAIN";
        expect(repeatedMoveKeys(history, later, me).size).toBe(0);
    });

    it("more spells is progress while a storm card could read them (CR 702.40), and only then", () => {
        const plain = buildPositionFromSpec(HARPY_POSITION);
        const me = plain.players[0].id;
        const plainHistory = recordRepetition(
            undefined,
            plain,
            me,
            harpyCast(plain)
        );
        const plainLap = cloneGameState(plain);
        plainLap.players[0].spellsCastThisTurn = 1;
        expect(repeatedMoveKeys(plainHistory, plainLap, me).size).toBe(1);

        const storm = buildPositionFromSpec({
            ...HARPY_POSITION,
            cards: [
                ...HARPY_POSITION.cards,
                { name: "Brain Freeze", owner: "me", zone: "hand" },
            ],
        });
        const stormHistory = recordRepetition(
            undefined,
            storm,
            me,
            harpyCast(storm)
        );
        const stormLap = cloneGameState(storm);
        stormLap.players[0].spellsCastThisTurn = 1;
        expect(repeatedMoveKeys(stormHistory, stormLap, me).size).toBe(0);
    });

    it("an improvement of the seat's own margin is progress", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const me = state.players[0].id;
        const history = recordRepetition(
            undefined,
            state,
            me,
            harpyCast(state)
        );
        const developed = cloneGameState(state);
        developed.players[0].life += 2;
        expect(repeatedMoveKeys(history, developed, me).size).toBe(0);
    });
});

describe("searchWithTrace with a decision history (issue #3590)", () => {
    it("denies the move already chosen at this position, leaving pass", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const history = recordRepetition(
            undefined,
            state,
            state.players[0].id,
            harpyCast(state)
        );
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
        // The seat's OWN side differs — the key is one side of the board.
        elsewhere.players[0].life -= 3;
        const history = recordRepetition(
            undefined,
            elsewhere,
            elsewhere.players[0].id,
            harpyCast(elsewhere)
        );
        expect(repeatedMoveKeys(history, state, state.players[0].id).size).toBe(
            0
        );
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
