// Modern Horizons 3 (MH3) — multicolor behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    psychicFrog,
    phlageTitanOfFiresFury,
    naduWingedWisdom,
} from "../multicolor";
import { grizzlyBears } from "../../lea/green";
import { forest } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
    applySourceStaticEffects,
} from "../../../../gre/state";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import { collectTriggers } from "../../../../gre/triggers";
import type { GameEvent, TargetSelection } from "../../../types";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
    } as StackItem);
    resolveTopOfStack(state);
}

/** Puts a triggered ability on the stack WITHOUT resolving it, so the CR
 *  603.3d target choice can be driven before resolution. `triggerSourceId`
 *  pins the source permanent the way `buildTriggerItem` does (needed by
 *  `raiseTriggerTargetSelection`). */
function pushTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
): StackItem {
    const trig = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets: undefined,
    } as StackItem;
    state.stack.push(trig);
    return trig;
}

/** Drives the CR 603.3d "any target" choice through the real machinery
 *  (mirrors Phelia's `choosePheliaTarget`): `raiseTriggerTargetSelection`
 *  raises the `kind:"trigger"` PendingTarget, then `finalizeTargetSelection`
 *  writes the chosen target onto the on-stack trigger. */
function choosePhlageTarget(state: GameState, target: TargetSelection) {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    state.pendingTarget!.selected = [target];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

function answer(state: GameState, ids: string[]) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

const frogOnBattlefield = () =>
    makeInstance(psychicFrog.id, {
        id: "frog",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });

describe("Psychic Frog ({U}{B} 1/2 Frog; CR 510.4 / 122.1 / 611.2a)", () => {
    it("discard ability: discards a chosen card and adds a +1/+1 counter", () => {
        const frog = frogOnBattlefield();
        const handCard = makeInstance(psychicFrog.id, {
            id: "h1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [frog], hand: [handCard] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, frog, "psychic-frog-discard-pump");
        answer(state, ["h1"]);

        const p1 = state.players[0];
        expect(p1.hand).toHaveLength(0);
        expect(p1.graveyard.map((c) => c.id)).toContain("h1");
        const live = p1.battlefield.find((c) => c.id === "frog")!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });

    it("wire format: the +1/+1 counter survives projection", () => {
        const frog = frogOnBattlefield();
        const handCard = makeInstance(psychicFrog.id, {
            id: "h1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [frog], hand: [handCard] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, frog, "psychic-frog-discard-pump");
        answer(state, ["h1"]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "frog"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("exile-flying ability grants flying until end of turn", () => {
        const frog = frogOnBattlefield();
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [frog] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, frog, "psychic-frog-exile-flying");
        const live = state.players[0].battlefield.find((c) => c.id === "frog")!;
        expect(live.staticAbilities).toContain("flying");
    });
});

// resolvePhlageValue is a resolve() closure (protocol card, ADR 0045): its
// "3 damage to any target" is a choose-damage-target Pending Choice owed to
// the controller (CR 115.4), with an unconditional 3 life gain on top.
// Both of Phlage's value triggers ("When Phlage enters" and "Whenever Phlage
// attacks", each "it deals 3 damage to any target and you gain 3 life") pick
// their "any target" (CR 115.4) when the trigger is PUT ON THE STACK via a
// `targetRequirement`, not at resolution (CR 603.3d, issue #1193). The target
// is therefore subject to hexproof/protection/ward and fires "becomes the
// target of an ability" triggers — the old resolution-time `requestChoice`
// (choose-damage-target Pending Choice) silently skipped that.
describe("Phlage, Titan of Fire's Fury (enters/attacks value: 3 damage any target + gain 3 life, CR 603.3d / 115.4 / 702.138)", () => {
    const enterEvent = (instanceId: string): StackItem["triggerEvent"] =>
        ({
            type: "PERMANENT_ENTERED",
            instanceId,
            controllerId: "p1",
            types: ["Creature"],
        }) as StackItem["triggerEvent"];

    const attackEvent = (attackerId: string): StackItem["triggerEvent"] =>
        ({
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: [attackerId],
        }) as StackItem["triggerEvent"];

    const phlageOnBattlefield = (id: string, controllerId: string) =>
        makeInstance(phlageTitanOfFiresFury.id, {
            id,
            controllerId,
            ownerId: controllerId,
            zone: "battlefield",
        });

    it("enters trigger: 3 damage to the chosen player, controller gains 3 life", () => {
        const phlage = phlageOnBattlefield("phlage", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [phlage] }),
                makePlayer("p2"),
            ],
        });

        pushTrigger(state, phlage, "phlage-enters-value", enterEvent("phlage"));

        // CR 603.3d — the target is chosen when the trigger goes on the stack,
        // BEFORE resolution: no life has been gained yet.
        expect(state.players[0].life).toBe(20);
        choosePhlageTarget(state, { type: "player", id: "p2" });
        expect(resolveTopOfStack(state)).not.toBeNull();

        expect(state.players[1].life).toBe(17); // 3 damage to the opponent
        expect(state.players[0].life).toBe(23); // controller gained 3
    });

    it("attack trigger: 3 damage to the chosen player, controller gains 3 life", () => {
        const phlage = phlageOnBattlefield("phlage", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [phlage] }),
                makePlayer("p2"),
            ],
        });

        pushTrigger(
            state,
            phlage,
            "phlage-attacks-value",
            attackEvent("phlage")
        );
        choosePhlageTarget(state, { type: "player", id: "p2" });
        expect(resolveTopOfStack(state)).not.toBeNull();

        expect(state.players[1].life).toBe(17);
        expect(state.players[0].life).toBe(23);
    });

    it("wire format: 3 damage on the chosen permanent and the life gain survive projection", () => {
        const phlage = phlageOnBattlefield("phlage", "p1");
        const oppBody = phlageOnBattlefield("p2-body", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [phlage] }),
                makePlayer("p2", { battlefield: [oppBody] }),
            ],
        });

        pushTrigger(state, phlage, "phlage-enters-value", enterEvent("phlage"));
        // controller pings the opponent's creature (permanent target ref)
        choosePhlageTarget(state, { type: "permanent", id: "p2-body" });
        resolveTopOfStack(state);

        // GRE: 3 damage marked on the target, controller gained 3 life.
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-body")!
                .damageMarked
        ).toBe(3);
        expect(state.players[0].life).toBe(23);

        // The same visible outcome must survive the wire projection.
        const projected = projectPublicState(state, 1, "p1");
        const slimTarget = projected.players[1].battlefield.find(
            (c) => c.id === "p2-body"
        )!;
        expect(slimTarget.damageMarked).toBe(3);
        expect(projected.players[0].life).toBe(23);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nadu, Winged Wisdom — {1}{G}{U} Legendary Creature — Bird Wizard 3/4.
// "Creatures you control have 'Whenever this creature becomes the target of a
//  spell or ability, reveal the top card of your library. If it's a land card,
//  put it onto the battlefield. Otherwise, put it into your hand. This ability
//  triggers only twice each turn.'"
//
// Three seams, exercised end to end through the REAL machinery rather than by
// asserting on the definition: the CR 611 triggered-grant reaching the right
// creatures, the CR 603.2b BECAME_TARGET firing condition, and the CR 603.2
// per-turn cap.
// ─────────────────────────────────────────────────────────────────────────────

/** Nadu + one other creature, with the static grant applied as the engine
 *  applies it when Nadu enters. */
function withNadu(): {
    state: GameState;
    nadu: CardInstanceState;
    bear: CardInstanceState;
    oppBear: CardInstanceState;
} {
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: [
                    makeInstance(forest.id, {
                        id: "lib-land",
                        controllerId: "p1",
                        zone: "library",
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: "lib-spell",
                        controllerId: "p1",
                        zone: "library",
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: "lib-spell-2",
                        controllerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    const nadu = makeInstance(naduWingedWisdom.id, {
        id: "nadu-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const oppBear = makeInstance(grizzlyBears.id, {
        id: "opp-bear-1",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    state.players[0].battlefield.push(nadu, bear);
    state.players[1].battlefield.push(oppBear);
    applySourceStaticEffects(state, nadu);
    return { state, nadu, bear, oppBear };
}

/** The CR 603.2b target-declaration event the trigger reads (issue #1265). */
function becameTarget(
    instanceId: string,
    targetControllerId: string,
    sourceControllerId: string
): GameEvent {
    return {
        type: "BECAME_TARGET",
        sourceKind: "spell",
        target: { type: "permanent", id: instanceId },
        targetControllerId,
        sourceControllerId,
        sourceInstanceId: "some-stack-item",
    };
}

describe("Nadu, Winged Wisdom ({1}{G}{U} — CR 611 triggered-grant + CR 603.2b became-target + CR 603.2 per-turn cap)", () => {
    it("grants the trigger to creatures you control — including Nadu itself", () => {
        const { bear, nadu } = withNadu();
        for (const c of [bear, nadu]) {
            expect(
                effectiveTriggeredAbilities(c).some(
                    (a) => a.id === "nadu-became-target"
                )
            ).toBe(true);
        }
    });

    it("does NOT grant the trigger to an opponent's creature (CR 611 filter)", () => {
        const { oppBear } = withNadu();
        expect(
            effectiveTriggeredAbilities(oppBear).some(
                (a) => a.id === "nadu-became-target"
            )
        ).toBe(false);
    });

    it("fires when a creature you control becomes the target — including of YOUR OWN spell (unlike ward)", () => {
        const { state } = withNadu();
        const triggers = collectTriggers(state, [
            // sourceController === the creature's controller: Nadu has no
            // "an opponent controls" clause, so this still fires.
            becameTarget("bear-1", "p1", "p1"),
        ]);
        expect(
            triggers.filter(
                (t) =>
                    t.triggeredAbilityId === "nadu-became-target" &&
                    t.triggerSourceId === "bear-1"
            )
        ).toHaveLength(1);
    });

    it("puts a revealed LAND onto the battlefield", () => {
        const { state, bear } = withNadu();
        pushTrigger(
            state,
            bear,
            "nadu-became-target",
            becameTarget("bear-1", "p1", "p1")
        );
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "lib-land"
        );
        // The land ENTERS — it is not played, so no land drop is consumed
        // (CR 305.2 / 400.7).
        expect(state.players[0].landsPlayedThisTurn ?? 0).toBe(0);
    });

    it("puts a revealed NONLAND into hand", () => {
        const { state, bear } = withNadu();
        // Drop the land so the top card is the creature.
        state.players[0].library.shift();
        pushTrigger(
            state,
            bear,
            "nadu-became-target",
            becameTarget("bear-1", "p1", "p1")
        );
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("lib-spell");
    });

    it("triggers only TWICE each turn, per creature (CR 603.2)", () => {
        const { state } = withNadu();
        const fire = (id: string) =>
            collectTriggers(state, [becameTarget(id, "p1", "p1")]).filter(
                (t) => t.triggeredAbilityId === "nadu-became-target"
            ).length;
        expect(fire("bear-1")).toBe(1);
        expect(fire("bear-1")).toBe(1);
        expect(fire("bear-1")).toBe(0);
        // Nadu's own copy has its own untouched quota — "this ability" on a
        // granted ability is per source object.
        expect(fire("nadu-1")).toBe(1);
        expect(fire("nadu-1")).toBe(1);
        expect(fire("nadu-1")).toBe(0);
    });

    it("survives the wire projection — the revealed card is visible to the opponent", () => {
        const { state, bear } = withNadu();
        state.players[0].library.shift(); // top is now the creature
        pushTrigger(
            state,
            bear,
            "nadu-became-target",
            becameTarget("bear-1", "p1", "p1")
        );
        resolveTopOfStack(state);
        // The card rode into p1's HAND, which the projection nulls out for the
        // opponent unless the CR 701.20a reveal stamped it known-to-all.
        const oppView = projectPublicState(state, 1, "p2");
        const revealed = oppView.players[0].hand.find(
            (c) => c !== null && c.id === "lib-spell"
        );
        expect(revealed).toBeDefined();
        expect(revealed!.card.id).toBe(grizzlyBears.id);
    });
});
