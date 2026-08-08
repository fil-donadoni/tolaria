// ISD (Innistrad) — blue behavior tests (ADR 0043 colour split).
//
// Snapcaster Mage's ETB grants Flashback (CR 702.34) to a TARGET instant/sorcery
// in the controller's graveyard, with cost = its mana cost. Per CR 603.3d the
// target is chosen when the trigger is put on the stack (a real
// `targetRequirement` + `raiseTriggerTargetSelection`), NOT a resolution-time
// choice — so it is subject to hexproof / protection / graveyard-hate and fires
// "becomes the target of an ability" triggers, which the old choice-as-target
// workaround silently skipped. The grant is an instance-level flashback
// (`grantedFlashback`) that expires at cleanup. This test drives the real
// target machinery (`raiseTriggerTargetSelection` → `finalizeTargetSelection`
// writes the announced target onto the on-stack trigger → `resolveTopOfStack`)
// and re-checks the outcome through projectPublicState — the granted card must
// arrive on the wire tagged with the Flashback cast affordance.
import { describe, it, expect } from "vitest";
import { snapcasterMage } from "../blue";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack, getPlayer } from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { getFlashbackCost } from "../../../../gre/flashback";
import { projectPublicState } from "../../../../gameProjections";
import { firebolt } from "../../ody/red";
import { grizzlyBears } from "../../lea";
import type {
    GameState,
    StackItem,
    CardInstanceState,
} from "../../../../gre/state";

/** Puts Snapcaster Mage's self-ETB trigger on the stack (CR 603.6a), mirroring
 *  collectTriggers + buildTriggerItem. `targets: undefined` (the target slot is
 *  UN-set) so `raiseTriggerTargetSelection` picks it up as a candidate — the
 *  CR 603.3d target is chosen from the stack, not preset. */
function snapEtbTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "trig-snap-etb",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "snapcaster-mage-etb-flashback",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            types: source.types,
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Drives the CR 603.3d target choice through the real machinery:
 *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget,
 *  then `finalizeTargetSelection` writes the chosen graveyard-card target onto
 *  the on-stack trigger. */
function chooseSnapTarget(state: GameState, cardId: string, playerId: string) {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    expect(state.pendingTarget!.kind).toBe("trigger");
    state.pendingTarget!.selected = [
        { type: "graveyard-card", id: cardId, playerId },
    ];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

describe("Snapcaster Mage (ETB grants flashback, CR 702.34 / CR 603.3d target)", () => {
    it("grants the CHOSEN instant/sorcery flashback = its mana cost, tagged on the wire", () => {
        const snap = makeInstance(snapcasterMage.id, {
            id: "snap",
            zone: "battlefield",
            controllerId: "p1",
            ownerId: "p1",
        });
        // TWO sorceries (both grantable) and a creature (not an instant/sorcery)
        // in the controller's graveyard — two legal targets force a REAL choice,
        // so `raiseTriggerTargetSelection` returns true and raises a PendingTarget.
        const fb1 = makeInstance(firebolt.id, {
            id: "gy-firebolt",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const fb2 = makeInstance(firebolt.id, {
            id: "gy-firebolt-2",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "gy-bear",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [snap],
                    graveyard: [fb1, fb2, bear],
                    // Enough to flash Firebolt back at its own mana cost ({R}).
                    manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });

        snapEtbTriggerOnStack(state, snap);

        // CR 603.3d — the target is chosen from the stack, before resolution.
        chooseSnapTarget(state, "gy-firebolt", "p1");
        // The announced target is locked onto the on-stack trigger.
        expect(state.stack[0].targets).toEqual([
            { type: "graveyard-card", id: "gy-firebolt", playerId: "p1" },
        ]);

        expect(resolveTopOfStack(state)).not.toBeNull();

        // CR 702.34 — Firebolt now has flashback = its own mana cost ({R}).
        const grantedFirebolt = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === "gy-firebolt"
        )!;
        expect(grantedFirebolt.grantedFlashback).toEqual({ R: 1 });
        expect(getFlashbackCost(grantedFirebolt)).toEqual({ R: 1 });
        // The un-chosen copy is untouched.
        expect(
            getPlayer(state, "p1").graveyard.find(
                (c) => c.id === "gy-firebolt-2"
            )!.grantedFlashback
        ).toBeUndefined();

        // Frontend wiring — the granted card crosses the wire with the cast
        // affordance ("cast"), since its flashback ({R}) is now affordable.
        const projected = projectPublicState(state, 1, "p1");
        const projFirebolt = projected.players[0].graveyard.find(
            (c) => c.id === "gy-firebolt"
        )!;
        expect(projFirebolt.legalActions).toEqual(["cast"]);
    });

    it("removes the trigger with no legal target (CR 603.3c — no instant/sorcery in graveyard)", () => {
        const snap = makeInstance(snapcasterMage.id, {
            id: "snap2",
            zone: "battlefield",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "gy-bear-2",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [snap], graveyard: [bear] }),
                makePlayer("p2"),
            ],
        });
        snapEtbTriggerOnStack(state, snap);
        // CR 603.3c — a mandatory (count 1) target with none legal: the engine
        // removes the trigger from the stack; no PendingTarget is raised.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingTarget).toBeUndefined();
        expect(
            getPlayer(state, "p1").graveyard[0].grantedFlashback
        ).toBeUndefined();
    });
});
