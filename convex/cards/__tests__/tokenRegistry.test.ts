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
import type { CardDefinition, CardType } from "../types";

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

    // CR 707.2 (issue #2364) — a token's OWN triggered ability (Pest
    // Infestation's "when this token dies, you gain 1 life."). Unlike
    // `activatedAbilities`, `TriggeredAbility.matches` is a REQUIRED closure
    // and can never survive a JSON round trip regardless of how much else is
    // encoded — so the 15th segment carries `id`/`oracleText`/`event` only,
    // and a cold decode rebuilds a SAFE, NEVER-FIRING stub rather than a
    // functioning ability (see `tokenDefinitionId`'s own doc comment). This
    // still proves the ability's IDENTITY (id/oracleText/event) survives a
    // registry miss for display, and that `matches` never crashes a trigger
    // scan that happens to reach the stub.
    it("15th segment is decoded as triggeredAbilities — id/oracleText/event survive, matches is a safe non-firing stub (issue #2364)", () => {
        const descriptors = [
            {
                id: "pest-dies",
                oracleText: "When this token dies, you gain 1 life.",
                event: "CREATURE_DIED",
            },
        ];
        const id = [
            "token:Pest",
            "Creature",
            "Pest",
            "",
            "1",
            "1",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "", // 14th segment (index 13): loyalty, not applicable here
            encodeURIComponent(JSON.stringify(descriptors)),
        ].join("|");
        const def = getDefinition(id);
        expect(def.name).toBe("Pest");
        expect(def.triggeredAbilities).toHaveLength(1);
        const ability = def.triggeredAbilities![0];
        expect(ability.id).toBe("pest-dies");
        expect(ability.oracleText).toBe(
            "When this token dies, you gain 1 life."
        );
        expect(ability.event).toBe("CREATURE_DIED");
        // Safe stub: never fires, never throws.
        expect(
            ability.matches(
                {
                    type: "CREATURE_DIED",
                    creatureInstanceId: "x",
                    creatureControllerId: "p1",
                    creatureOwnerId: "p1",
                    creatureTypes: ["Creature"],
                    damagedBySources: [],
                    creaturePower: 1,
                    creatureToughness: 1,
                } as unknown as Parameters<typeof ability.matches>[0],
                {
                    id: "x",
                    controllerId: "p1",
                    ownerId: "p1",
                    types: [],
                    subtypes: [],
                    isTapped: false,
                } as unknown as Parameters<typeof ability.matches>[1]
            )
        ).toBe(false);
    });

    it("missing/empty 15th segment leaves triggeredAbilities undefined (back-compat with pre-#2364 13-segment ids, which also predate #2380's loyalty segment)", () => {
        const id =
            "token:Wasp|Artifact,Creature|Insect||1|1||flying|09921372-126f-4c81-b6d8-ea50b1d0eb44||||";
        const def = getDefinition(id);
        expect(def.loyalty).toBeUndefined();
        expect(def.triggeredAbilities).toBeUndefined();
    });

    // The exact round trip `createTokenPermanents` produces for a token whose
    // spec carries `triggeredAbilities` (`TokenSpec.triggeredAbilities`,
    // issue #2364) — server-side registration (via `registerTokenDefinition`)
    // ALWAYS carries the real, functioning closures; this proves the id
    // string it computes still folds the ability's identity in (a token WITH
    // a trigger gets a distinct definition from one without).
    it("tokenDefinitionId content-hashes on triggeredAbilities id (distinct def for a token with vs. without a trigger)", () => {
        const withTrigger = tokenDefinitionId({
            name: "Pest",
            types: ["Creature"],
            subtypes: ["Pest"],
            power: 1,
            toughness: 1,
            triggeredAbilities: [
                {
                    id: "pest-dies",
                    oracleText: "When this token dies, you gain 1 life.",
                    event: "CREATURE_DIED",
                    matches: () => true,
                },
            ],
        });
        const withoutTrigger = tokenDefinitionId({
            name: "Pest",
            types: ["Creature"],
            subtypes: ["Pest"],
            power: 1,
            toughness: 1,
        });
        expect(withTrigger).not.toBe(withoutTrigger);
    });

    // Merge-order regression guard (rebase of #2426 onto #2380) — `loyalty`
    // claimed index 13 (the 14th segment) first; `triggeredAbilities` had to
    // be renumbered to index 14 (the 15th segment) behind it. The two MUST
    // land in the SAME relative order in both the `parts` array
    // (`tokenDefinitionId`) and the destructure (`maybeSynthesizeToken`) — an
    // order mismatch is either loud (a bare loyalty number fed to
    // `JSON.parse(...).map` throws out of `getDefinition`, a client render
    // crash on any flip-walker back-face id) or silent (swallowed as `NaN`).
    // Neither #2380 nor #2364 alone ever exercised a spec carrying BOTH
    // fields — this is that missing round trip, and it fails on either
    // ordering mistake, not just an outright field-count drift.
    it("a spec carrying BOTH loyalty and triggeredAbilities round-trips through tokenDefinitionId → getDefinition with neither reading the other's slot", () => {
        const id = tokenDefinitionId({
            name: "Flip Pest Walker",
            types: ["Planeswalker"],
            loyalty: 5,
            triggeredAbilities: [
                {
                    id: "pest-walker-dies",
                    oracleText: "When this token dies, you gain 1 life.",
                    event: "CREATURE_DIED",
                    matches: () => true,
                },
            ],
        });
        const def = getDefinition(id);
        expect(def.loyalty).toBe(5);
        expect(def.triggeredAbilities).toHaveLength(1);
        const ability = def.triggeredAbilities![0];
        expect(ability.id).toBe("pest-walker-dies");
        expect(ability.oracleText).toBe(
            "When this token dies, you gain 1 life."
        );
        expect(ability.event).toBe("CREATURE_DIED");
    });

    // Review of #2426 (proven finding) — the 15th segment used to encode
    // `id`/`oracleText`/`event` ONLY, so two specs whose triggers differ
    // ONLY in the ability BODY (`effects`) collided on the SAME content
    // hash: the second `createToken` call would silently share the FIRST
    // token's definition — a Pest authored to gain 99 life would resolve as
    // "gain 1 life" if a differently-worded-but-same-id Pest had registered
    // first. `effects` is now folded into the hash (mirrors
    // `activatedAbilities`, which already encodes full JSON for the exact
    // same reason) so the two specs get DISTINCT definitions.
    it("15th segment content-hashes on the triggered ability's EFFECTS BODY too — two specs differing only in the ability body get distinct ids (review of #2426)", () => {
        const baseSpec = {
            name: "Pest",
            types: ["Creature"] as CardType[],
            subtypes: ["Pest"],
            power: 1,
            toughness: 1,
        };
        const idGainOne = tokenDefinitionId({
            ...baseSpec,
            triggeredAbilities: [
                {
                    id: "pest-dies",
                    oracleText: "When this token dies, you gain 1 life.",
                    event: "CREATURE_DIED",
                    matches: () => true,
                    effects: [
                        { op: "gainLife", player: "controller", amount: 1 },
                    ],
                },
            ],
        });
        const idGainNinetyNine = tokenDefinitionId({
            ...baseSpec,
            triggeredAbilities: [
                {
                    id: "pest-dies",
                    oracleText: "When this token dies, you gain 1 life.",
                    event: "CREATURE_DIED",
                    matches: () => true,
                    effects: [
                        { op: "gainLife", player: "controller", amount: 99 },
                    ],
                },
            ],
        });
        expect(idGainOne).not.toBe(idGainNinetyNine);
    });

    // Review of #2426 — once `effects` survives the encode, a cold decode can
    // rebuild a REAL, working trigger (via `resolveTokenTriggeredAbilities`)
    // instead of the permanently non-firing `matches: () => false` stub the
    // 15th segment used to produce unconditionally. `matches` returns TRUE
    // here (not the stub's hard-coded `false`), and the rebuilt ability's own
    // `effects` field survives too, matching what was encoded.
    it("15th segment WITH an effects body decodes into a REAL trigger, not the non-firing stub (review of #2426)", () => {
        const abilityId = "cold-decode-pest-dies";
        const effects = [
            {
                op: "gainLife" as const,
                player: "controller" as const,
                amount: 7,
            },
        ];
        const id = tokenDefinitionId({
            name: "Pest",
            types: ["Creature"],
            subtypes: ["Pest"],
            power: 1,
            toughness: 1,
            triggeredAbilities: [
                {
                    id: abilityId,
                    oracleText: "When this token dies, you gain 7 life.",
                    event: "CREATURE_DIED",
                    matches: () => true,
                    effects,
                },
            ],
        });
        const def = getDefinition(id);
        const ability = def.triggeredAbilities![0];
        expect(ability.id).toBe(abilityId);
        expect(ability.effects).toEqual(effects);
        expect(
            ability.matches(
                {
                    type: "CREATURE_DIED",
                    creatureInstanceId: "x",
                    creatureControllerId: "p1",
                    creatureOwnerId: "p1",
                    creatureTypes: ["Creature"],
                    damagedBySources: [],
                    creaturePower: 1,
                    creatureToughness: 1,
                } as unknown as Parameters<typeof ability.matches>[0],
                {
                    id: "x",
                    controllerId: "p1",
                    ownerId: "p1",
                    types: [],
                    subtypes: [],
                    isTapped: false,
                } as unknown as Parameters<typeof ability.matches>[1]
            )
        ).toBe(true);
    });
});
