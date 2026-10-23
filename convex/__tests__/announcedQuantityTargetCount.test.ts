/**
 * CR 601.2c / 107.3 (issue #6526) — a target count whose bound is DEFINED BY
 * THE SPELL'S TEXT and read off the board at announcement, against a target an
 * earlier group already chose: Reap's "Return up to X target cards from your
 * graveyard to your hand, where X is the number of black permanents target
 * opponent controls as you cast this spell".
 *
 * Driven through the REAL path: the `announceCast` / `selectTargets` /
 * `confirmTargets` mutation handlers, the wire projection, then
 * `resolveTopOfStack`. The definition is hand-written — its Grammar Rule is
 * issue #5703's — but every shape in it is one the engine authors.
 *
 * CR 601.2c: "In some cases, the number of targets will be defined by the
 * spell's text. Once the number of targets the spell has is determined, that
 * number doesn't change, even if the information used to determine the number
 * of targets does."
 */

import { describe, expect, it } from "vitest";
import { withTemporaryDefinitionAsync } from "../cards";
import { announceCast, confirmTargets, selectTargets } from "../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";
import type { Id } from "../_generated/dataModel";
import { resolveTopOfStack } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import {
    REAP_SHAPE,
    REAP_SPELL_ID as SPELL,
    reapBoard,
} from "./announcedQuantityTargetCount.fixture";

const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

type Harness = ReturnType<typeof makeMutationCtx>;

const run = (handler: unknown, harness: Harness, args: object) =>
    runMutation(
        handler as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, ...args }
    );

const pickOpponent = (harness: Harness) =>
    run(selectTargets, harness, {
        targets: [{ targetType: "player", targetId: "p2" }],
    });

const pickCards = (harness: Harness, ids: string[]) =>
    run(selectTargets, harness, {
        targets: ids.map((targetId) => ({
            targetType: "graveyard-card",
            targetId,
            targetPlayerId: "p1",
        })),
    });

describe("target count bounded by a quantity read at announcement (CR 601.2c, issue #6526)", () => {
    it("reads X off the opponent the FIRST group chose, once that group is in", async () => {
        await withTemporaryDefinitionAsync(REAP_SHAPE, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(reapBoard(2)),
            ]);
            await run(announceCast, harness, { cardInstanceId: SPELL });
            expect(harness.state().pendingTarget?.targetType).toBe("player");

            await pickOpponent(harness);
            const open = harness.state().pendingTarget;
            expect(open?.zone).toBe("graveyard");
            // Two Black Knights, the green bear not counted.
            expect(open?.count).toEqual({ min: 0, max: 2 });
            // SURFACE: the bound the client caps the picks at is the resolved
            // number — the projection carries it, never the quantity.
            const view = projectPublicState(harness.state(), 1, "p1");
            expect(view.pendingTarget?.count).toEqual({ min: 0, max: 2 });
        });
    });

    it("keeps X fixed once determined: a Knight leaving does not shrink the count", async () => {
        await withTemporaryDefinitionAsync(REAP_SHAPE, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(reapBoard(2)),
            ]);
            await run(announceCast, harness, { cardInstanceId: SPELL });
            await pickOpponent(harness);
            // The information the count was derived from changes mid-cast.
            const p2 = harness.state().players[1]!;
            p2.battlefield = p2.battlefield.filter((c) => c.id !== "knight-0");

            await pickCards(harness, ["gy-a"]);
            expect(harness.state().pendingTarget?.selected).toHaveLength(1);
            // The second pick fills the max of 2 and finalizes the selection.
            await pickCards(harness, ["gy-b"]);
            const state = harness.state();
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack[0]!.targets).toEqual([
                { type: "player", id: "p2" },
                { type: "graveyard-card", id: "gy-a", playerId: "p1" },
                { type: "graveyard-card", id: "gy-b", playerId: "p1" },
            ]);
            resolveTopOfStack(state);
            expect(state.players[0]!.hand.map((c) => c.id).sort()).toEqual([
                "gy-a",
                "gy-b",
            ]);
            expect(state.players[0]!.graveyard.map((c) => c.id)).toContain(
                "gy-c"
            );
        });
    });

    it("caps the picks at X: the selection closes at the X-th pick", async () => {
        await withTemporaryDefinitionAsync(REAP_SHAPE, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(reapBoard(1)),
            ]);
            await run(announceCast, harness, { cardInstanceId: SPELL });
            await pickOpponent(harness);
            expect(harness.state().pendingTarget?.count).toEqual({
                min: 0,
                max: 1,
            });
            // A batch longer than X stops where the selection finalized.
            await pickCards(harness, ["gy-a", "gy-b"]);
            const state = harness.state();
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack[0]!.targets).toEqual([
                { type: "player", id: "p2" },
                { type: "graveyard-card", id: "gy-a", playerId: "p1" },
            ]);
        });
    });

    it("a confirm closes the group below X", async () => {
        await withTemporaryDefinitionAsync(REAP_SHAPE, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(reapBoard(2)),
            ]);
            await run(announceCast, harness, { cardInstanceId: SPELL });
            await pickOpponent(harness);
            await pickCards(harness, ["gy-c"]);
            await run(confirmTargets, harness, {});
            const state = harness.state();
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack[0]!.targets).toEqual([
                { type: "player", id: "p2" },
                { type: "graveyard-card", id: "gy-c", playerId: "p1" },
            ]);
        });
    });

    it("X = 0 opens no graveyard selection: the walk moves straight on", async () => {
        await withTemporaryDefinitionAsync(REAP_SHAPE, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(reapBoard(0)),
            ]);
            await run(announceCast, harness, { cardInstanceId: SPELL });
            await pickOpponent(harness);
            const state = harness.state();
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack[0]!.targets).toEqual([
                { type: "player", id: "p2" },
            ]);
        });
    });
});
