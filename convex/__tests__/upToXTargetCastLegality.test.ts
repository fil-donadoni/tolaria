// CR 601.2c — a min-0 target requirement ("destroy up to X target
// artifacts...", "destroy up to two target..."), the genuinely optional
// variable target count, must remain castable even with ZERO legal targets
// on the board: the caster can always announce the spell choosing zero of
// them. Issue #2369 review round 1 (PR #2455) found this was NOT true —
// `announceCast` (convex/game.ts) threw "No legal targets available" for a
// `{ min: 0, max }` requirement whenever `getLegalTargets` came back empty,
// even though the requirement's OWN minimum was zero. The sibling checks
// already got this right: `hasEnoughLegalTargets`'s `required <= 0` early
// return (gre/rules.ts) and the client hint's identical guard
// (src/lib/card-utils.ts) — `game.ts` was the single divergent site, and it
// is the one every real cast goes through, so it silently made Pest
// Infestation's headline "destroy up to X" line uncastable on an empty
// board and broke the pre-existing Force of Vigor identically.
//
// This is a BUG CLASS fix (game.ts's `requiresTargets` / legal-target-count
// ordering), not a Pest-Infestation-only one — both cards exercise it here
// as two independent card-level proofs of the same engine fix. Same harness
// discipline as `distinctTargets.test.ts` / `delveCastCost.test.ts`: no
// convex-test harness in this project, so the established seam for `game.ts`
// integration coverage is a stub `MutationCtx` driving the REGISTERED
// mutation's own `_handler` (`gameMutationHarness.ts`) — never a hand-rolled
// reimplementation of `announceCast`'s loop body.

import { describe, it, expect } from "vitest";
import { announceCast } from "../game";
import { pestInfestation } from "../cards/sets/c21/green";
import { forceOfVigor } from "../cards/sets/mh1/green";
import { forest, ankhOfMishra } from "../cards/sets/lea/colorless";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    chosenX?: number;
};

const runAnnounceCast = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<AnnounceCastArgs, "gameId" | "playerId">
) =>
    runMutation<AnnounceCastArgs, void>(
        announceCast as unknown as Handler<AnnounceCastArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

/** p1 holds `cardId` with `lands` untapped Forests to pay for it — enough
 *  green + generic sources for both Pest Infestation's `{X}{X}{G}` (X up to
 *  3) and Force of Vigor's fixed `{2}{G}{G}`. p2's battlefield is whatever
 *  the scenario needs (empty for the "no legal targets" cases). */
function board(
    cardId: string,
    p2Battlefield: ReturnType<typeof makeInstance>[] = []
) {
    const spell = makeInstance(cardId, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const lands = Array.from({ length: 6 }, (_, i) =>
        makeInstance(forest.id, {
            id: `forest-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { hand: [spell], battlefield: lands }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state };
}

describe("announceCast — a min-0 'up to X' / 'up to N' requirement stays legal with zero legal targets (CR 601.2c, issue #2369)", () => {
    it("Pest Infestation: X = 3, no artifacts/enchantments on the board — does not throw, enters target selection with an empty candidate set", async () => {
        const { state } = board(pestInfestation.id);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAnnounceCast(harness.ctx, {
            cardInstanceId: "spell",
            chosenX: 3,
        });

        const pt = harness.state().pendingTarget;
        expect(pt).toBeDefined();
        expect(pt?.count).toEqual({ min: 0, max: 3 });
        expect(pt?.selected).toEqual([]);
    });

    it("Pest Infestation: X = 0, no artifacts/enchantments on the board — does not throw", async () => {
        const { state } = board(pestInfestation.id);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAnnounceCast(harness.ctx, {
            cardInstanceId: "spell",
            chosenX: 0,
        });

        // X = 0 resolves the requirement to { min: 0, max: 0 } — nothing to
        // target either way, so no throw regardless of board state.
        expect(
            harness.state().pendingCast ?? harness.state().stack.length
        ).toBeTruthy();
    });

    it("Force of Vigor: no artifacts/enchantments on the board — does not throw (pre-existing bug, same fix site)", async () => {
        const { state } = board(forceOfVigor.id);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAnnounceCast(harness.ctx, { cardInstanceId: "spell" });

        const pt = harness.state().pendingTarget;
        expect(pt).toBeDefined();
        expect(pt?.count).toEqual({ min: 0, max: 2 });
        expect(pt?.selected).toEqual([]);
    });

    it('Pest Infestation: "up to X" with fewer legal targets than X (X = 3, one artifact) is still legal to announce', async () => {
        const onlyArtifact = makeInstance(ankhOfMishra.id, {
            id: "scarce-artifact",
            controllerId: "p2",
            ownerId: "p2",
        });
        const { state } = board(pestInfestation.id, [onlyArtifact]);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAnnounceCast(harness.ctx, {
            cardInstanceId: "spell",
            chosenX: 3,
        });

        const pt = harness.state().pendingTarget;
        expect(pt).toBeDefined();
        expect(pt?.count).toEqual({ min: 0, max: 3 });
    });
});

describe("announceCast — X = 0 with a legal target present skips target selection entirely (issue #2369 review round 1, minor)", () => {
    it("Pest Infestation: X = 0 with an artifact on the board never opens a { min: 0, max: 0 } target-selection banner", async () => {
        const artifact = makeInstance(ankhOfMishra.id, {
            id: "present-artifact",
            controllerId: "p2",
            ownerId: "p2",
        });
        const { state } = board(pestInfestation.id, [artifact]);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAnnounceCast(harness.ctx, {
            cardInstanceId: "spell",
            chosenX: 0,
        });

        expect(harness.state().pendingTarget).toBeUndefined();
    });
});
