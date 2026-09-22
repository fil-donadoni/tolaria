// The ISMCTS candidate generator for a CATEGORISED library search
// (CR 701.23a, issue #3808) — `searchLibraryCandidates` in
// `convex/gre/ai/choiceCandidates.ts`.
//
// Why this is a bot test and not a rules test: the generator builds each
// candidate as "the best set LED BY this card", a greedy prefix over the
// value ranking. That prefix knows nothing about categories, so on Gaea's
// Balance's library it happily proposes two Forests — a submission
// `applyPendingChoiceSubmit` REJECTS. A rejected submission inside the search
// is a THROW that escapes the tree, not a low score, so this is a legality
// constraint on the generator and has to be pruned where the set is built.
//
// Deterministic by construction: no rng, no wall clock — the generator is a
// pure function of (state, choice).

import { describe, it, expect } from "vitest";
import { CHOICE_CANDIDATE_GENERATORS } from "../ai/choiceCandidates";
import { isCategorizedPickLegal } from "../categorizedPick";
import type { GameState, PendingChoice } from "../state";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const PLAINS_ID = "test-bot-cl-plains";
registerTokenDefinition({
    id: PLAINS_ID,
    name: PLAINS_ID,
    rarity: "common",
    manaCost: {},
    types: ["Land"],
    subtypes: ["Plains"],
});
const FOREST_ID = "test-bot-cl-forest";
registerTokenDefinition({
    id: FOREST_ID,
    name: FOREST_ID,
    rarity: "common",
    manaCost: {},
    types: ["Land"],
    subtypes: ["Forest"],
});

/** Gaea's Balance's shape, trimmed to the two types these fixtures use. */
function stateWithCategorizedSearch(
    library: [string, string][],
    categories: { label: string; cardIds: string[] }[],
    count: PendingChoice["count"]
): GameState {
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
            categories,
            count,
            prompt: "Search your library for a land card of each basic land type.",
        } as PendingChoice,
    ];
    return state;
}

describe("searchLibraryCandidates under categories (CR 701.23a, issue #3808)", () => {
    /** Three Forests and one Plains: the matching is 2, and the greedy
     *  ranking puts the identically-valued Forests adjacent — exactly the
     *  arrangement that produces an illegal pair without the gate. */
    const forestHeavy = () =>
        stateWithCategorizedSearch(
            [
                ["f1", FOREST_ID],
                ["f2", FOREST_ID],
                ["f3", FOREST_ID],
                ["p1-plains", PLAINS_ID],
            ],
            [
                { label: "Plains", cardIds: ["p1-plains"] },
                { label: "Forest", cardIds: ["f1", "f2", "f3"] },
            ],
            { min: 0, max: 2 }
        );

    it("every emitted submission is a LEGAL categorised pick", () => {
        const state = forestHeavy();
        const head = state.pendingChoices![0];
        const raw = CHOICE_CANDIDATE_GENERATORS["search-library"]!(state, head);
        expect(raw.length).toBeGreaterThan(0);
        for (const candidate of raw) {
            const move = candidate.move as { cardInstanceIds: string[] };
            expect(
                isCategorizedPickLegal(head.categories!, move.cardInstanceIds)
            ).toBe(true);
        }
    });

    it("no emitted submission seats two cards in the same category", () => {
        const state = forestHeavy();
        const raw = CHOICE_CANDIDATE_GENERATORS["search-library"]!(
            state,
            state.pendingChoices![0]
        );
        const forests = new Set(["f1", "f2", "f3"]);
        for (const candidate of raw) {
            const ids = (candidate.move as { cardInstanceIds: string[] })
                .cardInstanceIds;
            expect(ids.filter((id) => forests.has(id))).toHaveLength(
                ids.length > 0 ? 1 : 0
            );
        }
    });

    it("the two-card answer is still reachable — pruning never costs the maximum", () => {
        const state = forestHeavy();
        const raw = CHOICE_CANDIDATE_GENERATORS["search-library"]!(
            state,
            state.pendingChoices![0]
        );
        const full = raw
            .map(
                (c) => (c.move as { cardInstanceIds: string[] }).cardInstanceIds
            )
            .filter((ids) => ids.length === 2);
        expect(full.length).toBeGreaterThan(0);
        // Every maximal answer is one Forest plus the Plains.
        for (const ids of full) {
            expect(ids).toContain("p1-plains");
        }
    });

    it("an UNCATEGORISED search is untouched — the greedy prefix still fills", () => {
        const state = stateWithCategorizedSearch(
            [
                ["f1", FOREST_ID],
                ["f2", FOREST_ID],
            ],
            [],
            { min: 0, max: 2 }
        );
        // No categories at all: the pre-#3808 behaviour, both Forests taken.
        delete (state.pendingChoices![0] as { categories?: unknown })
            .categories;
        const raw = CHOICE_CANDIDATE_GENERATORS["search-library"]!(
            state,
            state.pendingChoices![0]
        );
        expect(
            raw.some(
                (c) =>
                    (c.move as { cardInstanceIds: string[] }).cardInstanceIds
                        .length === 2
            )
        ).toBe(true);
    });
});
