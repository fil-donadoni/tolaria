// Modern Horizons 3 (MH3) — red behavior tests (ADR 0043 colour split).
// Galvanic Discharge exercises the Energy resource (CR 122.1, issue #697):
// "you get {E}{E}{E}, then you may pay any amount of {E}" driving the damage
// dealt. resolve()/resolveSteps card (variable resource payment — see the
// justification in mh3/red.ts), so it carries a full per-card GRE + wire test.

import { describe, it, expect } from "vitest";
import { galvanicDischarge } from "../red";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import type { GameState } from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { projectPublicState } from "../../../../gameProjections";
import { getCardByName } from "../../../index";

// Grizzly Bears — a vanilla 2/2, so 3+ damage is lethal (moves to graveyard via
// SBA) while 1 damage leaves it on the battlefield with the damage marked.
const BEARS = getCardByName("Grizzly Bears").id;

// Submit the head option-pick choice and resume resolution (mirrors the drk
// `answerChoice` helper — writes the collected answer under the interpreter's
// `${step}:${choiceId}` key, then re-resolves).
function answerOption(state: GameState, optionId: string): void {
    const head = state.pendingChoices?.[0];
    if (!head) throw new Error("no pending choice to answer");
    const item = state.stack.find((s) => s.id === head.stackItemId)!;
    item.collectedChoices = {
        ...(item.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: [optionId],
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}

function setup(casterEnergy = 0) {
    const bear = makeInstance(BEARS, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { energyCounters: casterEnergy || undefined }),
            makePlayer("p2", { battlefield: [bear] }),
        ],
    });
    pushSpell(state, galvanicDischarge.id, "p1", [
        { type: "permanent", id: "bear" },
    ]);
    return { state };
}

function bearOnBattlefield(state: GameState) {
    return state.players[1].battlefield.find((c) => c.id === "bear");
}

describe("Galvanic Discharge — Energy get + pay-any-amount (CR 122.1)", () => {
    it("gets {E}{E}{E} then offers to pay 0..pool", () => {
        const { state } = setup();
        resolveTopOfStack(state); // step 0 gains energy, step 1 suspends on choice
        expect(state.players[0].energyCounters).toBe(3);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("option-pick");
        // 0..3 = four options once the three counters are gained.
        expect(head?.options?.map((o) => o.id)).toEqual(["0", "1", "2", "3"]);
    });

    it("pays the chosen energy and deals that much (lethal) damage to the target", () => {
        const { state } = setup();
        resolveTopOfStack(state);
        answerOption(state, "3"); // pay all 3 — lethal to a 2/2
        checkStateBasedActions(state);
        // 3 damage killed the bear (CR 704.5g) — it left the battlefield.
        expect(bearOnBattlefield(state)).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "bear")).toBe(
            true
        );
        // CR 118.12 — all 3 energy spent (started 0, +3, −3).
        expect(state.players[0].energyCounters ?? 0).toBe(0);
    });

    it("paying a partial amount marks that much damage and leaves the rest of the pool", () => {
        const { state } = setup();
        resolveTopOfStack(state);
        answerOption(state, "1"); // pay only 1 — non-lethal
        const bear = bearOnBattlefield(state)!;
        expect(bear.damageMarked).toBe(1);
        expect(state.players[0].energyCounters).toBe(2);
    });

    it("paying nothing spends no energy and deals no damage", () => {
        const { state } = setup();
        resolveTopOfStack(state);
        answerOption(state, "0");
        const bear = bearOnBattlefield(state)!;
        expect(bear.damageMarked ?? 0).toBe(0);
        // The three gained counters remain (nothing paid).
        expect(state.players[0].energyCounters).toBe(3);
    });

    it("pre-existing energy widens the payable range and stacks", () => {
        const { state } = setup(2); // caster already has 2 energy
        resolveTopOfStack(state);
        expect(state.players[0].energyCounters).toBe(5); // 2 + 3
        const head = state.pendingChoices?.[0];
        expect(head?.options?.map((o) => o.id)).toEqual([
            "0",
            "1",
            "2",
            "3",
            "4",
            "5",
        ]);
        answerOption(state, "5");
        checkStateBasedActions(state);
        expect(bearOnBattlefield(state)).toBeUndefined(); // 5 damage is lethal
        expect(state.players[0].energyCounters ?? 0).toBe(0);
    });

    it("the remaining energy pool survives the wire projection (mandatory)", () => {
        const { state } = setup();
        resolveTopOfStack(state);
        answerOption(state, "1"); // leaves 2 energy
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[0].energyCounters).toBe(2);
    });
});
