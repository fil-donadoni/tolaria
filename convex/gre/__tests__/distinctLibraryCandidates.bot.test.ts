// The ISMCTS candidate generator for a pairwise-DISTINCT library search
// (CR 701.23a, issue #6475) — `searchLibraryCandidates` in
// `convex/gre/ai/choiceCandidates.ts`. The greedy "best set led by this card"
// prefix knows nothing about names, so on a library of identical lands it
// proposes two of one name — a submission the server rejects, which escapes
// the search as a throw. The constraint is pruned where the set is built.

import { describe, it, expect } from "vitest";
import { CHOICE_CANDIDATE_GENERATORS } from "../ai/choiceCandidates";
import { isDistinctPickLegal } from "../distinctPick";
import type { PendingChoice } from "../state";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const FOREST_ID = "test-bot-dl-forest";
const ISLAND_ID = "test-bot-dl-island";
for (const [id, subtype] of [
    [FOREST_ID, "Forest"],
    [ISLAND_ID, "Island"],
] as const) {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: {},
        types: ["Land"],
        subtypes: [subtype],
    });
}

function distinctSearch(withKeys: boolean) {
    const library: [string, string][] = [
        ["f1", FOREST_ID],
        ["f2", FOREST_ID],
        ["f3", FOREST_ID],
        ["i1", ISLAND_ID],
    ];
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                library: library.map(([id, defId]) =>
                    makeInstance(defId, {
                        id,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
    state.pendingChoices = [
        {
            stackItemId: "stack-1",
            step: 0,
            choiceId: "$found",
            playerId: "p1",
            kind: "search-library",
            zone: "library",
            isSearch: true,
            candidateIds: library.map(([id]) => id),
            ...(withKeys
                ? {
                      distinctKeys: {
                          f1: "Forest",
                          f2: "Forest",
                          f3: "Forest",
                          i1: "Island",
                      },
                  }
                : {}),
            count: { min: 0, max: 2 },
            prompt: "Search your library for up to two cards with different names.",
        } as PendingChoice,
    ];
    return state;
}

const idsOf = (c: { move: unknown }) =>
    (c.move as { cardInstanceIds: string[] }).cardInstanceIds;

describe("searchLibraryCandidates under distinctBy (CR 701.23a, issue #6475)", () => {
    it("every emitted submission is a LEGAL distinct pick", () => {
        const state = distinctSearch(true);
        const head = state.pendingChoices![0];
        const raw = CHOICE_CANDIDATE_GENERATORS["search-library"]!(state, head);
        expect(raw.length).toBeGreaterThan(0);
        for (const candidate of raw) {
            expect(
                isDistinctPickLegal(head.distinctKeys!, idsOf(candidate))
            ).toBe(true);
        }
    });

    it("the two-card answer stays reachable — one Forest plus the Island", () => {
        const state = distinctSearch(true);
        const raw = CHOICE_CANDIDATE_GENERATORS["search-library"]!(
            state,
            state.pendingChoices![0]
        );
        const full = raw.map(idsOf).filter((ids) => ids.length === 2);
        expect(full.length).toBeGreaterThan(0);
        for (const ids of full) expect(ids).toContain("i1");
    });

    it("without distinctBy the greedy prefix still takes two Forests", () => {
        const state = distinctSearch(false);
        const raw = CHOICE_CANDIDATE_GENERATORS["search-library"]!(
            state,
            state.pendingChoices![0]
        );
        expect(
            raw.some((c) => {
                const ids = idsOf(c);
                return ids.length === 2 && ids.every((id) => id !== "i1");
            })
        ).toBe(true);
    });
});
