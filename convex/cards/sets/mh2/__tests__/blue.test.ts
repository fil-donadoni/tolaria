import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import type { GameState, StackItem } from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import type { TargetSelection } from "../../../types";
import { subtlety } from "../blue";

// Subtlety — {2}{U}{U} 3/3, flash/flying, blue evoke. First TARGETED trigger
// over a SPELL on the stack (CR 603.3d / 113, #1193/#1205): "choose up to one
// target creature spell or planeswalker spell; its owner puts it on the top or
// bottom of their library."

/** Put Subtlety's ETB trigger on the stack (above any target spells). */
function subtletyEtbOnStack(state: GameState, controllerId: string): StackItem {
    const source = makeInstance(subtlety.id, {
        id: "sub-src",
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
    });
    const trig: StackItem = {
        ...source,
        id: "sub-trig",
        zone: "stack",
        castById: controllerId,
        triggeredAbilityId: "subtlety-etb",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Answer a pending option-pick (top/bottom) by injecting the choice, mirroring
 *  the submitPendingChoice → collectedChoices path, then resume resolution. */
function answerOptionPick(state: GameState, optionId: string): void {
    const head = state.pendingChoices?.[0];
    if (!head) throw new Error("no pending option-pick");
    const item = state.stack.find((s) => s.id === head.stackItemId)!;
    item.collectedChoices = {
        ...(item.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: [optionId],
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}

describe("Subtlety — targeted trigger over a stack spell (CR 603.3d / 113, #1205)", () => {
    it("pins the definition (flash/flying, blue evoke, up-to-one spell target)", () => {
        expect(subtlety.staticAbilities).toEqual(["flash", "flying"]);
        expect(subtlety.evoke).toEqual({
            id: "evoke",
            description: "Evoke—Exile a blue card from your hand",
            handCost: {
                action: "exile",
                requirements: [{ filter: { color: "U" }, count: 1 }],
            },
        });
        const etb = subtlety.triggeredAbilities?.find(
            (a) => a.id === "subtlety-etb"
        );
        expect(etb?.targetRequirement).toEqual({
            type: "spell",
            count: { min: 0, max: 1 },
            spellStackKind: "spell",
            spellTypeFilter: ["Creature", "Planeswalker"],
        });
    });

    it("targets only a creature/planeswalker spell (not an instant) and puts it on top of the owner's library", () => {
        const treefolk = getCardByName("Ironroot Treefolk"); // creature
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // p2 casts a creature spell; p1 flashes in Subtlety.
        const creatureSpell = pushSpell(state, treefolk.id, "p2");
        const trig = subtletyEtbOnStack(state, "p1");

        // CR 603.3d — the targeted trigger raises spell-target selection as it
        // is put on the stack. Only the creature spell is a legal target.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("trigger");
        expect(pt.cardInstanceId).toBe("sub-trig");
        expect(pt.targetType).toBe("spell");

        pt.selected = [
            { type: "spell", id: creatureSpell.id },
        ] as TargetSelection[];
        finalizeTargetSelection(state, pt, "p1");
        expect(trig.targets).toEqual([{ type: "spell", id: creatureSpell.id }]);

        // Resolve the trigger — the OWNER (p2) is prompted for top/bottom.
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("option-pick");
        expect(head?.playerId).toBe("p2");

        answerOptionPick(state, "top");
        // The creature spell left the stack onto the top of p2's library.
        expect(state.stack.some((s) => s.id === creatureSpell.id)).toBe(false);
        expect(state.players[1].library[0]?.id).toBe(creatureSpell.id);
    });

    it("puts the spell on the bottom of the owner's library when chosen", () => {
        const treefolk = getCardByName("Ironroot Treefolk");
        const filler = makeInstance(treefolk.id, {
            id: "lib0",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: [filler] }),
            ],
        });
        const creatureSpell = pushSpell(state, treefolk.id, "p2");
        const trig = subtletyEtbOnStack(state, "p1");
        raiseTriggerTargetSelection(state);
        const pt = state.pendingTarget!;
        pt.selected = [
            { type: "spell", id: creatureSpell.id },
        ] as TargetSelection[];
        finalizeTargetSelection(state, pt, "p1");
        void trig;
        resolveTopOfStack(state);
        answerOptionPick(state, "bottom");
        const lib = state.players[1].library;
        expect(lib[lib.length - 1]?.id).toBe(creatureSpell.id);
        expect(lib[0]?.id).toBe("lib0");
    });

    it("may choose no target (up to one) — the spell resolves normally", () => {
        const treefolk = getCardByName("Ironroot Treefolk");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const creatureSpell = pushSpell(state, treefolk.id, "p2");
        subtletyEtbOnStack(state, "p1");
        raiseTriggerTargetSelection(state);
        const pt = state.pendingTarget!;
        // Choose none.
        pt.selected = [];
        finalizeTargetSelection(state, pt, "p1");
        resolveTopOfStack(state);
        // No option-pick raised; the creature spell is still on the stack.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack.some((s) => s.id === creatureSpell.id)).toBe(true);
    });
});
