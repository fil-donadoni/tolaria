// MKM — colorless card behavior tests (ADR 0043 colour split).
//
// The "surveil land" cycle is the first CARD-level consumer of the surveil
// (CR 701.44) shape — `scryReorder` with `destination: "graveyard"`. The Op
// itself is exercised in the interpreter suite; these tests lock the
// `makeDualLand({ surveilLand })` factory branch: the produced definition
// shape (enters tapped, dual mana, self-ETB trigger) and one end-to-end
// surveil resolution through the real trigger → PendingChoice path.
import { describe, it, expect } from "vitest";
import {
    commercialDistrict,
    elegantParlor,
    hedgeMaze,
    lushPortico,
    meticulousArchive,
    raucousTheater,
    shadowyBackstreet,
    thunderingFalls,
    undercitySewers,
    undergroundMortuary,
} from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { CardDefinition } from "../../../types";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { getCardByName } from "../../../index";

const CYCLE: { card: CardDefinition; subtypes: [string, string] }[] = [
    { card: commercialDistrict, subtypes: ["Mountain", "Forest"] },
    { card: elegantParlor, subtypes: ["Mountain", "Plains"] },
    { card: hedgeMaze, subtypes: ["Forest", "Island"] },
    { card: lushPortico, subtypes: ["Forest", "Plains"] },
    { card: meticulousArchive, subtypes: ["Plains", "Island"] },
    { card: raucousTheater, subtypes: ["Swamp", "Mountain"] },
    { card: shadowyBackstreet, subtypes: ["Plains", "Swamp"] },
    { card: thunderingFalls, subtypes: ["Island", "Mountain"] },
    { card: undercitySewers, subtypes: ["Island", "Swamp"] },
    { card: undergroundMortuary, subtypes: ["Swamp", "Forest"] },
];

describe("MKM surveil lands (CR 701.44)", () => {
    it("every card resolves in the registry by name", () => {
        for (const { card } of CYCLE) {
            expect(getCardByName(card.name)).toBe(card);
        }
    });

    it("carries a self-ETB surveil 1 trigger (scryReorder → graveyard)", () => {
        const trigger = undercitySewers.triggeredAbilities![0];
        expect(trigger.event).toBe("PERMANENT_ENTERED");
        expect(trigger.effects).toEqual([
            {
                op: "scryReorder",
                player: "controller",
                count: 1,
                destination: "graveyard",
            },
        ]);
        // Fires only for THIS permanent entering, not any other.
        const self = makeInstance(undercitySewers.id, { id: "land1" });
        expect(
            trigger.matches(
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: "land1",
                    controllerId: "p1",
                    types: ["Land"],
                },
                self
            )
        ).toBe(true);
        expect(
            trigger.matches(
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: "other",
                    controllerId: "p1",
                    types: ["Land"],
                },
                self
            )
        ).toBe(false);
    });

    it("surveils the top card into the graveyard when resolved end-to-end", () => {
        const land = makeInstance(undercitySewers.id, { id: "land1" });
        const top = makeInstance(getCardByName("Island").id, {
            id: "top1",
            zone: "library",
            ownerId: "p1",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land], library: [top] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...land,
            id: "trig-surveil",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: undercitySewers.triggeredAbilities![0].id,
            triggerSourceId: "land1",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "land1",
                controllerId: "p1",
                types: land.types,
            },
            targets: [],
        });
        // scryReorder suspends: resolving raises the order-top PendingChoice.
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.destination).toBe("graveyard");
        // Keep nothing on top; surveil the looked-at card into the graveyard.
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
            secondZoneIds: ["top1"],
        });
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("top1");
        expect(state.players[0].library.map((c) => c.id)).not.toContain("top1");
    });
});
