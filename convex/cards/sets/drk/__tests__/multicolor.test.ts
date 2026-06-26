// Per-card behavior tests for multicolor cards in `convex/cards/sets/drk/multicolor.ts`
// (The Dark, split by colour per ADR 0043). Each non-trivial card gets a
// describe block citing the CR section it exercises; set-wide registry-parity
// checks live in colorless.test.ts. Shared stack/resolve shims live in
// ./helpers; fixtures stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import { darkHeartOfTheWood, marshGoblins, scarwoodGoblins } from "..";
import { resolveActivated } from "./helpers";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack } from "../../../../gre/state";
import { getCardById } from "../../../index";

describe("Scarwood Goblins (vanilla creature, CR 302)", () => {
    it("carries the canonical stats from DRK.json", () => {
        expect(scarwoodGoblins.types).toEqual(["Creature"]);
        expect(scarwoodGoblins.subtypes).toEqual(["Goblin"]);
        expect(scarwoodGoblins.power).toBe(2);
        expect(scarwoodGoblins.toughness).toBe(2);
        expect(scarwoodGoblins.manaCost).toEqual({ R: 1, G: 1 });
    });

    it("resolves onto the battlefield and survives projection (CR 608.3)", () => {
        // Wire-format guard: the slim projected instance keeps only `{ id }` on
        // card.card, so its definition must be recoverable from the registry by
        // id after projectPublicState (the card survives the wire).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, scarwoodGoblins.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(slim).toBeDefined();
        const def = getCardById((slim!.card as { id: string }).id);
        expect(def.name).toBe("Scarwood Goblins");
        expect(def.subtypes).toEqual(["Goblin"]);
    });
});

describe("Marsh Goblins — {B}{R} 1/1 Goblin with swampwalk (CR 702.14)", () => {
    it("is a 1/1 Goblin for {B}{R} with swampwalk", () => {
        expect(marshGoblins.manaCost).toEqual({ B: 1, R: 1 });
        expect(marshGoblins.subtypes).toEqual(["Goblin"]);
        expect(marshGoblins.power).toBe(1);
        expect(marshGoblins.toughness).toBe(1);
        expect(marshGoblins.staticAbilities).toContain("swampwalk");
    });
});

describe("Dark Heart of the Wood — Sacrifice a Forest: gain 3 life (CR 118.5 / 119.3)", () => {
    it("is a {B}{G} Enchantment with a sacrifice-a-Forest cost", () => {
        expect(darkHeartOfTheWood.manaCost).toEqual({ B: 1, G: 1 });
        expect(darkHeartOfTheWood.types).toEqual(["Enchantment"]);
        const ab = darkHeartOfTheWood.activatedAbilities![0];
        expect(ab.cost).toEqual({ sacrificeFilter: { subtypes: "Forest" } });
    });

    it("the ability gains its controller 3 life on resolution (CR 119.3)", () => {
        const dh = makeInstance(darkHeartOfTheWood.id, {
            id: "dh",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dh] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, dh, "dark-heart-of-the-wood-gain", []);
        expect(state.players[0].life).toBe(23); // 20 + 3
    });
});
