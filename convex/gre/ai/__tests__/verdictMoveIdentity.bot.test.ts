// A Move's identity across two builds of the same position (issue #3483).
//
// The `different-decision` guard compares the decision the Bot actually took
// against the same decision on the position rebuilt from its `ScenarioSpec`.
// It used to compare through `describeMove`, on the stated grounds that the
// describer's sentence was "the only vocabulary they share" — and the describer
// names the PLAYER, so every decision that targeted one read "→ Mr bambury
// (P1)" live and "→ Blade P2" on the rebuild and was refused. These are the
// two halves of the fix: the key that carries no per-world fact, and the guard
// that still refuses a real mismatch once the key is doing the comparing.

import { describe, it, expect } from "vitest";
import { canonicalMoveKey, relativeSeatIndexes } from "../../canonicalMoveKey";
import { describeMove } from "../../describeMove";
import { moveKey } from "../../search";
import {
    candidateSetsDiffer,
    type ComparedCandidate,
} from "../verdicts/lowering";
import {
    buildSetupFreeVerdictState,
    candidateMoves,
} from "../verdicts/candidates";
import { sealOfFire } from "../../../cards/sets/nem/red";
import type { Move } from "../../moves";
import type { GameState } from "../../state";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

/** A board whose only decision targets a PLAYER: Seal of Fire's
 *  "Sacrifice this enchantment: It deals 2 damage to any target" costs no mana
 *  and no tap, so both seats and the creature are live targets at priority
 *  (CR 116.2 is not involved — it is an ordinary activated ability, CR 602.1). */
const SEAL_AT_A_PLAYER: ScenarioSpec = {
    cards: [
        { name: sealOfFire.name, owner: "me", zone: "battlefield" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

/** The Seal's activation aimed at `playerId`. */
function sealAt(state: GameState, botId: string, playerId: string): Move {
    const move = candidateMoves(state, botId).find(
        (candidate) =>
            candidate.kind === "activate-ability" &&
            candidate.targets.some(
                (target) => target.type === "player" && target.id === playerId
            )
    );
    expect(move).toBeDefined();
    return move!;
}

describe("canonicalMoveKey — the vocabulary two builds share (issue #3483)", () => {
    it("is unchanged when a seat is renamed, while the describer's sentence is not", () => {
        const state = buildSetupFreeVerdictState(SEAL_AT_A_PLAYER);
        const [me, opponent] = state.players;
        const move = sealAt(state, me.id, opponent.id);

        const key = canonicalMoveKey(move, state, me.id);
        const sentence = describeMove(move, state);

        // The live board's seats carry the players' real nicknames; the
        // rebuild's carry the blade harness's. That difference alone is what
        // used to refuse this decision.
        me.name = "Mr bambury";
        opponent.name = "Tessa";

        expect(canonicalMoveKey(move, state, me.id)).toBe(key);
        expect(describeMove(move, state)).not.toBe(sentence);
    });

    it("carries no player display name and no per-world instance id", () => {
        const state = buildSetupFreeVerdictState(SEAL_AT_A_PLAYER);
        const [me, opponent] = state.players;
        me.name = "Mr bambury";
        const seal = me.battlefield[0];
        const move = sealAt(state, me.id, opponent.id);

        const key = canonicalMoveKey(move, state, me.id);
        expect(key).not.toContain("Mr bambury");
        expect(key).not.toContain(seal.id);
        expect(key).not.toContain(opponent.id);
        // What it carries instead: the card's DEFINITION id and the target's
        // seat index relative to the decider.
        expect(key).toContain(sealOfFire.id);
        expect(key).toContain("seat#1");

        // And the structural key — right for a tree node, wrong across two
        // builds — does embed the instance id. The two answer different
        // questions, which is why both exist.
        expect(moveKey(move)).toContain(seal.id);
    });

    it("keeps two moves that differ ONLY in which player they target apart", () => {
        const state = buildSetupFreeVerdictState(SEAL_AT_A_PLAYER);
        const [me, opponent] = state.players;

        expect(
            canonicalMoveKey(sealAt(state, me.id, me.id), state, me.id)
        ).not.toBe(
            canonicalMoveKey(sealAt(state, me.id, opponent.id), state, me.id)
        );
    });

    it("indexes seats RELATIVE to the decider, and refuses a frame it has no seat for", () => {
        const state = buildSetupFreeVerdictState(SEAL_AT_A_PLAYER);
        const [me, opponent] = state.players;

        expect([...relativeSeatIndexes(state, me.id)]).toEqual([
            [me.id, 0],
            [opponent.id, 1],
        ]);
        // Same board, other decider: the same two seats, renumbered. A
        // relative index is what lets a third seat be seat 2 rather than a
        // special case.
        expect([...relativeSeatIndexes(state, opponent.id)]).toEqual([
            [me.id, 1],
            [opponent.id, 0],
        ]);
        // No frame at all rather than an absolute one wearing the same name:
        // an absolute index would silently compare two coordinate systems.
        expect(relativeSeatIndexes(state, "not-a-seat").size).toBe(0);
    });
});

describe("the candidate-set guard still refuses a real mismatch (issue #3483)", () => {
    const candidate = (
        key: string,
        description: string
    ): ComparedCandidate => ({
        key,
        description,
    });

    it("agrees when both sides name the same keys, whatever order they enumerate in", () => {
        expect(
            candidateSetsDiffer(
                [candidate("a", "pass"), candidate("b", "attack: Bears")],
                [candidate("b", "attack: Bears"), candidate("a", "pass")]
            )
        ).toBeNull();
    });

    it("refuses when the rebuild is MISSING a move the Bot had", () => {
        const difference = candidateSetsDiffer(
            [candidate("a", "pass"), candidate("b", "cast Lightning Bolt")],
            [candidate("a", "pass")]
        );
        expect(difference).toContain('the Bot had "cast Lightning Bolt"');
        expect(difference).toContain("the rebuild does not");
    });

    it("refuses when the rebuild offers an EXTRA move the Bot did not have", () => {
        const difference = candidateSetsDiffer(
            [candidate("a", "pass")],
            [candidate("a", "pass"), candidate("b", "play Mountain")]
        );
        expect(difference).toContain('the rebuild offers "play Mountain"');
        expect(difference).toContain("the Bot did not");
    });

    it("refuses when the keys match but the MULTIPLICITY does not", () => {
        // Interchangeable candidates key identically (the describer's own
        // limit, inherited unchanged), so a list can differ only in how many
        // of one key it holds — which set membership cannot name.
        expect(
            candidateSetsDiffer(
                [
                    candidate("a", "pass"),
                    candidate("b", "attack: Bears"),
                    candidate("b", "attack: Bears"),
                ],
                [candidate("a", "pass"), candidate("b", "attack: Bears")]
            )
        ).toBe("3 move(s) in play against 2 on the rebuild");
    });
});
