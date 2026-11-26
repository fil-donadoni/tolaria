// A verdict recorded before a hand-written card retired to its compiled twin
// (ADR 0114) names an ability by the hand-written id — in a candidate move key
// and in a stack item of its position. Both are immutable, so every reader
// renames through ONE table (`cards/retiredAbilityIds.ts`): the Strip Mine
// verdict in the store reads "strip-mine-destroy" (compiled:
// "strip-mine-ability-2"), the Treva's Ruins one stacks "trevas-ruins-etb"
// (compiled: "treva-s-ruins-trigger").

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

/** The Treva's Ruins enter trigger as the stored verdict stacks it: under the
 *  hand-written id, checkpointed on its may-pay (CR 608.2). */
const TREVAS_RUINS_SPEC: Verdict["spec"] = {
    phase: "PRECOMBAT_MAIN",
    turn: 5,
    landCount: 0,
    libraryCount: 20,
    activePlayer: "me",
    priority: "me",
    landsPlayed: { me: 1 },
    cards: [
        { name: "Llanowar Wastes", owner: "me", tapped: true },
        { name: "Treva's Ruins", owner: "me" },
    ],
    stack: [
        {
            abilityId: "trevas-ruins-etb",
            controller: "me",
            event: {
                fields: {
                    cardId: {
                        kind: "scalar",
                        value: "8bae2458-b54f-426a-ad40-13529a73c423",
                    },
                    controllerId: {
                        kind: "player",
                        seat: "me",
                    },
                    instanceId: {
                        kind: "object",
                        ref: {
                            name: "Treva's Ruins",
                            seat: "me",
                            zone: "battlefield",
                        },
                    },
                    manaValue: {
                        kind: "scalar",
                        value: 0,
                    },
                    types: {
                        kind: "scalar",
                        value: ["Land"],
                    },
                    wasPlayed: {
                        kind: "scalar",
                        value: true,
                    },
                },
                type: "PERMANENT_ENTERED",
            },
            kind: "trigger",
            name: "Treva's Ruins",
            resolution: {
                collected: {
                    "0:$source": [
                        {
                            kind: "scalar",
                            value: "0",
                        },
                        {
                            kind: "scalar",
                            value: "0",
                        },
                        {
                            kind: "player",
                            seat: "me",
                        },
                        {
                            kind: "object",
                            ref: {
                                name: "Treva's Ruins",
                                seat: "me",
                                zone: "battlefield",
                            },
                        },
                        {
                            kind: "scalar",
                            value: "0",
                        },
                        {
                            kind: "player",
                            seat: "me",
                        },
                        {
                            kind: "scalar",
                            value: "1",
                        },
                        {
                            kind: "scalar",
                            value: "Land",
                        },
                        {
                            kind: "scalar",
                            value: "Lair",
                        },
                        {
                            kind: "scalar",
                            value: "Treva's Ruins",
                        },
                    ],
                },
                step: 0,
            },
        },
    ],
};

describe("buildVerdictState — a stack trigger stored under a retired id (ADR 0114)", () => {
    it("resumes the compiled twin's trigger and re-suspends on its may-pay", () => {
        const state = buildVerdictState({
            ...verdictOver([]),
            spec: TREVAS_RUINS_SPEC,
        });
        const botId = seatPlayerId(state, "me");
        expect(candidateMoves(state, botId).map((m) => m.kind)).toContain(
            "may-pay"
        );
    });
});
