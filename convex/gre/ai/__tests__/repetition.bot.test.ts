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
    isLoopExit,
    positionFingerprint,
    recordRepetition,
    repeatedMoveKeys,
    repetitionKeyAt,
    repetitionMoveKey,
} from "../repetition";
import { buildPositionFromSpec } from "../blade/build";
import { enumerateMoves } from "../../moves";
import { moveKey, searchWithTrace } from "../../search";
import { cloneGameState } from "../../clone";
import type { Move } from "../../moves";
import { resolveTopOfStack, type GameState } from "../../state";
import { applyMayPaySubmit } from "../../pendingChoiceSubmit";
import { finalizeTargetSelection } from "../../../game";
import { getCardByName, preloadDefinitions } from "../../../cards";
import { chainOfSmog } from "../../../cards/sets/ons/black.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../../cards/types";
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

/** A gravestorm spell the test registers itself, so the position needs nothing
 *  from the packed catalogue. */
const GRAVESTORM_CARD = {
    id: "synthetic-repetition-gravestorm",
    name: "Synthetic Repetition Gravestorm",
    rarity: "rare",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    subtypes: [],
    staticAbilities: ["gravestorm"],
} as CardDefinition;
preloadDefinitions([GRAVESTORM_CARD]);

function harpyPositionHoldingGravestorm(): GameState {
    const state = buildPositionFromSpec(HARPY_POSITION);
    const me = state.players[0];
    me.hand.push(
        makeInstance(GRAVESTORM_CARD.id, {
            id: "gravestorm-in-hand",
            controllerId: me.id,
            ownerId: me.id,
            zone: "hand",
            staticAbilities: GRAVESTORM_CARD.staticAbilities,
        })
    );
    return state;
}

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

    it("ignores a stack spell's cast-time tally — a display copy of the spell count (CR 702.40a)", () => {
        const state = buildPositionFromSpec(HARPY_POSITION);
        const bolt = pushSpell(
            state,
            getCardByName("Lightning Bolt").id,
            "p1",
            [{ type: "player", id: "p2" }]
        );
        const lapped = cloneGameState(state);
        lapped.stack.find((item) => item.id === bolt.id)!.spellsCastBefore = 4;
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

    it("keeps the graveyard tally while a gravestorm card could read it (CR 702.69)", () => {
        const plain = buildPositionFromSpec(HARPY_POSITION);
        const plainLap = cloneGameState(plain);
        plainLap.permanentsToGraveyardThisTurn = 1;
        expect(positionFingerprint(plainLap)).toBe(positionFingerprint(plain));

        const gravestorm = harpyPositionHoldingGravestorm();
        const gravestormLap = cloneGameState(gravestorm);
        gravestormLap.permanentsToGraveyardThisTurn = 1;
        expect(positionFingerprint(gravestormLap)).not.toBe(
            positionFingerprint(gravestorm)
        );
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

    it("a higher graveyard tally is progress while a gravestorm card could read it (CR 702.69), and only then", () => {
        const plain = buildPositionFromSpec(HARPY_POSITION);
        const me = plain.players[0].id;
        const plainHistory = recordRepetition(
            undefined,
            plain,
            me,
            harpyCast(plain)
        );
        const plainLap = cloneGameState(plain);
        plainLap.permanentsToGraveyardThisTurn = 1;
        expect(repeatedMoveKeys(plainHistory, plainLap, me).size).toBe(1);

        const gravestorm = harpyPositionHoldingGravestorm();
        const gravestormHistory = recordRepetition(
            undefined,
            gravestorm,
            me,
            harpyCast(gravestorm)
        );
        const gravestormLap = cloneGameState(gravestorm);
        gravestormLap.permanentsToGraveyardThisTurn = 1;
        expect(
            repeatedMoveKeys(gravestormHistory, gravestormLap, me).size
        ).toBe(0);
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

// Issue #3657 — a may-pay yes can be a lap too: two seats copying a self-copying
// spell at each other with empty hands reach no priority node, so the decline is
// the only exit.
describe("the may-pay shape of an optional loop (issue #3657)", () => {
    preloadDefinitions([chainOfSmog()]);
    const YES: Move = { kind: "may-pay", accept: true };
    const NO: Move = { kind: "may-pay", accept: false };

    function chainAtEmptyHands(): GameState {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, chainOfSmog().id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        return state;
    }

    /** One link: the owed seat says yes and points the copy at the other. */
    function link(state: GameState): void {
        const seat = state.pendingChoices![0].playerId;
        applyMayPaySubmit(state, { playerId: seat, accept: true });
        finalizeTargetSelection(
            state,
            {
                ...state.pendingTarget!,
                selected: [{ type: "player", id: seat === "p1" ? "p2" : "p1" }],
            },
            seat
        );
        resolveTopOfStack(state);
    }

    /** The original spell has left the stack: the position lap two returns to. */
    function atLapStart(): GameState {
        const state = chainAtEmptyHands();
        link(state);
        link(state);
        return state;
    }

    it("a chain's copy under a fresh allocator number is the same position", () => {
        const state = atLapStart();
        const before = positionFingerprint(state);
        const copyId = state.stack[0].id;
        link(state);
        link(state);
        expect(state.stack[0].id).not.toBe(copyId);
        expect(positionFingerprint(state)).toBe(before);
    });

    it("denies a yes from the position it was given in, and the search declines", () => {
        const state = atLapStart();
        const seat = state.pendingChoices![0].playerId;
        const history = recordRepetition(undefined, state, seat, YES);
        link(state);
        link(state);
        expect(repeatedMoveKeys(history, state, seat)).toContain(
            repetitionKeyAt(state, YES)
        );
        expect(
            searchWithTrace(
                state,
                seat,
                { iterations: 30 },
                7,
                undefined,
                history
            ).move
        ).toEqual(NO);
    });

    it("the search stamping an informed seat's deck knowledge is the same position", () => {
        const state = atLapStart();
        const seat = state.pendingChoices![0].playerId;
        const other = seat === "p1" ? "p2" : "p1";
        const history = recordRepetition(undefined, state, seat, YES);
        link(state);
        link(state);
        const deck = [chainOfSmog().id, chainOfSmog().id];
        expect(
            searchWithTrace(
                state,
                seat,
                { iterations: 30 },
                7,
                [
                    { playerId: seat, cardIds: deck },
                    { playerId: other, cardIds: deck },
                ],
                history
            ).move
        ).toEqual(NO);
    });

    it("a yes from another position in the step stays open", () => {
        const state = atLapStart();
        const seat = state.pendingChoices![0].playerId;
        const history = recordRepetition(undefined, state, seat, YES);
        // The OPPONENT is the one holding a new card: the seat's margin is no
        // better, so only the position in the key tells this yes from the last.
        const elsewhere = cloneGameState(state);
        const opponent = elsewhere.players.find((p) => p.id !== seat)!;
        opponent.hand.push(
            makeInstance(getCardByName("Grizzly Bears").id, {
                id: "drawn",
                controllerId: opponent.id,
                ownerId: opponent.id,
                zone: "hand",
            })
        );
        expect(repeatedMoveKeys(history, elsewhere, seat)).not.toContain(
            repetitionKeyAt(elsewhere, YES)
        );
    });

    it("the decline is an exit: never remembered, never denied", () => {
        const state = atLapStart();
        const seat = state.pendingChoices![0].playerId;
        expect(isLoopExit(NO)).toBe(true);
        expect(isLoopExit(YES)).toBe(false);
        expect(
            Object.keys(recordRepetition(undefined, state, seat, NO).chosen)
        ).toEqual([]);
    });
});
