// Token catalogue (CR 111 / 707.2) — the static derivation of every token
// SHAPE the card pool can create, which is what lets a debug scenario stage a
// board with tokens on it (a token has no `CardDefinition`, so it is
// unreachable through `getCardByName`).
//
// The catalogue is derived, not authored, so these tests pin its CONTRACT
// (unique keys, art resolution, name-vs-key lookup) rather than an exact
// membership list that every new token-producing card would churn.

import { describe, expect, it } from "vitest";
import {
    findTokenSpec,
    getAllTokenKeys,
    listTokenCatalogue,
} from "../tokenCatalogue";
import { tokenDefinitionId } from "../index";
import { TREASURE_TOKEN } from "../sharedTokens";

describe("token catalogue (CR 111 / 707.2)", () => {
    it("derives a non-empty catalogue from the card pool", () => {
        expect(listTokenCatalogue().length).toBeGreaterThan(10);
    });

    it("keys are unique — every shape stays individually reachable", () => {
        const keys = getAllTokenKeys();
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("picks up a token from a DSL `createToken` Op (The Hive's Wasp)", () => {
        const wasp = findTokenSpec("Wasp");
        expect(wasp).toBeDefined();
        expect(wasp!.types).toContain("Creature");
        expect(wasp!.power).toBe(1);
        expect(wasp!.toughness).toBe(1);
        expect(wasp!.staticAbilities).toContain("flying");
    });

    it("resolves token art the way `SpellContext.createToken` does at runtime", () => {
        // The Hive's Wasp has no explicit `imagePrintId` on the spec — the art
        // comes from the build-time Scryfall reverse-link keyed by (producing
        // card id, token name). A catalogue entry must carry it, or a scenario
        // token would render as a bare placeholder.
        expect(findTokenSpec("Wasp")?.imagePrintId).toBe(
            "09921372-126f-4c81-b6d8-ea50b1d0eb44"
        );
    });

    it("includes a shared spec whose art is pinned on the spec itself", () => {
        const treasure = findTokenSpec("Treasure");
        expect(treasure).toBeDefined();
        expect(treasure!.imagePrintId).toBe(TREASURE_TOKEN.imagePrintId);
        // CR 707.2 — the shared Treasure carries its mana ability, and the
        // catalogue must not strip it (a scenario Treasure has to be
        // sacrificeable for mana like a real one).
        expect(treasure!.activatedAbilities?.length).toBeGreaterThan(0);
    });

    it("collapses the same shape produced by different cards into ONE entry", () => {
        const entries = listTokenCatalogue();
        const shapeIds = entries.map((e) =>
            tokenDefinitionId({ ...e.spec, imagePrintId: undefined })
        );
        expect(new Set(shapeIds).size).toBe(shapeIds.length);
    });

    it("disambiguates two DIFFERENT shapes that share a name", () => {
        const entries = listTokenCatalogue();
        const byName = new Map<string, number>();
        for (const e of entries) {
            byName.set(e.name, (byName.get(e.name) ?? 0) + 1);
        }
        for (const [name, count] of byName) {
            const keys = entries
                .filter((e) => e.name === name)
                .map((e) => e.key);
            if (count === 1) {
                // A unique name stays a bare, typeable name.
                expect(keys).toEqual([name]);
            } else {
                // Colliding names carry a characteristics suffix.
                for (const key of keys) expect(key).not.toBe(name);
            }
        }
    });

    it("`findTokenSpec` matches a catalogue key and a bare name, case-insensitively", () => {
        const entry = listTokenCatalogue()[0];
        expect(findTokenSpec(entry.key)).toBe(entry.spec);
        expect(findTokenSpec(entry.key.toUpperCase())).toBe(entry.spec);
        expect(findTokenSpec(entry.name.toLowerCase())?.name).toBe(entry.name);
    });

    it("returns undefined for an unknown or empty reference", () => {
        expect(findTokenSpec("Not A Token At All")).toBeUndefined();
        expect(findTokenSpec("   ")).toBeUndefined();
    });
});
