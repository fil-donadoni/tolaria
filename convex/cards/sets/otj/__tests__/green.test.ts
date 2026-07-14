// Per-card test for otj/green.ts — Bristly Bill, Spine Sower, the first card of
// the Landfall CAP (issue #694). Bristly Bill's landfall clause uses an
// imperative `resolve` with a suspending `choose-permanents` choice
// (allControllers targeting is a documented DSL gap, cf. Aura Shards), so it
// earns a hand-written test per `.claude/rules/gre-development.md`. The
// activated ability is DSL but its outcome (doubled +1/+1 counters) is visible
// on the board, so a wire-format assertion through `projectPublicState` is
// mandatory.

import { describe, it, expect } from "vitest";
import { bristlyBillSpineSower } from "../green";
import { swamp, grizzlyBears } from "../../lea";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { getEffectivePower, getEffectiveToughness } from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { GameState, StackItem } from "../../../../gre/state";

/** Pushes an activated ability onto the stack with its cost assumed already
 *  paid (mirrors post-`activateAbility` state), then resolves it. Mirrors the
 *  established `resolveActivated` shim (`sets/tla/__tests__/colorless.test.ts`). */
function resolveActivated(
    state: GameState,
    sourceId: string,
    controllerId: string,
    abilityId: string
): void {
    const source = state.players
        .find((p) => p.id === controllerId)!
        .battlefield.find((c) => c.id === sourceId)!;
    const item: StackItem = {
        ...source,
        zone: "stack",
        castById: controllerId,
        abilityId,
        targets: [],
    };
    state.stack.push(item);
    resolveTopOfStack(state);
}

/** Synthesizes the PERMANENT_ENTERED event a land drop emits (CR 603.6a). */
function landEntered(instanceId: string, controllerId: string) {
    return {
        type: "PERMANENT_ENTERED" as const,
        instanceId,
        controllerId,
        cardId: swamp.id,
        types: ["Land"] as const,
    };
}

describe("Bristly Bill, Spine Sower — Landfall (CR 603.6a / 109.2)", () => {
    it("landfall: a land YOU control entering triggers, then a +1/+1 counter goes on the chosen creature", () => {
        const bill = makeInstance(bristlyBillSpineSower.id, {
            id: "bill",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(swamp.id, { id: "land1", controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bill, bear, land] }),
                makePlayer("p2"),
            ],
        });

        const triggers = collectTriggers(state, [landEntered("land1", "p1")]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);

        // The mandatory "target creature" pick suspends for player input.
        expect(resolveTopOfStack(state)).toBeNull();
        const pending = state.pendingChoices![0];
        expect(pending.kind).toBe("choose-permanents");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pending.stackItemId,
            step: pending.step,
            choiceId: pending.choiceId,
            cardInstanceIds: ["bear"],
        });

        const bearLive = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearLive.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, bearLive)).toBe(3);
        expect(getEffectiveToughness(state, bearLive)).toBe(3);
    });

    it("landfall: an OPPONENT's land entering does NOT trigger (CR 109.2 — you control)", () => {
        const bill = makeInstance(bristlyBillSpineSower.id, {
            id: "bill",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bill] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [landEntered("oland", "p2")]);
        expect(triggers).toHaveLength(0);
    });

    it("wire format: the landfall +1/+1 counter survives projectPublicState", () => {
        const bill = makeInstance(bristlyBillSpineSower.id, {
            id: "bill",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(swamp.id, { id: "land1", controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bill, bear, land] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push(
            ...collectTriggers(state, [landEntered("land1", "p1")])
        );
        resolveTopOfStack(state);
        const pending = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pending.stackItemId,
            step: pending.step,
            choiceId: pending.choiceId,
            cardInstanceIds: ["bear"],
        });

        const projected = projectPublicState(state, 1, "p1");
        const bearLive = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, bearLive)).toBe(3);
    });
});

describe("Bristly Bill — {3}{G}{G}: double +1/+1 counters on each creature you control (CR 122.6)", () => {
    it("doubles counters on your creatures only, leaving the opponent's untouched", () => {
        const bill = makeInstance(bristlyBillSpineSower.id, {
            id: "bill",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 3 },
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 1 },
        });
        // A creature with no counters stays at zero (double of 0 is 0).
        const cub = makeInstance(grizzlyBears.id, {
            id: "cub",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppBear = makeInstance(grizzlyBears.id, {
            id: "opp-bear",
            controllerId: "p2",
            ownerId: "p2",
            counters: { "+1/+1": 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bill, bear, cub] }),
                makePlayer("p2", { battlefield: [oppBear] }),
            ],
        });

        resolveActivated(state, "bill", "p1", "bristly-bill-double-counters");

        const live = (pid: number, id: string) =>
            state.players[pid].battlefield.find((c) => c.id === id)!;
        expect(live(0, "bill").counters?.["+1/+1"]).toBe(6);
        expect(live(0, "bear").counters?.["+1/+1"]).toBe(2);
        expect(live(0, "cub").counters?.["+1/+1"] ?? 0).toBe(0);
        // Opponent's creature is untouched — "each creature YOU control".
        expect(live(1, "opp-bear").counters?.["+1/+1"]).toBe(2);
    });

    it("wire format: doubled counters survive projectPublicState", () => {
        const bill = makeInstance(bristlyBillSpineSower.id, {
            id: "bill",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bill, bear] }),
                makePlayer("p2"),
            ],
        });

        resolveActivated(state, "bill", "p1", "bristly-bill-double-counters");

        const projected = projectPublicState(state, 1, "p1");
        const bearLive = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        // 2 → 4 counters ⇒ base 2/2 becomes 6/6.
        expect(getEffectivePower(projected, bearLive)).toBe(6);
        expect(getEffectiveToughness(projected, bearLive)).toBe(6);
    });
});
