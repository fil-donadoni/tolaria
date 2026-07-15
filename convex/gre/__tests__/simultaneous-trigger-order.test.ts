// CR 603.3b (ADR 0058) — a player orders their own simultaneously-triggering
// abilities on the stack in any order they choose. These tests drive the shared
// placement helper (`placeTriggersOnStack`) and the submit path
// (`applyPendingChoiceSubmit`) directly, then the wire projection + serialization
// seams the choice must survive.

import { describe, it, expect } from "vitest";
import { makeState, makePlayer } from "../../cards/__tests__/setup";
import type { GameState, StackItem } from "../state";
import { placeTriggersOnStack, TRIGGER_BATCH_STACK_ID } from "../triggers";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";

// A real registered creature id (art anchor); the helper only reads `id`,
// `controllerId`, `card.id`, `triggeredAbilityId`.
const CARD_A = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";
const CARD_B = "55fe6449-1f23-43dc-adee-d144cd505b5c";

/** A minimal triggered-ability StackItem as `collectTriggers` would build it. */
function mkTrigger(
    id: string,
    controllerId: string,
    cardId: string,
    abilityId: string
): StackItem {
    return {
        id,
        card: { id: cardId },
        controllerId,
        ownerId: controllerId,
        castById: controllerId,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        triggeredAbilityId: abilityId,
        triggerSourceId: `src-${id}`,
    };
}

function baseState(): GameState {
    return makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("simultaneous triggered-ability ordering (CR 603.3b, ADR 0058)", () => {
    it("auto-orders a slice of identical target-less triggers (no prompt)", () => {
        const state = baseState();
        // Two copies of the SAME printed ability under one controller — swapping
        // is outcome-identical, so ADR 0003 auto-resolves the ordering.
        const triggers = [
            mkTrigger("t1", "p1", CARD_A, "on-dies"),
            mkTrigger("t2", "p1", CARD_A, "on-dies"),
        ];
        const landed = placeTriggersOnStack(state, triggers);

        expect(landed).toBe(true);
        expect(state.stack.map((s) => s.id)).toEqual(["t1", "t2"]);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.pendingTriggerBatch).toBeUndefined();
    });

    it("a single trigger never prompts", () => {
        const state = baseState();
        const landed = placeTriggersOnStack(state, [
            mkTrigger("t1", "p1", CARD_A, "on-dies"),
        ]);
        expect(landed).toBe(true);
        expect(state.stack.map((s) => s.id)).toEqual(["t1"]);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("prompts the controller to order two DISTINCT simultaneous triggers", () => {
        const state = baseState();
        const triggers = [
            mkTrigger("t1", "p1", CARD_A, "ability-a"),
            mkTrigger("t2", "p1", CARD_B, "ability-b"),
        ];
        const landed = placeTriggersOnStack(state, triggers);

        expect(landed).toBe(false);
        // Nothing on the stack yet — the batch waits off-stack (never observed
        // half-ordered).
        expect(state.stack).toHaveLength(0);
        expect(state.pendingTriggerBatch?.map((s) => s.id)).toEqual([
            "t1",
            "t2",
        ]);
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("trigger-order");
        expect(head.playerId).toBe("p1");
        expect(head.stackItemId).toBe(TRIGGER_BATCH_STACK_ID);
        expect(head.candidateIds).toEqual(["t1", "t2"]);
        expect(head.count).toBe(2);
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("lands the batch with the submitted top-of-stack-first order", () => {
        const state = baseState();
        placeTriggersOnStack(state, [
            mkTrigger("t1", "p1", CARD_A, "ability-a"),
            mkTrigger("t2", "p1", CARD_B, "ability-b"),
        ]);
        const head = state.pendingChoices![0];
        // Chooser wants t2 to resolve FIRST (topmost), then t1.
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["t2", "t1"],
        });

        // Stack top = last element resolves first → t2 must be on top.
        expect(state.stack.map((s) => s.id)).toEqual(["t1", "t2"]);
        expect(state.pendingTriggerBatch).toBeUndefined();
        expect(state.pendingChoices).toBeUndefined();
        expect(state.priorityPlayerId).toBe("p1"); // active player
        expect(state.passCount).toBe(0);
    });

    it("orders both players APNAP: active player's slice on the bottom (resolves last)", () => {
        const state = baseState();
        // p1 (active) and p2 each control two distinct simultaneous triggers.
        placeTriggersOnStack(state, [
            mkTrigger("a1", "p1", CARD_A, "ability-a"),
            mkTrigger("a2", "p1", CARD_B, "ability-b"),
            mkTrigger("b1", "p2", CARD_A, "ability-a"),
            mkTrigger("b2", "p2", CARD_B, "ability-b"),
        ]);

        // Two ordering choices, active player first (FIFO = APNAP).
        expect(state.pendingChoices!.map((c) => c.playerId)).toEqual([
            "p1",
            "p2",
        ]);

        // p1 orders a2-first (topmost of their block).
        const h1 = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: h1.stackItemId,
            step: h1.step,
            choiceId: h1.choiceId,
            cardInstanceIds: ["a2", "a1"],
        });
        // Still suspended on p2's ordering; nothing on the stack yet.
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.priorityPlayerId).toBe("p2");

        // p2 orders b1-first.
        const h2 = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: h2.stackItemId,
            step: h2.step,
            choiceId: h2.choiceId,
            cardInstanceIds: ["b1", "b2"],
        });

        // Bottom→top: p1 block (resolve last), then p2 block (resolve first).
        // Within p1: a2 on top of its block (resolves first among p1's).
        // Within p2: b1 on top overall (resolves first of everything).
        expect(state.stack.map((s) => s.id)).toEqual(["a1", "a2", "b2", "b1"]);
        expect(state.pendingTriggerBatch).toBeUndefined();
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("rejects a submission that is not a permutation of the slice", () => {
        const state = baseState();
        placeTriggersOnStack(state, [
            mkTrigger("t1", "p1", CARD_A, "ability-a"),
            mkTrigger("t2", "p1", CARD_B, "ability-b"),
        ]);
        const head = state.pendingChoices![0];
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["t1", "t1"], // duplicate, not a permutation
            })
        ).toThrow();
    });

    it("auto-orders a mixed batch where only one controller owes a decision", () => {
        const state = baseState();
        // p1 has two identical (auto), p2 has one (no decision) → no prompt.
        const landed = placeTriggersOnStack(state, [
            mkTrigger("a1", "p1", CARD_A, "on-dies"),
            mkTrigger("a2", "p1", CARD_A, "on-dies"),
            mkTrigger("b1", "p2", CARD_B, "on-dies"),
        ]);
        expect(landed).toBe(true);
        expect(state.stack.map((s) => s.id)).toEqual(["a1", "a2", "b1"]);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("survives the wire projection (batch slimmed, choice public)", () => {
        const state = baseState();
        placeTriggersOnStack(state, [
            mkTrigger("t1", "p1", CARD_A, "ability-a"),
            mkTrigger("t2", "p1", CARD_B, "ability-b"),
        ]);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingTriggerBatch?.map((s) => s.id)).toEqual([
            "t1",
            "t2",
        ]);
        // Slimmed to `{ id }` — no fat def leaked.
        expect(projected.pendingTriggerBatch![0].card).toEqual({ id: CARD_A });
        expect(projected.pendingChoices?.[0].kind).toBe("trigger-order");
        expect(projected.pendingChoices?.[0].candidateIds).toEqual([
            "t1",
            "t2",
        ]);
    });

    it("round-trips the off-stack batch through the DB seam", () => {
        const state = baseState();
        placeTriggersOnStack(state, [
            mkTrigger("t1", "p1", CARD_A, "ability-a"),
            mkTrigger("t2", "p1", CARD_B, "ability-b"),
        ]);
        const restored = expandState(compactState(state));
        expect(restored.pendingTriggerBatch?.map((s) => s.id)).toEqual([
            "t1",
            "t2",
        ]);
        expect(restored.pendingChoices?.[0].kind).toBe("trigger-order");
        expect(restored.pendingChoices?.[0].candidateIds).toEqual(["t1", "t2"]);
    });
});
