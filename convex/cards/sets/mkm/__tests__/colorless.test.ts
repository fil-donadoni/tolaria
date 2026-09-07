// MKM — colorless card behavior tests (ADR 0043 colour split).
//
// The "surveil land" cycle is the first CARD-level consumer of the surveil
// (CR 701.25 surveil) shape — `scryReorder` with `destination: "graveyard"`. The Op
// itself is exercised in the interpreter suite; these tests lock the
// `makeDualLand({ surveilLand })` factory branch: the produced definition
// shape (enters tapped, dual mana, self-ETB trigger) and one end-to-end
// surveil resolution through the real trigger → PendingChoice path.
import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { CardDefinition } from "../../../types";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { getCardByName } from "../../../index";
import { getDefinition } from "../../../index";

const commercialDistrict = getDefinition(
    "bf220c06-3cce-4bdd-aa58-83940c223e9c"
);
const elegantParlor = getDefinition("72c6d541-e2cb-4d6e-acac-90a8f53b7006");
const hedgeMaze = getDefinition("5260f8ae-805b-4eae-badf-62de0f768867");
const lushPortico = getDefinition("c17816e8-28b1-4295-a637-efb0e5c18873");
const meticulousArchive = getDefinition("652236c2-84ef-45e4-b5fc-ed6170bc3d6c");
const raucousTheater = getDefinition("b598c93e-dae1-4d71-a9e4-917abf76d2d0");
const shadowyBackstreet = getDefinition("69c1b656-1d67-499c-bf0f-417682a86c7d");
const thunderingFalls = getDefinition("17260fff-b239-4af4-9306-3236ae3fa5a5");
const undercitySewers = getDefinition("2b5801fb-2026-4f25-98bc-ebb2f99684b9");
const undergroundMortuary = getDefinition(
    "f6ca59cd-8779-4a84-a54b-e863b79c61f0"
);

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

describe("MKM surveil lands (CR 701.25)", () => {
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
        const top = makeInstance(
            getDefinition("90a57c0e-fa61-45ef-955d-d296403967d5").id,
            {
                id: "top1",
                zone: "library",
                ownerId: "p1",
                controllerId: "p1",
            }
        );
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
