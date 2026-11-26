// A verdict recorded before a hand-written card retired to its compiled twin
// (ADR 0114) names the activation by the hand-written ability id. The stored
// key is immutable, so the reader renames it (`RETIRED_ABILITY_IDS`) — the
// Strip Mine verdict in the store reads "strip-mine-destroy", the compiled
// twin's ability is "strip-mine-ability-2".

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { Move } from "../../moves";
import { moveKey } from "../../search";
import { seatPlayerId } from "../blade/matcher";
import { resolveVerdictMoves } from "../verdicts/evalPairs";
import { buildVerdictState, candidateMoves } from "../verdicts/position";
import type { Verdict } from "../verdicts/types";

const SPEC: Verdict["spec"] = {
    phase: "PRECOMBAT_MAIN",
    turn: 5,
    landCount: 0,
    libraryCount: 20,
    cards: [
        { name: "Strip Mine", owner: "me", zone: "battlefield" },
        { name: "Tolarian Academy", owner: "opp", zone: "battlefield" },
    ],
};

function verdictOver(keys: string[]): Verdict {
    return {
        id: "test:retired-ability-id",
        spec: SPEC,
        seat: "me",
        candidates: keys.map((key, i) => ({
            key,
            description: `candidate ${i}`,
        })),
        answer: { kind: "right", rightIndexes: [1] },
    } as Verdict;
}

describe("resolveVerdictMoves — a retired hand-written ability id (ADR 0114)", () => {
    const state = buildVerdictState(verdictOver([]));
    const botId = seatPlayerId(state, "me");
    const stripMineId = getCardByName("Strip Mine").id;
    const destroy = candidateMoves(state, botId).find(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" &&
            m.abilityId === "strip-mine-ability-2" &&
            state.players
                .flatMap((p) => p.battlefield)
                .some(
                    (c) =>
                        c.id === m.cardInstanceId &&
                        (c.card as { id: string }).id === stripMineId
                )
    );

    it("is a position offering the compiled twin's destroy activation", () => {
        expect(destroy).toBeDefined();
    });

    it("resolves the activation stored under the hand-written id", () => {
        const stored = JSON.stringify({
            ...destroy!,
            abilityId: "strip-mine-destroy",
        });
        const resolved = resolveVerdictMoves(
            verdictOver(['{"kind":"pass"}', stored]),
            state,
            botId
        );
        expect("moves" in resolved && moveKey(resolved.moves[1])).toBe(
            moveKey(destroy!)
        );
    });
});
