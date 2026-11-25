// Magic 2013 (M13) — blue behaviour tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup.helper";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { validateBlockerEligibility } from "../../../../gre/combat";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";
import { preloadDefinitions } from "../../../registry";
import { resolveCardExport } from "../../../defineCard";
import { masterOfThePearlTrident as masterExport } from "../blue.cards";

// The PR head carries no catalogue row for the card (ADR 0157), so register
// the module's own definition.
preloadDefinitions([resolveCardExport(masterExport)!]);

const master = getDefinition("e7decbd3-c754-451c-8d63-4f31f81412d2");
const merfolk = getDefinition("2b871039-6a66-4ac3-95e7-24759c1f2f92");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const island = getDefinition("90a57c0e-fa61-45ef-955d-d296403967d5");

function board() {
    const mine = makeInstance(merfolk.id, { id: "mine" });
    const bear = makeInstance(grizzlyBears.id, { id: "bear" });
    const theirs = makeInstance(merfolk.id, {
        id: "theirs",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [mine, bear] }),
            makePlayer("p2", { battlefield: [theirs] }),
        ],
    });
    pushSpell(state, master.id, "p1");
    resolveTopOfStack(state);
    const find = (p: number, id: string) =>
        state.players[p].battlefield.find((c) => c.id === id)!;
    const lord = state.players[0].battlefield.find(
        (c) => c.card.id === master.id
    )!;
    return { state, find, lord };
}

// Master of the Pearl Trident — "Other Merfolk creatures you control get +1/+1
// and have islandwalk." CR 613.4c (layer-7c buff) and CR 613.1f (layer-6
// grant), scoped to its controller's other Merfolk.
describe("Master of the Pearl Trident (CR 613.4c, CR 613.1f)", () => {
    it("buffs and grants islandwalk to other Merfolk you control only", () => {
        const { state, find, lord } = board();
        const mine = find(0, "mine");
        expect(getEffectivePower(state, mine)).toBe(2);
        expect(getEffectiveToughness(state, mine)).toBe(2);
        expect(mine.staticAbilities).toContain("islandwalk");
        // Not the source itself.
        expect(getEffectivePower(state, lord)).toBe(2);
        expect(lord.staticAbilities ?? []).not.toContain("islandwalk");
        // Not a non-Merfolk you control.
        expect(getEffectivePower(state, find(0, "bear"))).toBe(2);
        // Not an opponent's Merfolk.
        const theirs = find(1, "theirs");
        expect(getEffectivePower(state, theirs)).toBe(1);
        expect(theirs.staticAbilities ?? []).not.toContain("islandwalk");
    });

    it("wire format: the buff and the islandwalk evasion survive projectPublicState", () => {
        const { state } = board();
        const isl = makeInstance(island.id, {
            id: "isl",
            controllerId: "p2",
            ownerId: "p2",
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(isl, blocker);
        const projected = projectPublicState(state, 1, "p1");
        const slim = (p: number, id: string) =>
            projected.players[p].battlefield.find((c) => c.id === id)!;
        const slimMine = slim(0, "mine");
        expect(getEffectivePower(projected, slimMine)).toBe(2);
        expect(slimMine.staticAbilities).toContain("islandwalk");
        expect(
            validateBlockerEligibility(slimMine, slim(1, "blk"), [
                slim(1, "blk"),
                slim(1, "isl"),
            ]).eligible
        ).toBe(false);
    });
});
