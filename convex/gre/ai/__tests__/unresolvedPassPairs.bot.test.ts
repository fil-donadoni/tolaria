// Unresolved-pass Eval Pairs (issue #9973): CR 117.4 resolves the top of the
// stack only once every player has passed in succession, so a `pass` that is
// the first of the round hands priority on and resolves nothing. Its 1-ply leaf
// reads the stack it left behind, and a pair against an answer to that stack
// is routed beside the timing pairs, never fitted. A `pass` whose probe does
// resolve the top reads its consequence and stays in the fit. Read on real
// blade positions through the production enumerator and probe.
import { describe, expect, it } from "vitest";
import type { Move } from "../../moves";
import { buildBladeState, findBladeScenario } from "../blade";
import { seatPlayerId } from "../blade/matcher";
import { unresolvedPassPairClassifier } from "../verdicts/evalPairs";
import { candidateMoves } from "../verdicts/position";

function position(label: string) {
    const entry = findBladeScenario(label);
    expect(entry, label).toBeDefined();
    const state = buildBladeState(entry!);
    const bot = seatPlayerId(state, "me");
    const moves = candidateMoves(state, bot);
    return { state, bot, moves };
}

function indexOf(moves: readonly Move[], kind: Move["kind"]): number {
    const index = moves.findIndex((m) => m.kind === kind);
    expect(index, kind).toBeGreaterThanOrEqual(0);
    return index;
}

describe("unresolved-pass pairs (CR 117.4)", () => {
    it("a pass over the bot's own trigger resolves nothing: the answer's pair is not fitted, both ways", () => {
        const { state, bot, moves } = position(
            "charter: Stifles its own Phyrexian Dreadnought trigger"
        );
        const isUnresolved = unresolvedPassPairClassifier(state, bot, moves);
        const pass = indexOf(moves, "pass");
        const stifle = indexOf(moves, "cast-spell");
        expect(isUnresolved({ rightIndex: stifle, otherIndex: pass })).toBe(
            true
        );
        expect(isUnresolved({ rightIndex: pass, otherIndex: stifle })).toBe(
            true
        );
    });

    it("a pass that lets the opponent's spell resolve reads it: the pair stays in the fit", () => {
        const { state, bot, moves } = position(
            "counterspell: Mana Drain holds against a Savannah Lions"
        );
        const isUnresolved = unresolvedPassPairClassifier(state, bot, moves);
        const pass = indexOf(moves, "pass");
        const drain = indexOf(moves, "cast-spell");
        expect(isUnresolved({ rightIndex: pass, otherIndex: drain })).toBe(
            false
        );
    });
});
