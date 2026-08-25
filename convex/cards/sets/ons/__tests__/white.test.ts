// Per-card behavior tests for white cards in `convex/cards/sets/ons/white.ts`
// (ONS, split by colour per ADR 0043). Morph itself — the face-down cast, the
// turn-face-up special action, the wire redaction — is covered mechanic-wide
// in `convex/gre/__tests__/morph.test.ts`; this file covers Exalted Angel's
// own `resolve()` clause, which morph never touches.

import { describe, it, expect } from "vitest";
import { exaltedAngel } from "..";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack, type StackItem } from "../../../../gre/state";
import { turnFaceDown } from "../../../../gre/faceDown";
import { collectTriggers } from "../../../../gre/triggers";
import type { GameState, CardInstanceState } from "../../../../gre/state";

/** Push the named triggered ability of `source` and resolve it. */
function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets: [],
    });
    resolveTopOfStack(state);
}

function angelBoard(): { state: GameState; angel: CardInstanceState } {
    const angel = makeInstance(exaltedAngel.id, {
        id: "angel",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [angel] }), makePlayer("p2")],
    });
    return { state, angel: state.players[0].battlefield[0] };
}

describe("Exalted Angel — whenever it deals damage, gain that much life (CR 120.3)", () => {
    it("gains life equal to the damage dealt", () => {
        const { state, angel } = angelBoard();
        resolveTrigger(state, angel, "exalted-angel-lifegain", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "angel",
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 4,
            isCombat: true,
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(24);
    });

    it("gains life from NON-combat damage too (the clause says only 'deals damage')", () => {
        const { state, angel } = angelBoard();
        resolveTrigger(state, angel, "exalted-angel-lifegain", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "angel",
            sourceControllerId: "p1",
            target: { type: "permanent", id: "whatever" },
            amount: 2,
            isCombat: false,
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(22);
    });

    it("does NOT trigger while the Angel is face down (CR 702.37c — no text)", () => {
        // The whole point of the face-down cast: a morph creature is a 2/2
        // vanilla with no abilities, so its own printed trigger cannot fire.
        const { state, angel } = angelBoard();
        turnFaceDown(angel);
        const triggers = collectTriggers(state, [
            {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "angel",
                sourceControllerId: "p1",
                target: { type: "player", id: "p2" },
                amount: 2,
                isCombat: true,
            },
        ]);
        expect(triggers).toHaveLength(0);
        expect(state.players[0].life).toBe(20);
    });

    it("DOES trigger once it is face up (non-vacuity control for the case above)", () => {
        const { state, angel } = angelBoard();
        const triggers = collectTriggers(state, [
            {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "angel",
                sourceControllerId: "p1",
                target: { type: "player", id: "p2" },
                amount: 2,
                isCombat: true,
            },
        ]);
        expect(triggers).toHaveLength(1);
    });
});
