// Free attacks into an empty board (issue #9975) — `pruneDominatedAttacks`
// drops the declarations that leave home an attacker whose attack is provably
// free. CR 509.1a: only untapped creatures block. CR 508.1f: an attacking
// creature without vigilance taps (CR 702.20b), so it cannot block the
// crack-back. CR 508.1h: an attack tax makes an attack cost something.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { getCardByName } from "../../../cards";
import type { CardInstanceState, GameState } from "../../state";
import { enumerateAttackerMoves, type Move } from "../../moves";
import { freeAttackerIds, pruneDominatedAttacks } from "../attackDominance";

function permanent(
    name: string,
    id: string,
    controllerId: string,
    extra: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(getCardByName(name).id, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
        ...extra,
    });
}

/** p1 declares attackers into p2's `defence`. */
function declareAttackersStep(
    attackers: CardInstanceState[],
    defence: CardInstanceState[] = []
): GameState {
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: attackers }),
            makePlayer("p2", { battlefield: defence }),
        ],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

function attackSets(moves: Move[]): string[][] {
    return moves.flatMap((m) =>
        m.kind === "declare-attackers" ? [[...m.attackerIds].sort()] : []
    );
}

function pruned(state: GameState): string[][] {
    const p1 = state.players[0];
    return attackSets(
        pruneDominatedAttacks(state, enumerateAttackerMoves(state, p1))
    );
}

const GIANT = "Two-Headed Giant of Foriys";
const MINOTAUR = "Hurloon Minotaur";

describe("free attacks into an empty board (CR 508.1, 509.1a)", () => {
    it("keeps only the all-in declaration when the defender controls nothing", () => {
        const state = declareAttackersStep([
            permanent(GIANT, "giant", "p1"),
            permanent(MINOTAUR, "mino", "p1"),
        ]);
        expect(pruned(state)).toEqual([["giant", "mino"]]);
    });

    it("never treats a summoning-sick creature as left home (CR 302.6)", () => {
        const state = declareAttackersStep([
            permanent(GIANT, "giant", "p1"),
            permanent(MINOTAUR, "mino", "p1", { isSummoningSick: true }),
        ]);
        expect(pruned(state)).toEqual([["giant"]]);
    });

    it("prunes nothing against an untapped potential blocker (CR 509.1a)", () => {
        const state = declareAttackersStep(
            [
                permanent(GIANT, "giant", "p1"),
                permanent(MINOTAUR, "mino", "p1"),
            ],
            [permanent("Grizzly Bears", "bears", "p2")]
        );
        expect(freeAttackerIds(state).size).toBe(0);
        expect(pruned(state)).toHaveLength(4);
    });

    it("a tapped opposing creature makes a non-vigilant tap a cost — only the vigilant attacker is free", () => {
        const state = declareAttackersStep(
            [
                permanent(MINOTAUR, "mino", "p1"),
                permanent("Serra Angel", "angel", "p1"),
            ],
            [permanent("Craw Wurm", "wurm", "p2", { isTapped: true })]
        );
        expect([...freeAttackerIds(state)]).toEqual(["angel"]);
        expect(pruned(state)).toEqual([["angel"], ["angel", "mino"]]);
    });

    it("a manland is a blocker the board does not show yet", () => {
        const state = declareAttackersStep(
            [permanent(GIANT, "giant", "p1")],
            [permanent("Mishra's Factory", "factory", "p2")]
        );
        expect(freeAttackerIds(state).size).toBe(0);
    });

    it("an attacker with a {T} ability gives it up by attacking", () => {
        const state = declareAttackersStep([
            permanent("Birds of Paradise", "birds", "p1"),
            permanent(MINOTAUR, "mino", "p1"),
        ]);
        expect([...freeAttackerIds(state)]).toEqual(["mino"]);
    });

    it("an attack tax makes no attack free (CR 508.1h)", () => {
        const state = declareAttackersStep(
            [permanent(GIANT, "giant", "p1")],
            [permanent("Collective Restraint", "tax", "p2")]
        );
        expect(freeAttackerIds(state).size).toBe(0);
    });
});
