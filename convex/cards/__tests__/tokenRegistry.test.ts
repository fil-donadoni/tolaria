// Regression guard for token CardDefinition lookup (CR 111, 707.1).
//
// Background: tokens have no Scryfall print — `createToken` synthesizes a
// CardDefinition and registers it server-side via `registerTokenDefinition`.
// The frontend bundle, however, ships its own `convex/cards/index.ts` registry
// instance. When projected token instances arrive on the client with their
// content-derived `card.id` (e.g. `token:Wasp|Artifact,Creature|Insect||1|1||flying`),
// the client-side registry has never seen the registration call and would
// throw "Card not found" out of `getDefinition`, crashing rendering.
//
// `getDefinition` / `tryGetDefinition` therefore lazy-synthesize a definition
// from the id parts on demand and memoize the result. These tests pin that
// behavior so the client crash documented in production doesn't regress.

import { describe, it, expect } from "vitest";
import {
    getDefinition,
    registerTokenDefinition,
    tryGetDefinition,
} from "../index";
import type { CardDefinition } from "../types";

describe("token CardDefinition lookup (regression — client lazy synthesis)", () => {
    const WASP_ID = "token:Wasp|Artifact,Creature|Insect||1|1||flying";

    it("getDefinition synthesizes a CardDefinition from a `token:` id when not registered", () => {
        // Client cold-start path: bundle has never seen `registerTokenDefinition`
        // for this id. Lookup must NOT throw.
        const def = getDefinition(WASP_ID);
        expect(def.name).toBe("Wasp");
        expect(def.types).toEqual(["Artifact", "Creature"]);
        expect(def.subtypes).toEqual(["Insect"]);
        expect(def.power).toBe(1);
        expect(def.toughness).toBe(1);
        expect(def.staticAbilities).toContain("flying");
    });

    it("tryGetDefinition matches getDefinition for a `token:` id", () => {
        const def = tryGetDefinition(WASP_ID);
        expect(def).not.toBeNull();
        expect(def!.id).toBe(WASP_ID);
    });

    it("synthesized def is memoized (subsequent calls return the same object)", () => {
        const a = getDefinition(WASP_ID);
        const b = getDefinition(WASP_ID);
        expect(a).toBe(b);
    });

    it("explicit registration takes precedence over the synthesized form", () => {
        const id = "token:Soldier|Creature|Soldier||1|1|W|";
        const explicit: CardDefinition = {
            id,
            name: "Soldier",
            rarity: "common",
            types: ["Creature"],
            subtypes: ["Soldier"],
            power: 1,
            toughness: 1,
            manaCost: { W: 1 },
        };
        registerTokenDefinition(explicit);
        const fetched = getDefinition(id);
        expect(fetched).toBe(explicit);
    });

    it("colors in the id are decoded into a synthetic manaCost", () => {
        const id = "token:Spirit|Creature|Spirit||1|1|W|flying";
        const def = getDefinition(id);
        expect(def.manaCost).toEqual({ W: 1 });
        // A 2-color token: both letters → both entries in manaCost.
        const id2 = "token:Hybrid|Creature|||1|1|UB|";
        const def2 = getDefinition(id2);
        expect(def2.manaCost).toEqual({ U: 1, B: 1 });
    });

    it("unknown non-`token:` ids still throw (no accidental fallback)", () => {
        expect(() => getDefinition("not-a-real-id")).toThrow(/Card not found/);
        expect(tryGetDefinition("not-a-real-id")).toBeNull();
    });

    it("malformed `token:` id (too few parts) is rejected", () => {
        // Only 3 parts — synthesizer needs at least 8.
        expect(() => getDefinition("token:Foo|Creature|")).toThrow(
            /Card not found/
        );
        expect(tryGetDefinition("token:Foo|Creature|")).toBeNull();
    });

    it("9th segment is decoded as imagePrintId (Scryfall token print id)", () => {
        const id =
            "token:Wasp|Artifact,Creature|Insect||1|1||flying|09921372-126f-4c81-b6d8-ea50b1d0eb44";
        const def = getDefinition(id);
        expect(def.imagePrintId).toBe("09921372-126f-4c81-b6d8-ea50b1d0eb44");
    });

    it("missing/empty 9th segment leaves imagePrintId undefined", () => {
        // Trailing | with nothing after is treated as "no print" → placeholder
        // path on the client.
        const id = "token:Phantom|Creature|Spirit||2|2||";
        const def = getDefinition(id);
        expect(def.imagePrintId).toBeUndefined();
    });
});
