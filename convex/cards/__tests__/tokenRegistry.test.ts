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
    tokenDefinitionId,
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

    // CR 707.2 (issue #1191) — the client bundle's registry never saw the
    // server-side `registerTokenDefinition` call for a Clue created in a
    // DIFFERENT process (the exact scenario this whole file guards against:
    // see the module header). `maybeSynthesizeToken` must decode the
    // activated-ability segment (11th, index 10) back into a real
    // `ActivatedAbility[]` so `getStackAbilities` — the client reducer that
    // reads `getDefinition(card.card.id).activatedAbilities` — can surface
    // "{2}, Sacrifice this token: Draw a card." This is the round-trip that
    // previously blocked Investigate, Magda's Treasures (#778), Voldaren
    // Epicure's Blood token and Sunfall's Incubate (#1210): a token could
    // carry NO activated ability at all, encoded or otherwise.
    it("11th segment is decoded as activatedAbilities (issue #1191)", () => {
        const abilities = [
            {
                id: "sacrifice-draw",
                oracleText: "{2}, Sacrifice this token: Draw a card.",
                cost: { mana: { generic: 2 }, sacrifice: true },
                useStack: true,
                effects: [{ op: "draw", player: "controller", count: 1 }],
            },
        ];
        const id = [
            "token:Clue",
            "Artifact",
            "Clue",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            encodeURIComponent(JSON.stringify(abilities)),
        ].join("|");
        const def = getDefinition(id);
        expect(def.name).toBe("Clue");
        expect(def.types).toEqual(["Artifact"]);
        expect(def.subtypes).toEqual(["Clue"]);
        expect(def.activatedAbilities).toEqual(abilities);
    });

    it("missing/empty 11th segment leaves activatedAbilities undefined (back-compat with pre-#1191 10-segment ids)", () => {
        const id =
            "token:Wasp|Artifact,Creature|Insect||1|1||flying|09921372-126f-4c81-b6d8-ea50b1d0eb44|";
        const def = getDefinition(id);
        expect(def.activatedAbilities).toBeUndefined();
    });

    // CR 712 (issue #1210) — `gre/transform.ts` registers a synthesized
    // back-face definition through THIS SAME `tokenDefinitionId` codec (not a
    // bespoke id format), so a transformed permanent's new `card.card.id`
    // decodes on a client that never saw the server-side registration call —
    // the exact scenario this file guards against (see the module header).
    // Without this, a transformed permanent would render with no name/art
    // client-side the moment it flips.
    it("12th segment is decoded as backFace (issue #1210, CR 712)", () => {
        const backFace = {
            name: "Construct",
            types: ["Artifact", "Creature"],
            subtypes: ["Construct"],
            power: 0,
            toughness: 0,
            staticAbilities: [],
        };
        const id = [
            "token:Incubator",
            "Artifact",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            encodeURIComponent(JSON.stringify(backFace)),
        ].join("|");
        const def = getDefinition(id);
        expect(def.name).toBe("Incubator");
        expect(def.types).toEqual(["Artifact"]);
        expect(def.backFace).toEqual(backFace);
    });

    it("missing/empty 12th segment leaves backFace undefined (back-compat with pre-#1210 11-segment ids)", () => {
        const id =
            "token:Wasp|Artifact,Creature|Insect||1|1||flying|09921372-126f-4c81-b6d8-ea50b1d0eb44||";
        const def = getDefinition(id);
        expect(def.backFace).toBeUndefined();
    });

    // Issue #1595 — a transformed permanent's `card.card.id` is swapped
    // server-side (`transformPermanent`, `gre/transform.ts`) to a synthesized
    // back-face id, and `transformPermanent` runs SERVER-SIDE ONLY. The
    // client bundle therefore never sees the `registerTokenDefinition` call
    // for that id — the exact cold-decode scenario this whole file guards
    // against (see the module header) — and must recover "this is the back
    // face" purely from the wire id string via THIS decode path. Without a
    // 13th segment, `resolveCardImageFace` (`src/lib/images.ts`) would always
    // fall back to "front" on a real client even though the server-side
    // synthesized `CardDefinition` correctly carries `imagePrintFace: "back"`
    // — the exact gap an earlier version of this fix shipped (caught only by
    // a frontend test that pre-registered the def, bypassing this decode
    // path entirely).
    it("13th segment is decoded as imagePrintFace (issue #1595)", () => {
        const id = [
            "token:Construct",
            "Artifact,Creature",
            "Construct",
            "",
            "0",
            "0",
            "",
            "",
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "",
            "",
            "",
            "back",
        ].join("|");
        const def = getDefinition(id);
        expect(def.name).toBe("Construct");
        expect(def.imagePrintId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        expect(def.imagePrintFace).toBe("back");
    });

    it("missing/empty 13th segment leaves imagePrintFace undefined (back-compat with pre-#1595 12-segment ids, decodes as front)", () => {
        const id =
            "token:Wasp|Artifact,Creature|Insect||1|1||flying|09921372-126f-4c81-b6d8-ea50b1d0eb44|||";
        const def = getDefinition(id);
        expect(def.imagePrintFace).toBeUndefined();
    });

    // The exact round trip `gre/transform.ts`'s `backFaceAsTokenSpec` +
    // `tokenDefinitionId` produce, decoded cold (never registered) — the
    // definitive end-to-end proof that a real client recovers the back face
    // from the wire id alone.
    it("tokenDefinitionId(spec with imagePrintFace: 'back') round-trips through getDefinition", () => {
        const id = tokenDefinitionId({
            name: "Test Construct",
            types: ["Artifact", "Creature"],
            subtypes: ["Construct"],
            power: 0,
            toughness: 0,
            imagePrintId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            imagePrintFace: "back",
        });
        const def = getDefinition(id);
        expect(def.imagePrintId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        expect(def.imagePrintFace).toBe("back");
    });
});
