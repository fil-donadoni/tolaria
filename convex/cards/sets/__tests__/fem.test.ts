// Fallen Empires (FEM) — per-card behavior tests (twin of drk.test.ts /
// leg.test.ts). Each card gets a dedicated describe block citing the CR section
// it exercises. Tests assert external behavior only (definition shape, zone
// after resolution, projected wire-format characteristics, multi-art print
// resolution), per the PRD testing decisions (#566).
//
// THIS slice covers the walking skeleton (#567): the `fem` set is registered
// and Vodalian Soldiers — a {1}{U} 1/2 vanilla Merfolk Soldier — resolves from
// the stack onto the battlefield and survives projection, with all four FEM
// artworks resolving to the one shared definition.

import { describe, it, expect } from "vitest";
import {
    vodalianSoldiers,
    vodalianSoldiersFemB,
    vodalianSoldiersFemC,
    vodalianSoldiersFemD,
} from "../fem";
import {
    getCardById,
    getCardByName,
    getAllCards,
    getAllSetCodes,
    getPrintingsForCard,
} from "../../index";
import { resolveTopOfStack } from "../../../gre/state";
import { projectPublicState } from "../../../gameProjections";
import { makePlayer, makeState, pushSpell } from "../../__tests__/setup";

const ALL_FEM_PRINTS = [
    vodalianSoldiersFemB,
    vodalianSoldiersFemC,
    vodalianSoldiersFemD,
];

// ---------------------------------------------------------------------------
// Registry parity — the set must be reachable by id, by name and in the
// deck-builder index (the pool / debug-panel lookup paths).
// ---------------------------------------------------------------------------

describe("FEM registry parity", () => {
    it("registers Vodalian Soldiers by id", () => {
        expect(getCardById(vodalianSoldiers.id)).toBe(vodalianSoldiers);
    });

    it("registers it by name (debug-panel / pool lookup path)", () => {
        expect(getCardByName("Vodalian Soldiers")).toBe(vodalianSoldiers);
    });

    it("includes it in getAllCards (deck-builder index)", () => {
        expect(getAllCards()).toContain(vodalianSoldiers);
    });

    it("registers the fem set code in the catalogue", () => {
        expect(getAllSetCodes()).toContain("fem");
    });
});

// ---------------------------------------------------------------------------
// Vanilla creature (CR 302 — Creature card as pure data: types/subtypes + P/T
// only; values validated against Scryfall set:fem, modern Oracle).
// ---------------------------------------------------------------------------

describe("Vodalian Soldiers (vanilla creature, CR 302)", () => {
    it("carries the canonical FEM printed characteristics", () => {
        expect(vodalianSoldiers.types).toEqual(["Creature"]);
        expect(vodalianSoldiers.subtypes).toEqual(["Merfolk", "Soldier"]);
        expect(vodalianSoldiers.power).toBe(1);
        expect(vodalianSoldiers.toughness).toBe(2);
        expect(vodalianSoldiers.manaCost).toEqual({ X: 1, U: 1 });
        expect(vodalianSoldiers.rarity).toBe("common");
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, vodalianSoldiers.id, "p1");
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
        const item = pushSpell(state, vodalianSoldiers.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(slim).toBeDefined();
        const def = getCardById((slim!.card as { id: string }).id);
        expect(def.name).toBe("Vodalian Soldiers");
        expect(def.subtypes).toEqual(["Merfolk", "Soldier"]);
        expect(def.power).toBe(1);
        expect(def.toughness).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Multi-art prints (ADR 0014) — FEM's signature multi-artwork commons ship as
// one shared CardDefinition plus one CardPrint per additional artwork. Every
// artwork must resolve to the single definition and carry the fem set code.
// ---------------------------------------------------------------------------

describe("Vodalian Soldiers multi-art prints (ADR 0014)", () => {
    it("resolves every alternate artwork to the shared definition", () => {
        for (const print of ALL_FEM_PRINTS) {
            expect(getCardById(print.printId)).toBe(vodalianSoldiers);
            expect(print.definitionId).toBe(vodalianSoldiers.id);
        }
    });

    it("carries the fem set code and common rarity on every print", () => {
        for (const print of ALL_FEM_PRINTS) {
            expect(print.setCode).toBe("fem");
            expect(print.rarity).toBe("common");
        }
    });

    it("uses a distinct printId per artwork (no duplicates)", () => {
        const ids = [
            vodalianSoldiers.id,
            ...ALL_FEM_PRINTS.map((p) => p.printId),
        ];
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("lists all FEM artworks as printings, original first (deck builder)", () => {
        const printings = getPrintingsForCard(vodalianSoldiers.id);
        expect(printings[0]).toEqual({
            printId: vodalianSoldiers.id,
            setCode: "fem",
        });
        for (const print of ALL_FEM_PRINTS) {
            expect(printings).toContainEqual({
                printId: print.printId,
                setCode: "fem",
            });
        }
        expect(printings).toHaveLength(1 + ALL_FEM_PRINTS.length);
    });
});
