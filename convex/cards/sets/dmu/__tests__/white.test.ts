// DMU — white card behavior tests (ADR 0043 colour split).
//
// Leyline Binding composes two already-shipped primitives, so per the per-Op
// regime it owes no per-Op proof — what it owes is the CARD-level proof that
// the composition is wired to the right board facts:
//
//   - the Domain-driven `selfCostReduction` (CR 601.2f, issue #1958) is
//     asserted through the SHARED CR 601.2f authority (`getCostModifiers` +
//     `applyCostModifiers`) the payment path, the castability probe, the
//     auto-tap solver and the bot's move enumerator all route through — never
//     a bespoke Domain calculation — including the floor that keeps the {W}
//     pip alive at Domain 5;
//   - the exile-until-leaves ETB (ADR 0028) is driven end to end through the
//     real trigger/target machinery, since a bundle keyed to the wrong source
//     would exile correctly and never return.

import { describe, it, expect } from "vitest";
import { leylineBinding } from "../white";
import {
    forest,
    island,
    mountain,
    plains,
    swamp,
    tundra,
} from "../../lea/colorless";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getDefinition, getCardByName } from "../../..";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
    removePermanentTo,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";

/** Mirrors game.ts's plain hand-cast cost calc: normalize the printed cost,
 *  then fold in cost modifiers (battlefield scan + self-host) — the exact pair
 *  of functions the real cast site calls. */
function effectiveCastCost(state: GameState): Record<string, number> {
    const spellView = makeInstance(leylineBinding.id, {
        id: "lb-spell-view",
        controllerId: "p1",
        zone: "hand",
    });
    const cost = normalizeManaCost(leylineBinding.manaCost ?? {});
    applyCostModifiers(cost, getCostModifiers(state, spellView, "spell"));
    return cost;
}

const BASICS = [plains, island, swamp, mountain, forest];

/** A board where p1 controls one land of each of the first `n` basic types —
 *  i.e. exactly Domain `n`. */
function boardWithDomain(n: number): GameState {
    const lands = BASICS.slice(0, n).map((def, i) =>
        makeInstance(def.id, {
            id: `dom-land-${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    return makeState({
        players: [makePlayer("p1", { battlefield: lands }), makePlayer("p2")],
    });
}

describe("Leyline Binding — Domain cost reduction (CR 601.2f / 305.6)", () => {
    it("registers by id and name", () => {
        expect(getDefinition(leylineBinding.id)).toBe(leylineBinding);
        expect(getCardByName("Leyline Binding")).toBe(leylineBinding);
    });

    it.each([
        [0, 5],
        [1, 4],
        [2, 3],
        [3, 2],
        [4, 1],
        [5, 0],
    ])("Domain %i → the generic component is {%i}", (domain, generic) => {
        // At Domain 5 the generic component is gone entirely, so the key is
        // absent rather than zero — the card is exactly {W}.
        expect(effectiveCastCost(boardWithDomain(domain))).toEqual(
            generic === 0 ? { W: 1 } : { X: generic, W: 1 }
        );
    });

    it("never reduces below its coloured pip — at Domain 5 the card costs exactly {W} (CR 601.2f)", () => {
        // CR 601.2f floors the mana component at {0} and the reduction is
        // GENERIC-only, so the {W} survives. Guard against a reduction that
        // eats coloured pips or underflows past zero.
        const cost = effectiveCastCost(boardWithDomain(5));
        expect(cost.X ?? 0).toBe(0);
        expect(cost.W).toBe(1);
    });

    it("counts basic land TYPES, not lands — three Forests reduce by {1}, not {3}", () => {
        const forests = [0, 1, 2].map((i) =>
            makeInstance(forest.id, {
                id: `forest-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: forests }),
                makePlayer("p2"),
            ],
        });
        expect(effectiveCastCost(state)).toEqual({ X: 4, W: 1 });
    });

    it("one dual land contributes BOTH of its basic types (CR 305.6) — Tundra alone reduces by {2}", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(tundra.id, {
                            id: "tundra",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(effectiveCastCost(state)).toEqual({ X: 3, W: 1 });
    });

    it("reads the CASTER's Domain, not the board's — an opponent's basics do not discount it", () => {
        const lands = BASICS.map((def, i) =>
            makeInstance(def.id, {
                id: `opp-land-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: lands }),
            ],
        });
        expect(effectiveCastCost(state)).toEqual({ X: 5, W: 1 });
    });
});

const ETB_EVENT: StackItem["triggerEvent"] = {
    type: "PERMANENT_ENTERED",
    instanceId: "lb",
    controllerId: "p1",
    types: ["Enchantment"],
} as StackItem["triggerEvent"];

/** p1's Leyline Binding; p2 controls two Grizzly Bears (two legal targets, so
 *  the CR 603.3d choice is a REAL one rather than an auto-lock). */
function bindingBoard() {
    const lb = makeInstance(leylineBinding.id, {
        id: "lb",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bears = [0, 1].map((i) =>
        makeInstance(grizzlyBears.id, {
            id: `bear-${i}`,
            controllerId: "p2",
            ownerId: "p2",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [lb] }),
            makePlayer("p2", { battlefield: bears }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state, lb };
}

function exileTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "lb-etb-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "leyline-binding-exile",
        triggerSourceId: source.id,
        triggerEvent: ETB_EVENT,
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

function chooseExileTarget(state: GameState, targetId: string): void {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    expect(state.pendingTarget!.kind).toBe("trigger");
    state.pendingTarget!.selected = [{ type: "permanent", id: targetId }];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

describe("Leyline Binding — exile until this leaves (CR 603.6a / 603.7a, ADR 0028)", () => {
    it("ETB exiles the chosen nonland permanent, keyed to this enchantment", () => {
        const { state, lb } = bindingBoard();
        exileTriggerOnStack(state, lb);
        chooseExileTarget(state, "bear-0");
        expect(resolveTopOfStack(state)).not.toBeNull();

        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "bear-1",
        ]);
        expect(state.players[1].exile.map((c) => c.id)).toContain("bear-0");
        const bundle = state.exileHeld?.find((b) => b.sourceId === "lb");
        expect(bundle).toBeDefined();
        expect(bundle!.hostId).toBe("bear-0");
    });

    it("returns the exiled card when it leaves the battlefield (CR 603.7a)", () => {
        const { state, lb } = bindingBoard();
        exileTriggerOnStack(state, lb);
        chooseExileTarget(state, "bear-0");
        resolveTopOfStack(state);

        removePermanentTo(state, "lb", "graveyard");
        processPendingActionTriggers(state);
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "leyline-binding-return"
            )
        ).toBe(true);
        resolveTopOfStack(state);

        const returned = state.players[1].battlefield.find(
            (c) => c.id === "bear-0"
        );
        expect(returned).toBeDefined();
        expect(returned!.isTapped).toBe(false);
        expect(state.exileHeld ?? []).toHaveLength(0);
    });

    it("leaving in response to its OWN ETB holds nothing and returns nothing", () => {
        // The bundle is keyed to the source, not to a turn: when the
        // enchantment is gone before its own trigger resolves, the exile never
        // happens and the leave trigger's `holdsExileBundle` gate finds no
        // bundle. Neither half may fire on a phantom.
        const { state, lb } = bindingBoard();
        exileTriggerOnStack(state, lb);
        chooseExileTarget(state, "bear-0");

        // Leyline Binding is destroyed with its ETB still on the stack.
        removePermanentTo(state, "lb", "graveyard");
        processPendingActionTriggers(state);
        // Resolve everything now on the stack (the leave trigger, if any, and
        // then the orphaned ETB).
        while (state.stack.length > 0) resolveTopOfStack(state);

        expect(state.players[1].battlefield.map((c) => c.id).sort()).toEqual([
            "bear-0",
            "bear-1",
        ]);
        expect(state.players[1].exile).toHaveLength(0);
        expect(state.exileHeld ?? []).toHaveLength(0);
    });
});
