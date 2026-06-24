// Ice Age (ICE) — per-card behavior tests (twin of fem.test.ts / drk.test.ts /
// leg.test.ts). Each card gets a dedicated describe block citing the CR section
// it exercises; tests assert external behavior only (definition shape, zone
// after resolution, wire-format survival), per the PRD testing decisions
// (#628).
//
// THIS slice covers the walking skeleton (#629): the `ice` set is registered
// and Balduvian Bears — a {1}{G} 2/2 vanilla Bear — resolves from the stack
// onto the battlefield and survives projection. Every other ICE card is present
// as a commented-out stub and is exercised by its owning colour batch /
// capability cluster once uncommented.

import { describe, it, expect } from "vitest";
import { balduvianBears } from "../ice";
import {
    getCardById,
    getCardByName,
    getAllCards,
    getAllSetCodes,
} from "../../index";
import { resolveTopOfStack } from "../../../gre/state";
import { projectPublicState } from "../../../gameProjections";
import { makePlayer, makeState, pushSpell } from "../../__tests__/setup";

// ---------------------------------------------------------------------------
// Registry parity — the set file is wired into the registry and the tracer is
// reachable by id, by name, in the deck-builder index, and the set code is
// catalogued.
// ---------------------------------------------------------------------------

describe("ICE registry parity", () => {
    it("registers Balduvian Bears by id", () => {
        expect(getCardById(balduvianBears.id)).toBe(balduvianBears);
    });

    it("registers it by name (debug-panel / pool lookup path)", () => {
        expect(getCardByName("Balduvian Bears")).toBe(balduvianBears);
    });

    it("includes it in getAllCards (deck-builder index)", () => {
        expect(getAllCards()).toContain(balduvianBears);
    });

    it("registers the ice set code in the catalogue", () => {
        expect(getAllSetCodes()).toContain("ice");
    });
});

// ---------------------------------------------------------------------------
// Vanilla creature (CR 302 — Creature card as pure data: types/subtypes + P/T
// only; values validated against the ICE MTGJSON blob / Scryfall set:ice).
// ---------------------------------------------------------------------------

describe("Balduvian Bears (vanilla creature, CR 302)", () => {
    it("carries the canonical ICE printed characteristics", () => {
        expect(balduvianBears.types).toEqual(["Creature"]);
        expect(balduvianBears.subtypes).toEqual(["Bear"]);
        expect(balduvianBears.power).toBe(2);
        expect(balduvianBears.toughness).toBe(2);
        expect(balduvianBears.manaCost).toEqual({ X: 1, G: 1 });
        expect(balduvianBears.rarity).toBe("common");
        expect(balduvianBears.oracleText).toBe("");
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, balduvianBears.id, "p1");
        resolveTopOfStack(state);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });

    it("resolves onto the battlefield and survives projection (CR 608.3)", () => {
        // Wire-format guard: the slim projected instance keeps only `{ id }` on
        // card.card, so its definition must be recoverable from the registry by
        // id after projectPublicState (the card survives the wire).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, balduvianBears.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(slim).toBeDefined();
        const def = getCardById((slim!.card as { id: string }).id);
        expect(def.name).toBe("Balduvian Bears");
        expect(def.subtypes).toEqual(["Bear"]);
        expect(def.power).toBe(2);
        expect(def.toughness).toBe(2);
    });
});
