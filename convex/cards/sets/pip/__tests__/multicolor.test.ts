// pip (Fallout) — per-card behavior tests for multicolor cards in
// `convex/cards/sets/pip/multicolor.cards.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import {
    beginApplyingStaticEffects,
    removePermanentTo,
    resolveTopOfStack,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyCopy } from "../../../../gre/copy";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import { getDefinition } from "../../../index";

// ---------------------------------------------------------------------------
// Alpha Deathclaw — Monstrosity (CR 701.37, issue #3217). Driven through the
// real stack (`resolveTopOfStack`), the real trigger scan (`collectTriggers`)
// and the real departure / copy paths, never a hand-built view.
// ---------------------------------------------------------------------------

const alphaDeathclaw = getDefinition("ca4c8b04-66af-4cb3-8003-9088d8344b20");
const balduvianBears = getDefinition("ef5297cb-e763-4871-9cd3-0e2dbcc52095");

/** Alpha Deathclaw on p1's battlefield, an opposing Bears to destroy. */
function deathclawBoard(): {
    state: GameState;
    deathclaw: CardInstanceState;
} {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(alphaDeathclaw.id, { id: "deathclaw" }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(balduvianBears.id, {
                        id: "bears",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
    const deathclaw = state.players[0].battlefield[0];
    beginApplyingStaticEffects(state, deathclaw);
    return { state, deathclaw };
}

/** Resolves "{5}{B}{G}: Monstrosity 4." through the real stack, exactly as the
 *  `activateAbility` mutation would after the cost is paid. */
function activateMonstrosity(
    state: GameState,
    deathclaw: CardInstanceState
): void {
    state.stack.push({
        ...deathclaw,
        zone: "stack",
        castById: deathclaw.controllerId,
        abilityId: "alpha-deathclaw-monstrosity",
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Alpha Deathclaw — Monstrosity 4 (CR 701.37a)", () => {
    it("CR 701.37a — puts four +1/+1 counters on it and it becomes monstrous", () => {
        const { state, deathclaw } = deathclawBoard();
        expect(deathclaw.monstrous).toBeUndefined();
        activateMonstrosity(state, deathclaw);
        expect(deathclaw.monstrous).toBe(true);
        expect(deathclaw.counters?.["+1/+1"]).toBe(4);
        expect(getEffectivePower(state, deathclaw)).toBe(10);
        expect(getEffectiveToughness(state, deathclaw)).toBe(10);
    });

    it("CR 701.37a + 603.2 — becoming monstrous fires the destroy trigger, which destroys its target", () => {
        const { state, deathclaw } = deathclawBoard();
        activateMonstrosity(state, deathclaw);
        // The activation's own resolution drained PERMANENT_BECAME_MONSTROUS
        // and put the trigger on the stack.
        expect(state.stack.map((item) => item.triggeredAbilityId)).toEqual([
            "alpha-deathclaw-destroy",
        ]);
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [{ type: "permanent", id: "bears" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["bears"]);
    });

    it("CR 701.37a — on an already-monstrous Deathclaw the ability resolves and does nothing: no counters, no trigger", () => {
        const { state, deathclaw } = deathclawBoard();
        activateMonstrosity(state, deathclaw);
        state.stack = [];
        state.pendingEvents = [];
        activateMonstrosity(state, deathclaw);
        expect(deathclaw.counters?.["+1/+1"]).toBe(4);
        expect(state.stack).toEqual([]);
    });

    it("CR 603.2 — ONE ability listens to both events: entering and becoming monstrous", () => {
        const { state } = deathclawBoard();
        const fired = (event: Parameters<typeof collectTriggers>[1][number]) =>
            collectTriggers(state, [event]).map((t) => t.triggeredAbilityId);
        expect(
            fired({
                type: "PERMANENT_ENTERED",
                instanceId: "deathclaw",
                cardId: alphaDeathclaw.id,
                controllerId: "p1",
                types: ["Creature"],
                subtypes: ["Lizard", "Mutant"],
            } as Parameters<typeof collectTriggers>[1][number])
        ).toEqual(["alpha-deathclaw-destroy"]);
        expect(
            fired({
                type: "PERMANENT_BECAME_MONSTROUS",
                instanceId: "deathclaw",
                controllerId: "p1",
                count: 4,
                types: ["Creature"],
                subtypes: ["Lizard", "Mutant"],
            })
        ).toEqual(["alpha-deathclaw-destroy"]);
        // Another permanent becoming monstrous is not THIS creature.
        expect(
            fired({
                type: "PERMANENT_BECAME_MONSTROUS",
                instanceId: "bears",
                controllerId: "p2",
                count: 4,
                types: ["Creature"],
                subtypes: ["Bear"],
            })
        ).toEqual([]);
    });
});

describe("Alpha Deathclaw — the monstrous designation (CR 701.37b)", () => {
    it("CR 701.37b / 400.7 — the designation goes with the object when it dies", () => {
        const { state, deathclaw } = deathclawBoard();
        activateMonstrosity(state, deathclaw);
        removePermanentTo(state, deathclaw.id, "graveyard", "destroy");
        const dead = state.players[0].graveyard.find(
            (c) => c.id === "deathclaw"
        )!;
        expect(dead.monstrous).toBeUndefined();
    });

    it("CR 701.37b / 400.7 — a bounced Deathclaw is a new object, not monstrous", () => {
        const { state, deathclaw } = deathclawBoard();
        activateMonstrosity(state, deathclaw);
        removePermanentTo(state, deathclaw.id, "hand");
        const inHand = state.players[0].hand.find((c) => c.id === "deathclaw")!;
        expect(inHand.monstrous).toBeUndefined();
    });

    it("CR 701.37b — monstrous is not a copiable value: a copy of a monstrous Deathclaw is not monstrous", () => {
        const { state, deathclaw } = deathclawBoard();
        activateMonstrosity(state, deathclaw);
        const clone = makeInstance(balduvianBears.id, { id: "clone" });
        state.players[0].battlefield.push(clone);
        beginApplyingStaticEffects(state, clone);
        applyCopy(state, clone, deathclaw);
        expect(clone.card.id).toBe(alphaDeathclaw.id);
        expect(clone.monstrous).toBeUndefined();
        expect(deathclaw.monstrous).toBe(true);
    });
});
