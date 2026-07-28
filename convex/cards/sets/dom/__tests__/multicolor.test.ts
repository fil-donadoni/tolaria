// dom (Dominaria) — multicolor behavior tests (ADR 0043 colour split).
//
// Teferi, Hero of Dominaria (issue #1726). The +1 drives a delayed trigger
// (CR 603.7a) whose body raises a live "untap up to two lands" pick through
// the standard Pending Choice pipeline; the −3 exercises the moveZone
// positional library insert end to end through the loyalty path (CR 400.7,
// the interpreter suite owns the Op-level cases); the −8 asserts the second
// targeted triggered emblem (CR 114 / 603.3d — same `inlineTargetRequirement`
// seam Chandra, Torch of Defiance's −7 validates).

import { describe, it, expect } from "vitest";
import { teferiHeroOfDominaria } from "../multicolor";
import { elvishArchers } from "../../lea/green";
import { island } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { TEFERI_HERO_OF_DOMINARIA_EMBLEM_ID } from "../../../emblems";
import { PERMANENT_TYPES } from "../../../types";
import type { GameEvent, TargetSelection } from "../../../types";

const PLUS1 = "teferi-hero-of-dominaria-plus1";
const MINUS3 = "teferi-hero-of-dominaria-minus3";
const MINUS8 = "teferi-hero-of-dominaria-minus8";

function teferiOnBattlefield(loyalty = 4) {
    return makeInstance(teferiHeroOfDominaria.id, {
        id: "teferi1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Teferi's loyalty abilities on the stack and resolves it
 *  through the real path (the loyalty framework's cost payment is exercised
 *  in game.ts; the card test asserts the EFFECT — mirrors the Chandra test
 *  harness). */
function activate(
    state: GameState,
    abilityId: string,
    targets?: TargetSelection[]
): void {
    const teferi = state.players[0].battlefield.find(
        (c) => c.id === "teferi1"
    )!;
    state.stack.push({
        ...teferi,
        zone: "stack",
        castById: "p1",
        abilityId,
        ...(targets ? { targets } : {}),
    });
    resolveTopOfStack(state);
}

describe("Teferi, Hero of Dominaria — loyalty ability snapshot (CR 306, ADR 0058)", () => {
    it("is a 4-loyalty legendary Teferi planeswalker with three loyalty abilities", () => {
        expect(teferiHeroOfDominaria.types).toEqual(["Planeswalker"]);
        expect(teferiHeroOfDominaria.supertypes).toEqual(["Legendary"]);
        expect(teferiHeroOfDominaria.subtypes).toEqual(["Teferi"]);
        expect(teferiHeroOfDominaria.loyalty).toBe(4);
        expect(teferiHeroOfDominaria.manaCost).toEqual({ X: 3, W: 1, U: 1 });
        const abilities = teferiHeroOfDominaria.activatedAbilities!;
        expect(abilities.map((a) => a.id)).toEqual([PLUS1, MINUS3, MINUS8]);
        expect(abilities.map((a) => a.cost.loyalty)).toEqual([1, -3, -8]);
        // DSL-first (ADR 0045): no resolve() anywhere on the card.
        expect(abilities.every((a) => a.resolve === undefined)).toBe(true);
        expect(teferiHeroOfDominaria.resolve).toBeUndefined();
    });
});

describe("Teferi, Hero of Dominaria — +1 (draw + next-end-step untap up to two lands, CR 603.7a)", () => {
    it("draws a card and schedules the delayed untap; firing it raises the land pick and untaps the picks", () => {
        const libTop = makeInstance(elvishArchers.id, {
            id: "libTop",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const landA = makeInstance(island.id, {
            id: "landA",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const landB = makeInstance(island.id, {
            id: "landB",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const landC = makeInstance(island.id, {
            id: "landC",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [teferiOnBattlefield(), landA, landB, landC],
                    library: [libTop],
                }),
                makePlayer("p2"),
            ],
        });
        activate(state, PLUS1);
        // "Draw a card."
        expect(state.players[0].hand.some((c) => c.id === "libTop")).toBe(
            true
        );
        // CR 603.7a — the next-end-step untap is scheduled.
        expect(state.delayedTriggers?.length).toBe(1);
        expect(state.delayedTriggers![0].timing).toBe("next-end-step");

        // Fire the delayed trigger: its body suspends on the land pick.
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        const pick = state.pendingChoices![0];
        expect(pick.playerId).toBe("p1");
        // "Up to two": a 0..2 range over the controller's lands.
        expect(pick.count).toEqual({ min: 0, max: 2 });

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["landA", "landC"],
        });
        const byId = (id: string) =>
            state.players[0].battlefield.find((c) => c.id === id)!;
        expect(byId("landA").isTapped).toBe(false);
        expect(byId("landC").isTapped).toBe(false);
        // The un-picked land stays tapped.
        expect(byId("landB").isTapped).toBe(true);
        // Consumed: no further pending choice, trigger off the stack.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });
});

describe("Teferi, Hero of Dominaria — −3 (library third from the top, CR 400.7, issue #1726)", () => {
    it("puts the target nonland permanent into its owner's library third from the top (wire format)", () => {
        const bear = makeInstance(elvishArchers.id, {
            id: "bearT",
            controllerId: "p2",
            ownerId: "p2",
        });
        const library = ["l1", "l2", "l3"].map((lid) =>
            makeInstance(elvishArchers.id, {
                id: lid,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [teferiOnBattlefield()] }),
                makePlayer("p2", { battlefield: [bear], library }),
            ],
        });
        activate(state, MINUS3, [{ type: "permanent", id: "bearT" }]);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].library.map((c) => c.id)).toEqual([
            "l1",
            "l2",
            "bearT",
            "l3",
        ]);
        // Wire: the permanent is gone from the projected battlefield and the
        // projected library count grew.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].battlefield).toHaveLength(0);
        expect(projected.players[1].library.count).toBe(4);
    });
});

describe("Teferi, Hero of Dominaria — −8 emblem (targeted triggered emblem, CR 114 / 603.3d)", () => {
    it("creates the emblem; the owner's draw exiles a target permanent an opponent controls", () => {
        const target = makeInstance(elvishArchers.id, {
            id: "oppPerm",
            controllerId: "p2",
            ownerId: "p2",
        });
        // A second legal target keeps the pick a REAL choice (a lone legal
        // target is auto-selected by `raiseTriggerTargetSelection`).
        const other = makeInstance(island.id, {
            id: "oppLand",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [teferiOnBattlefield(8)] }),
                makePlayer("p2", { battlefield: [target, other] }),
            ],
        });
        activate(state, MINUS8);
        expect(state.emblems).toHaveLength(1);
        expect(state.emblems![0]).toMatchObject({
            ownerId: "p1",
            emblemId: TEFERI_HERO_OF_DOMINARIA_EMBLEM_ID,
        });

        // p1 draws → the emblem's owner-scoped trigger fires with the
        // "target permanent an opponent controls" requirement inline.
        const drawn: GameEvent = {
            type: "CARD_DRAWN",
            playerId: "p1",
            count: 1,
        } as GameEvent;
        const triggers = collectTriggers(state, [drawn]);
        expect(triggers).toHaveLength(1);
        expect(triggers[0].emblemSourceId).toBe(
            TEFERI_HERO_OF_DOMINARIA_EMBLEM_ID
        );
        expect(triggers[0].inlineTargetRequirement).toEqual({
            type: [...PERMANENT_TYPES],
            count: 1,
            controller: "opponent",
        });
        placeTriggersOnStack(state, triggers);

        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget!.kind).toBe("trigger");
        state.pendingTarget!.selected = [{ type: "permanent", id: "oppPerm" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "oppPerm")
        ).toBe(false);
        expect(state.players[1].exile.some((c) => c.id === "oppPerm")).toBe(
            true
        );

        // CR 114.3 owner-scoped "you": the OPPONENT drawing does not fire it.
        const p2Draw: GameEvent = { ...drawn, playerId: "p2" } as GameEvent;
        expect(collectTriggers(state, [p2Draw])).toHaveLength(0);
    });
});
