/**
 * `sacrifice-permanents` is an in-tree choice node (CR 701.21a, issue #3377).
 *
 * Before this it had no candidate generator at all, which cost more than a
 * worse victim pick: `settleStackForBreakdown` cannot get past a suspended
 * choice it has no candidates for, so every probe resolving a spell or ability
 * that leads to one scored the ENTERING BODY and never the sacrifice paying
 * for it. Measured on Kjeldoran Dead (a 3/1 whose ETB sacrifices one of your
 * own creatures, CR 701.21) with a Craw Wurm out: the settle stopped with the
 * choice standing and the margin read the board with BOTH creatures on it.
 *
 * That is the shape issue #3293 documents for `policyValue` — a suspended
 * resolution is not a ply boundary, and scoring one is how the policy learns
 * to want a body that is already dead.
 */

import { describe, expect, it } from "vitest";
import { choiceCandidates } from "../choiceCandidates";
import {
    applyMoveInSearch,
    decidingPlayer,
    settleStackForBreakdown,
} from "../../search";
import { materialMargin } from "../../evaluate";
import { enumerateMoves } from "../../moves";
import { buildBladeState } from "../blade/runner";
import { getCardByName } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import { findBladeScenario } from "../blade/registry";
import { cloneGameState } from "../../clone";
import { resolveTopOfStack } from "../../state";
import type { GameState } from "../../state";

/** The shipped blade board: Kjeldoran Dead in hand, a Craw Wurm on the
 *  battlefield, three lands. Reused rather than rebuilt so the unit assertion
 *  and the `must` entry cannot drift onto different positions. */
function kjeldoranBoard(): { state: GameState; botId: string } {
    const scenario = findBladeScenario(
        "sacrifice sign: does not cast a creature whose ETB eats its own board"
    );
    if (!scenario) throw new Error("blade entry missing");
    const state = buildBladeState(scenario);
    const botId = decidingPlayer(state);
    if (!botId) throw new Error("no decider");
    return { state, botId };
}

function castAndSettle(): {
    before: GameState;
    settled: GameState;
    botId: string;
} {
    const { state, botId } = kjeldoranBoard();
    const cast = enumerateMoves(state, botId).find(
        (m) => m.kind === "cast-spell"
    );
    if (!cast) throw new Error("no cast enumerated");
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, botId, cast);
    return {
        before: state,
        settled: settleStackForBreakdown(probe, botId),
        botId,
    };
}

describe("sacrifice-permanents as a search node (issue #3377)", () => {
    it("the settle gets PAST the suspended sacrifice", () => {
        // The defect, stated as the seam rather than as a decision: with no
        // generator the settle returned a state still carrying the choice, and
        // whatever scored it counted a creature the resolution was about to eat.
        const { settled } = castAndSettle();
        expect(settled.pendingChoices ?? []).toHaveLength(0);
    });

    it("and the cast is then a material LOSS, which is why the bot declines it", () => {
        const { before, settled, botId } = castAndSettle();
        expect(materialMargin(settled, botId)).toBeLessThan(
            materialMargin(before, botId)
        );
    });

    it("an OPTIONAL sacrifice keeps its DECLINE branch (review finding 1)", () => {
        // Registering the kind without this does not fix the gap, it flips its
        // sign. Before, the choice was no search node and the ADR 0016
        // heuristic declined; with it searchable and no empty submission the
        // search has only sacrificing branches, so the bot can never say no —
        // and the driver's `chooseOwedChoiceAction` net cannot cover it,
        // because the search DOES yield a move.
        //
        // Gut, True Soul Zealot is the shipped shape (`count: { min: 0 }`,
        // "you MAY sacrifice"): its only other creature here is a 6/4, so the
        // forced branch eats the bot's best body for a 4/1 Skeleton.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(getCardByName("Craw Wurm").id, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "wurm",
                            isSummoningSick: false,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const choice = {
            kind: "sacrifice-permanents",
            stackItemId: "s1",
            step: 0,
            choiceId: "c1",
            playerId: "p1",
            zone: "battlefield",
            count: { min: 0, max: 1 },
            prompt: "You may sacrifice a creature.",
        } as unknown as NonNullable<GameState["pendingChoices"]>[number];
        const candidates = [...choiceCandidates(state, choice)];
        const declines = candidates.filter(
            (c) =>
                (
                    (c.move as { cardInstanceIds?: string[] })
                        .cardInstanceIds ?? []
                ).length === 0
        );
        expect(declines).toHaveLength(1);
        // …and the sacrifice is still offered, or the branch is not a choice.
        expect(candidates.length).toBeGreaterThan(1);
    });

    it("emits distinct SETS, not the same set in several orders (review finding 2)", () => {
        // The prefix walk reaches one set from several leads. Duplicates cost
        // twice: top-K slots carrying nothing, and an in-tree split of that
        // set's UCB visits across siblings, which makes it look LESS explored
        // than a single-node rival with the same total visits.
        const names = [
            "Llanowar Elves",
            "Grizzly Bears",
            "Hill Giant",
            "Serra Angel",
            "Craw Wurm",
        ];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: names.map((n, i) =>
                        makeInstance(getCardByName(n).id, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: `c${i}`,
                            isSummoningSick: false,
                        })
                    ),
                }),
                makePlayer("p2"),
            ],
        });
        const choice = {
            kind: "sacrifice-permanents",
            stackItemId: "s1",
            step: 0,
            choiceId: "c1",
            playerId: "p1",
            zone: "battlefield",
            count: 3,
            prompt: "Sacrifice three permanents.",
        } as unknown as NonNullable<GameState["pendingChoices"]>[number];
        const sets = [...choiceCandidates(state, choice)].map((c) =>
            [
                ...((c.move as { cardInstanceIds?: string[] })
                    .cardInstanceIds ?? []),
            ]
                .sort()
                .join("+")
        );
        expect(new Set(sets).size).toBe(sets.length);
    });

    it("every candidate satisfies the choice's own filter (CR 202.2)", () => {
        // Not a preference — a candidate the submit path rejects is not a worse
        // branch, it is a THROW mid-search. `pendingChoiceSubmit` gates each
        // pick on `matchesPermanentFilter` over the effective view, so the
        // generator reads the same predicate: Kjeldoran Dead sacrifices a
        // CREATURE, and offering one of the three lands took the whole blade
        // suite down with "Card does not match the required filter".
        const { state, botId } = kjeldoranBoard();
        const cast = enumerateMoves(state, botId).find(
            (m) => m.kind === "cast-spell"
        );
        if (!cast) throw new Error("no cast enumerated");
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, botId, cast);
        // Walk to the suspended choice without answering it.
        while (probe.stack.length > 0 && !(probe.pendingChoices ?? []).length) {
            resolveTopOfStack(probe);
        }
        const head = (probe.pendingChoices ?? [])[0];
        expect(head?.kind).toBe("sacrifice-permanents");
        const candidates = [...choiceCandidates(probe, head!)];
        expect(candidates.length).toBeGreaterThan(0);
        const owner = probe.players.find((p) => p.id === head!.playerId)!;
        for (const candidate of candidates) {
            const ids = (candidate.move as { cardInstanceIds?: string[] })
                .cardInstanceIds;
            expect(ids?.length).toBeGreaterThan(0);
            for (const id of ids ?? []) {
                const card = owner.battlefield.find((c) => c.id === id);
                expect(card).toBeDefined();
                expect(card!.types).toContain("Creature");
            }
        }
    });
});
