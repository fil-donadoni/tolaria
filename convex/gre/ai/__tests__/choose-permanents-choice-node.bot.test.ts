/**
 * `choose-permanents` is an in-tree choice node (CR 608.2, issue #3545).
 *
 * Two failures, closed by one generator. With no generator registered,
 * `settleStackForBreakdown` could not get past the suspended choice, so a probe
 * resolving a spell or ability that leads to one scored HALF a resolution —
 * live on every mandatory site, and silent. And the minimal-legal default in
 * `brain.ts` submitted exactly `min`, so every "up to N" was answered with
 * nothing.
 *
 * The generator is SIGN-AGNOSTIC: these tests pin the shape of what it emits
 * (the decline, the cardinality ladder, ownership as a tie-break and never a
 * filter, the as-enters exclusion) — never which answer is best, which is the
 * search's to score and the blade entries' to assert.
 */

import { describe, expect, it } from "vitest";
import {
    CHOICE_CANDIDATE_GENERATORS,
    isSearchableChoiceNode,
} from "../choiceCandidates";
import { applyMoveInSearch, settleStackForBreakdown } from "../../search";
import { enumerateMoves } from "../../moves";
import { buildBladeState } from "../blade/runner";
import { getCardByName } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import { cloneGameState } from "../../clone";
import type { GameState, PendingChoice } from "../../state";
import {
    emitPermanentTapped,
    processPendingActionTriggers,
    resolveTopOfStack,
    tapPermanent,
} from "../../state";
import type { BladeScenario } from "../blade/types";

const generate = CHOICE_CANDIDATE_GENERATORS["choose-permanents"]!;

function ids(candidate: { move: unknown }): string[] {
    return (
        (candidate.move as { cardInstanceIds?: string[] }).cardInstanceIds ?? []
    );
}

/** Two tapped Forests on each side — equal worth, so ownership is the only
 *  thing that can order them. */
function mirroredLands(): GameState {
    const lands = (owner: string) =>
        [1, 2].map((n) =>
            makeInstance(getCardByName("Forest").id, {
                id: `${owner}-forest-${n}`,
                controllerId: owner,
                ownerId: owner,
                isTapped: true,
            })
        );
    return makeState({
        players: [
            makePlayer("p1", { battlefield: lands("p1") }),
            makePlayer("p2", { battlefield: lands("p2") }),
        ],
    });
}

function untapChoice(overrides: Partial<PendingChoice> = {}): PendingChoice {
    return {
        kind: "choose-permanents",
        stackItemId: "s1",
        step: 0,
        choiceId: "c1",
        playerId: "p1",
        zone: "battlefield",
        allControllers: true,
        filter: { types: "Land" },
        count: { min: 0, max: 2 },
        prompt: "Untap up to two lands.",
        ...overrides,
    } as PendingChoice;
}

describe("choose-permanents candidate generator (issue #3545)", () => {
    it("seeds own-side sets first on an all-controllers pool, and still emits an opponent-side branch", () => {
        const state = mirroredLands();
        const candidates = generate(state, untapChoice());
        const side = (id: string) => (id.startsWith("p1-") ? "mine" : "theirs");
        const acting = candidates.filter((c) => ids(c).length > 0);
        expect(acting.length).toBeGreaterThan(0);

        // The first acting branch is all own-side …
        expect(ids(acting[0]).every((id) => side(id) === "mine")).toBe(true);
        // … an opponent-side branch exists — a branch the generator never
        // produces is one whose rejection cannot be demonstrated …
        expect(
            acting.some((c) => ids(c).some((id) => side(id) === "theirs"))
        ).toBe(true);
        // … and at every cardinality, the own-side set is seeded ahead of any
        // set reaching the opponent's side (ownership is the tie-break at
        // equal worth, never a filter).
        for (const size of new Set(acting.map((c) => ids(c).length))) {
            const sameSize = acting.filter((c) => ids(c).length === size);
            const firstTheirs = sameSize.findIndex((c) =>
                ids(c).some((id) => side(id) === "theirs")
            );
            if (firstTheirs === -1) continue;
            expect(
                ids(sameSize[0]).every((id) => side(id) === "mine"),
                `size ${size}`
            ).toBe(true);
        }
    });

    it("emits the decline whenever min <= 0, and never when min > 0", () => {
        const state = mirroredLands();
        const declines = (choice: PendingChoice) =>
            generate(state, choice).filter((c) => ids(c).length === 0).length;
        expect(declines(untapChoice({ count: { min: 0, max: 2 } }))).toBe(1);
        expect(declines(untapChoice({ count: 1 }))).toBe(0);
        expect(declines(untapChoice({ count: { min: 1, max: 2 } }))).toBe(0);
    });

    it("walks the cardinality ladder: an intermediate size is offered, not just the decline and max", () => {
        // Magnetic Mountain's shape — pay per creature chosen. With mana for
        // one payment, only a size-1 answer does anything, so a generator that
        // emitted only `{0, max}` would reproduce the bug in a new form.
        const state = mirroredLands();
        const sizes = new Set(
            generate(
                state,
                untapChoice({
                    allControllers: undefined,
                    count: { min: 0, max: 2 },
                })
            ).map((c) => ids(c).length)
        );
        expect([...sizes].sort()).toEqual([0, 1, 2]);
    });

    it("an as-enters choice is not a node: the copy family keeps its brain.ts policy", () => {
        const state = mirroredLands();
        const asEnters = untapChoice({
            stackItemId: "",
            asEntersCardId: "clone-1",
            asEntersKind: "copy",
        } as Partial<PendingChoice>);
        expect(isSearchableChoiceNode(asEnters)).toBe(false);
        expect(generate(state, asEnters)).toEqual([]);
        // The same choice mid-resolution IS one.
        expect(isSearchableChoiceNode(untapChoice())).toBe(true);
    });
});

describe("the settle gets past a MANDATORY choose-permanents owed to the mover (issue #3545)", () => {
    /** Kudzu on the bot's Forest, beside a Taiga. The Forest becomes tapped
     *  through the engine's own tap + event + trigger drain (CR 701.26a /
     *  603.2), Kudzu's trigger resolves, destroys it, and — once the may-pay
     *  is accepted — asks the bot for a land to re-attach to (`count: 1`). */
    function atKudzuReattach(): { state: GameState; botId: string } {
        const scenario = {
            label: "issue #3545 kudzu settle",
            spec: {
                cards: [
                    { name: "Forest", owner: "me", zone: "battlefield" },
                    { name: "Taiga", owner: "me", zone: "battlefield" },
                    {
                        name: "Kudzu",
                        owner: "me",
                        zone: "battlefield",
                        attachedTo: "Forest",
                    },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                landCount: 0,
                libraryCount: 20,
            },
            bot: "me",
            budget: { iterations: 1 },
            seeds: [0],
            tier: "must",
            expect: { forbidden: [] },
        } as unknown as BladeScenario;
        const state = buildBladeState(scenario);
        const botId = state.players[0].id;
        const forest = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id === getCardByName("Forest").id
        )!;
        tapPermanent(state, forest);
        emitPermanentTapped(state, forest, false);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        const accept = enumerateMoves(state, botId).find(
            (m) => m.kind === "may-pay" && m.accept
        );
        if (!accept) throw new Error("no accept for Kudzu's may-pay");
        applyMoveInSearch(state, botId, accept);
        expect(state.pendingChoices?.[0]?.kind).toBe("choose-permanents");
        expect(state.pendingChoices?.[0]?.playerId).toBe(botId);
        return { state, botId };
    }

    it("completes where it used to stop", () => {
        const { state, botId } = atKudzuReattach();
        const head = state.pendingChoices![0];
        expect(head.count).toBe(1);
        // The mover's own mandatory pick now has a branch to take — the one
        // land left (the destroyed host is out of the pool).
        const taigaId = getCardByName("Taiga").id;
        const offered = generate(state, head).map(ids);
        expect(offered).toHaveLength(1);
        expect(
            state.players[0].battlefield.find((c) => c.id === offered[0][0])
                ?.card
        ).toMatchObject({ id: taigaId });

        // Before issue #3545 this bailed: no candidates for the head choice,
        // so `bestBranchThroughChoice` returned null and the report said
        // incomplete.
        const report = { complete: false };
        const settled = settleStackForBreakdown(
            cloneGameState(state),
            botId,
            undefined,
            0,
            undefined,
            0,
            report
        );
        expect(report.complete).toBe(true);
        expect(settled.pendingChoices ?? []).toHaveLength(0);
        expect(settled.stack).toHaveLength(0);
    });
});
