// Banishing Light (JOU) — O-Ring-style exile-until-leaves (CR 603.6a ETB /
// 603.7a return, ADR 0028). Host-only exile: the chosen permanent's Auras die
// to the orphan-aura SBA (CR 704.5n) and Equipment detaches — neither is held
// nor returned (this is what `includeAttachments: false` buys, vs Tawnos's
// Coffin). The exiled card is pinned to Banishing Light on the board via the
// mechanism-agnostic `exiledByPermanentId` projection link — the SAME affordance
// Ice Cauldron's noted card uses, so this is a second-mechanism verification of
// the generic exile-pin component.
import { describe, it, expect } from "vitest";
import { banishingLight } from "..";
import { grizzlyBears, flight } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getDefinition, getCardByName } from "../../..";
import { projectPublicState } from "../../../../gameProjections";
import {
    removePermanentTo,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";

const ETB_EVENT: StackItem["triggerEvent"] = {
    type: "PERMANENT_ENTERED",
    instanceId: "bl",
    controllerId: "p1",
    types: ["Enchantment"],
} as StackItem["triggerEvent"];

/** p1's Banishing Light; p2 controls a Grizzly Bears wearing a Flight aura. */
function setup() {
    const bl = makeInstance(banishingLight.id, {
        id: "bl",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
    });
    const aura = makeInstance(flight.id, {
        id: "aura",
        controllerId: "p2",
        ownerId: "p2",
        attachedTo: "bear",
    });
    const land = makeInstance(grizzlyBears.id, {
        id: "ignored",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [bl] }),
            makePlayer("p2", { battlefield: [bear, aura] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    void land;
    return { state, bl };
}

/** Puts Banishing Light's ETB exile trigger on the stack WITHOUT resolving it
 *  (mirrors the engine right after a trigger is put on the stack, before target
 *  selection). Carries `targets: undefined` so `raiseTriggerTargetSelection`
 *  treats it as a candidate; `triggerSourceId` keeps `ctx.sourceInstanceId` =
 *  "bl" so the exile bundle is keyed to the enchantment. */
function exileTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "bl-etb-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "banishing-light-exile",
        triggerSourceId: source.id,
        triggerEvent: ETB_EVENT,
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Drives the CR 603.3d target choice through the real machinery:
 *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget,
 *  then `finalizeTargetSelection` writes the chosen target onto the on-stack
 *  trigger. Asserts a real choice was owed (2+ legal targets). */
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

describe("Banishing Light (JOU — exile-until-leaves, CR 603.6a/603.7a)", () => {
    it("registers by id and name", () => {
        expect(getDefinition(banishingLight.id)).toBe(banishingLight);
        expect(getCardByName("Banishing Light")).toBe(banishingLight);
    });

    it("ETB exiles ONLY the chosen permanent: its Aura dies (SBA), nothing else is held (CR 701.13/704.5n)", () => {
        const { state, bl } = setup();
        // CR 603.3d — the target (bear vs. its Aura, two legal opponent
        // permanents) is chosen when the trigger goes on the stack.
        exileTriggerOnStack(state, bl);
        chooseExileTarget(state, "bear");
        expect(resolveTopOfStack(state)).not.toBeNull();
        checkStateBasedActions(state); // orphan-aura SBA sweeps the Flight

        // The creature left the battlefield for its owner's exile...
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(state.players[1].exile.map((c) => c.id)).toContain("bear");
        // ...its Aura was NOT exiled — it fell to its owner's graveyard...
        expect(state.players[1].exile.map((c) => c.id)).not.toContain("aura");
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("aura");
        // ...and the exile-and-return bundle holds the host alone (attached: []).
        const bundle = state.exileHeld?.find((b) => b.sourceId === "bl");
        expect(bundle).toBeDefined();
        expect(bundle!.hostId).toBe("bear");
        expect(bundle!.attached).toEqual([]);
    });

    it("returns ONLY the host (untapped) when Banishing Light leaves; the Aura stays dead (CR 603.7a)", () => {
        const { state, bl } = setup();
        exileTriggerOnStack(state, bl);
        chooseExileTarget(state, "bear");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // Banishing Light leaves → its return trigger lands and resolves.
        removePermanentTo(state, "bl", "graveyard");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "banishing-light-return"
        );
        expect(trig).toBeDefined();
        resolveTopOfStack(state);

        const returned = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(returned).toBeDefined();
        expect(returned!.isTapped).toBe(false); // O-Ring returns untapped
        // The Aura was destroyed at exile time and does NOT come back.
        expect(
            state.players[1].battlefield.find((c) => c.id === "aura")
        ).toBeUndefined();
        expect(state.exileHeld ?? []).toHaveLength(0); // bundle consumed
    });

    it("wire: the exiled permanent is pinned to Banishing Light via exiledByPermanentId, for both viewers", () => {
        const { state, bl } = setup();
        exileTriggerOnStack(state, bl);
        chooseExileTarget(state, "bear");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // The generic exile-pin link (buildExileAssociation derives it from the
        // exileHeld bundle's sourceId) reaches BOTH clients — the same field
        // Ice Cauldron's noted card uses, proving the component is mechanism-
        // agnostic.
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const exiledBear = projected.players[1].exile.find(
                (c) => c.id === "bear"
            )!;
            expect(exiledBear.exiledByPermanentId).toBe("bl");
        }
        void bl;
    });

    it("auto-selects the sole legal target: no PendingTarget raised (CR 603.3d)", () => {
        // Only ONE nonland permanent an opponent controls (the bear, no Aura,
        // plus a land that `excludeTypes: 'Land'` filters out). CR 603.3d — a
        // mandatory single target with exactly one legal choice locks itself as
        // the trigger goes on the stack, no player choice raised.
        const bl = makeInstance(banishingLight.id, {
            id: "bl",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bl] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const trig = exileTriggerOnStack(state, bl);
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([{ type: "permanent", id: "bear" }]);
        expect(state.pendingTarget).toBeUndefined();

        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(state.players[1].exile.map((c) => c.id)).toContain("bear");
        const bundle = state.exileHeld?.find((b) => b.sourceId === "bl");
        expect(bundle).toBeDefined();
        expect(bundle!.hostId).toBe("bear");
    });
});
