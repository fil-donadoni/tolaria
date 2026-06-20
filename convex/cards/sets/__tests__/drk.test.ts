// The Dark (DRK) — per-card behavior tests (twin of leg.test.ts / arn.test.ts).
// Each skeleton card gets a dedicated describe block citing the CR section it
// exercises. Tests assert external behavior only (definition shape, zone after
// resolution, projected wire-format characteristics), per the PRD testing
// decisions (#409).
//
// THIS slice covers the walking skeleton (#410): the `drk` set is registered
// and three vanilla creatures resolve from the stack onto the battlefield and
// survive projection.

import { describe, it, expect } from "vitest";
import { squire, goblinHero, scarwoodGoblins } from "../drk";
import { getCardById, getCardByName, getAllCards } from "../../index";
import { resolveTopOfStack } from "../../../gre/state";
import { projectPublicState } from "../../../gameProjections";
import { makePlayer, makeState, pushSpell } from "../../__tests__/setup";

describe("DRK registry parity", () => {
    it("registers the skeleton creatures by id", () => {
        expect(getCardById(squire.id)).toBe(squire);
        expect(getCardById(goblinHero.id)).toBe(goblinHero);
        expect(getCardById(scarwoodGoblins.id)).toBe(scarwoodGoblins);
    });

    it("registers them by name (debug-panel / pool lookup path)", () => {
        // The Debug-panel preset scenario and the card pool both resolve cards
        // by name via getCardByName (game.ts seedScenario) — registration alone
        // must make the cards reachable.
        expect(getCardByName("Squire")).toBe(squire);
        expect(getCardByName("Goblin Hero")).toBe(goblinHero);
        expect(getCardByName("Scarwood Goblins")).toBe(scarwoodGoblins);
    });

    it("includes them in getAllCards (deck-builder index)", () => {
        const all = getAllCards();
        expect(all).toContain(squire);
        expect(all).toContain(goblinHero);
        expect(all).toContain(scarwoodGoblins);
    });
});

// ---------------------------------------------------------------------------
// Vanilla creatures (CR 302 — Creature cards as pure data: types/subtypes +
// P/T only; values validated against MTGJSON data/json/DRK.json)
// ---------------------------------------------------------------------------

describe("Squire (vanilla creature, CR 302)", () => {
    it("carries the canonical stats from DRK.json", () => {
        expect(squire.types).toEqual(["Creature"]);
        expect(squire.subtypes).toEqual(["Human", "Soldier"]);
        expect(squire.power).toBe(1);
        expect(squire.toughness).toBe(2);
        expect(squire.manaCost).toEqual({ X: 1, W: 1 });
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, squire.id, "p1");
        resolveTopOfStack(state);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });
});

describe("Goblin Hero (vanilla creature, CR 302)", () => {
    it("carries the canonical stats from DRK.json", () => {
        expect(goblinHero.types).toEqual(["Creature"]);
        expect(goblinHero.subtypes).toEqual(["Goblin"]);
        expect(goblinHero.power).toBe(2);
        expect(goblinHero.toughness).toBe(2);
        expect(goblinHero.manaCost).toEqual({ X: 2, R: 1 });
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, goblinHero.id, "p1");
        resolveTopOfStack(state);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });
});

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
