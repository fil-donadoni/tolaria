// FIN (Final Fantasy) — colorless card behavior tests (ADR 0043 colour
// split). Starting Town (issue #1306, parent PRD #620): CR 614.1c
// self-conditional tapped-entry (turn-gated) + TWO independent {T} mana
// abilities with different costs — the exact multi-ability shape the
// #675-era stub believed unsupported. Re-audit found `tapUntap` /
// `tapSourceIntoPayment` already resolve a submitted `manaChoiceIndex`
// against the UNIFIED option list across every `activatedAbilities` entry
// (`getManaTapOptionsDetailed`), carrying the CHOSEN ability's own
// `cost.life` through `applyManaAbilityLifeCost` — so this is just two plain
// activated mana abilities, no new primitive needed.

import { describe, it, expect } from "vitest";
import { startingTown } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    getManaTapOptions,
    getManaTapOptionsDetailed,
} from "../../../../gre/constants";
import { tapSourceIntoPayment } from "../../../../game";

describe("Starting Town (CR 614.1c turn-gated tapped-entry + two {T} mana abilities)", () => {
    it("declares a turn-gated entersTappedUnless and two independently-costed activated abilities", () => {
        expect(startingTown.types).toEqual(["Land"]);
        expect(startingTown.subtypes).toEqual(["Town"]);
        expect(startingTown.entersTappedUnless).toBeTypeOf("function");
        expect(startingTown.entersTapped).toBeUndefined();
        const [colorless, anyColor] = startingTown.activatedAbilities!;
        expect(colorless.cost).toEqual({ tap: true });
        expect(colorless.manaProduced).toEqual({ C: 1 });
        expect(anyColor.cost).toEqual({ tap: true, life: 1 });
        expect(anyColor.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });

    it.each([1, 2, 3])(
        "the entersTappedUnless predicate is satisfied on turn %i (your first/second/third turn of the game)",
        (turn) => {
            expect(
                startingTown.entersTappedUnless!({ players: [], turn }, "p1")
            ).toBe(true);
        }
    );

    it.each([4, 5, 10])(
        "the entersTappedUnless predicate is NOT satisfied from turn %i onward",
        (turn) => {
            expect(
                startingTown.entersTappedUnless!({ players: [], turn }, "p1")
            ).toBe(false);
        }
    );

    it("exposes exactly 6 tap options: {C} plus the 5 any-colour choices", () => {
        const town = makeInstance(startingTown.id, { controllerId: "p1" });
        expect(getManaTapOptions(town)).toEqual([
            { C: 1 },
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
        const detailed = getManaTapOptionsDetailed(town);
        expect(detailed[0].source).toMatchObject({
            kind: "activated",
            abilityId: "starting-town-colorless",
        });
        expect(detailed[1].source).toMatchObject({
            kind: "activated",
            abilityId: "starting-town-any-color",
        });
    });

    it("tapping for {C} (index 0) costs no life", () => {
        const town = makeInstance(startingTown.id, {
            id: "town-1",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [town] }),
                makePlayer("p2"),
            ],
        });
        const player = state.players[0];
        tapSourceIntoPayment(state, player, town, 0, []);
        expect(player.manaPool.C).toBe(1);
        expect(player.life).toBe(20);
    });

    it("tapping for a colour (index 1 = {W}) costs 1 life — the OTHER ability's cost, not the free one's", () => {
        const town = makeInstance(startingTown.id, {
            id: "town-1",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [town] }),
                makePlayer("p2"),
            ],
        });
        const player = state.players[0];
        tapSourceIntoPayment(state, player, town, 1, []);
        expect(player.manaPool.W).toBe(1);
        expect(player.life).toBe(19);
    });
});
