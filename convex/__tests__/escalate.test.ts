/**
 * Escalate (CR 702.120a, issue #2267) — "For each mode you choose beyond the
 * first as you cast this spell, you pay an additional [cost]." Driven through
 * the REAL cast path with Collective Brutality: the `announceCast` and
 * `selectTargets` mutation handlers, the cast's hand-cost park, the commit,
 * `resolveTopOfStack`, the wire projection and the persistence round trip.
 *
 * The card is registered free of mana (`manaCost: {}`) so the only cost the
 * cast owes is the escalate discard under test.
 */

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { collectiveBrutality } from "../cards/sets/emn/black.cards";
import {
    grizzlyBears,
    lightningBolt,
    plains,
} from "../cards/sets/lea/index.cards";
import { withTemporaryDefinitionAsync } from "../cards";
import {
    announceCast,
    recordCastAlternativeHandCostPick,
    selectTargets,
    tryAutoCommitPendingCast,
} from "../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";
import type { Id } from "../_generated/dataModel";
import { getPlayer, resolveTopOfStack, type GameState } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import { applyPendingChoiceSubmit } from "../gre/pendingChoiceSubmit";
import { compactState, expandState } from "../gre/serialize";

const SPELL = "brutality";
const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };
const FREE_BRUTALITY = () => ({ ...collectiveBrutality(), manaCost: {} });

/** p1 holds Collective Brutality plus `spare` Plains; p2 holds a Lightning
 *  Bolt and a Plains and controls a Grizzly Bears. */
function board(spare: number): GameState {
    const mine = (id: string, cardId: string, zone: "hand" | "library") =>
        makeInstance(cardId, { id, controllerId: "p1", ownerId: "p1", zone });
    const theirs = (id: string, cardId: string, zone: "hand" | "battlefield") =>
        makeInstance(cardId, { id, controllerId: "p2", ownerId: "p2", zone });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    mine(SPELL, collectiveBrutality().id, "hand"),
                    ...Array.from({ length: spare }, (_, i) =>
                        mine(`spare${i}`, plains().id, "hand")
                    ),
                ],
                library: Array.from({ length: 5 }, (_, i) =>
                    mine(`lib-${i}`, plains().id, "library")
                ),
            }),
            makePlayer("p2", {
                hand: [
                    theirs("bolt", lightningBolt().id, "hand"),
                    theirs("p2-plains", plains().id, "hand"),
                ],
                battlefield: [
                    theirs("bears", grizzlyBears().id, "battlefield"),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

async function announce(
    harness: ReturnType<typeof makeMutationCtx>,
    chosenModeIds: string[],
    kickerPayments?: Record<string, number>
): Promise<void> {
    await runMutation(
        announceCast as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        {
            ...BASE,
            cardInstanceId: SPELL,
            chosenModeIds,
            ...(kickerPayments ? { kickerPayments } : {}),
        }
    );
}

/** Targets in printed mode order: duress → p2, shrink → bears, drain → p2. */
async function target(
    harness: ReturnType<typeof makeMutationCtx>,
    modes: string[]
): Promise<void> {
    const pick: Record<string, { targetType: string; targetId: string }> = {
        duress: { targetType: "player", targetId: "p2" },
        shrink: { targetType: "permanent", targetId: "bears" },
        drain: { targetType: "player", targetId: "p2" },
    };
    await runMutation(
        selectTargets as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, targets: modes.map((m) => pick[m]) }
    );
}

describe("Escalate — Collective Brutality through the real cast path (CR 702.120a)", () => {
    it("ONE mode owes no escalate cost: nothing parks, nothing is discarded", async () => {
        await withTemporaryDefinitionAsync(FREE_BRUTALITY(), async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board(2))]);
            await announce(harness, ["drain"]);
            await target(harness, ["drain"]);
            const state = harness.state();
            expect(state.pendingCast).toBeUndefined();
            expect(state.stack).toHaveLength(1);
            expect(state.stack[0].unkickedCostPayments).toBeUndefined();
            expect(getPlayer(state, "p1").graveyard).toHaveLength(0);
            expect(getPlayer(state, "p1").hand).toHaveLength(2);
        });
    });

    it("THREE modes owe two discards — the count is written from the mode list, paid, and every mode resolves", async () => {
        await withTemporaryDefinitionAsync(FREE_BRUTALITY(), async () => {
            // Three spare cards for two discards: a real choice, so it parks.
            const harness = makeMutationCtx("p1", [gameStateSeed(board(3))]);
            // The caster names the modes only — no escalate count is sent.
            await announce(harness, ["drain", "duress", "shrink"]);
            await target(harness, ["duress", "shrink", "drain"]);
            const state = harness.state();
            // CR 601.2h — the cast parks on the combined hand picker for TWO
            // cards (one per mode beyond the first), never the spell itself.
            const choice = state.pendingCast?.alternativeCostHandChoice;
            expect(choice?.action).toBe("discard");
            expect(choice?.requirements.reduce((n, r) => n + r.count, 0)).toBe(
                2
            );
            expect(choice?.excludeInstanceId).toBe(SPELL);
            // The client sees the same picker (wire format).
            expect(
                projectPublicState(state, 1, "p1").pendingCast
                    ?.alternativeCostHandChoice?.requirements
            ).toEqual(choice?.requirements);

            recordCastAlternativeHandCostPick(state, "p1", [
                "spare0",
                "spare1",
            ]);
            tryAutoCommitPendingCast(state, "p1");
            expect(state.stack).toHaveLength(1);
            const item = state.stack[0];
            // CR 702.33d — escalate is never "kicked": the payment rides the
            // unkicked record, invisible to every kicked-ness reader.
            expect(item.unkickedCostPayments).toEqual({ escalate: 2 });
            expect(item.kickerPayments).toBeUndefined();
            expect(
                expandState(compactState(state)).stack[0].unkickedCostPayments
            ).toEqual({ escalate: 2 });
            expect(
                getPlayer(state, "p1")
                    .graveyard.map((c) => c.id)
                    .sort()
            ).toEqual(["spare0", "spare1"]);

            // CR 608.2c — modes resolve in printed order.
            resolveTopOfStack(state);
            const choice2 = state.pendingChoices?.[0];
            expect(choice2?.kind).toBe("choose-hand-card");
            applyPendingChoiceSubmit(state, {
                playerId: choice2!.playerId,
                stackItemId: choice2!.stackItemId,
                step: choice2!.step,
                choiceId: choice2!.choiceId,
                cardInstanceIds: ["bolt"],
            });
            expect(state.pendingChoices ?? []).toHaveLength(0);
            const p2 = getPlayer(state, "p2");
            expect(p2.graveyard.map((c) => c.id)).toContain("bolt");
            expect(p2.graveyard.map((c) => c.id)).toContain("bears");
            expect(p2.life).toBe(18);
            expect(getPlayer(state, "p1").life).toBe(22);
        });
    });

    it("a FORCED discard (exactly two spare cards for two extra modes) auto-resolves — no picker parks", async () => {
        await withTemporaryDefinitionAsync(FREE_BRUTALITY(), async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board(2))]);
            await announce(harness, ["duress", "shrink", "drain"]);
            await target(harness, ["duress", "shrink", "drain"]);
            const state = harness.state();
            expect(state.pendingCast).toBeUndefined();
            expect(state.stack).toHaveLength(1);
            expect(state.stack[0].unkickedCostPayments).toEqual({
                escalate: 2,
            });
            expect(
                getPlayer(state, "p1")
                    .graveyard.map((c) => c.id)
                    .sort()
            ).toEqual(["spare0", "spare1"]);
        });
    });

    it("CR 601.2h — a mode count the hand cannot pay for is refused at announcement", async () => {
        await withTemporaryDefinitionAsync(FREE_BRUTALITY(), async () => {
            // One spare card pays for two modes, not three.
            const harness = makeMutationCtx("p1", [gameStateSeed(board(1))]);
            await expect(
                announce(harness, ["duress", "shrink", "drain"])
            ).rejects.toThrow(/Can't pay the kicker cost/);
            await announce(harness, ["shrink", "drain"]);
            expect(harness.state().pendingTarget?.kickerPayments).toEqual({
                escalate: 1,
            });
        });
    });

    it("an escalate count that contradicts the announced modes is refused", async () => {
        await withTemporaryDefinitionAsync(FREE_BRUTALITY(), async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board(2))]);
            await expect(
                announce(harness, ["duress", "shrink", "drain"], {
                    escalate: 1,
                })
            ).rejects.toThrow(/Escalate is paid once for each mode/);
            await expect(
                announce(harness, ["drain"], { escalate: 1 })
            ).rejects.toThrow(/Escalate is paid once for each mode/);
        });
    });
});
