// Card Profile resolver seam tests (ADR 0072, issue #1608; two layers since
// ADR 0167, issue #8890). Pure functions, deterministic, no convex-test
// harness — `resolveEventCardProfile` is handed plain in-memory
// `ProfileLayers` standing in for `ctx.db` and for the checked-in seed, so
// the layering itself is proven against FIXTURES, never coupled to census
// content.
import { describe, it, expect } from "vitest";
import {
    buildDbProfileLayers,
    composeCardProfile,
    EMPTY_PROFILE_LAYERS,
    getCardArchetypeFile,
    getSeedCardArchetypes,
    isCardProfileReviewed,
    resolveEventCardProfile,
    validateCardArchetypeFile,
    validateCardCapabilityFile,
    type CardArchetypes,
    type CardCapabilities,
    type ProfileLayers,
} from "../cardProfilesCore";

function caps(overrides: Partial<CardCapabilities> = {}): CardCapabilities {
    return { provides: [], requires: [], reviewed: false, ...overrides };
}

function arch(overrides: Partial<CardArchetypes> = {}): CardArchetypes {
    return { archetypes: [], reviewed: false, ...overrides };
}

/** A `ProfileLayers` over plain maps — `capabilities` by cardId,
 *  `archetypes` by scope then cardId. */
function layers(
    capabilities: Record<string, CardCapabilities> = {},
    archetypes: Record<string, Record<string, CardArchetypes>> = {}
): ProfileLayers {
    return {
        getCapabilities: (cardId) => capabilities[cardId] ?? null,
        getArchetypes: (scope, cardId) => archetypes[scope]?.[cardId] ?? null,
    };
}

const NO_SEED = EMPTY_PROFILE_LAYERS;

describe("resolveEventCardProfile (ADR 0167): two layers recomposed into one lookup", () => {
    it("recomposes both layers, each carrying its own review flag", () => {
        const resolve = resolveEventCardProfile(
            ["vintage-cube"],
            layers(
                {
                    wurm: caps({
                        provides: ["value-on-death"],
                        reviewed: true,
                    }),
                },
                { "vintage-cube": { wurm: arch({ archetypes: ["ramp"] }) } }
            ),
            NO_SEED
        );
        expect(resolve("wurm")).toEqual({
            archetypes: ["ramp"],
            provides: ["value-on-death"],
            requires: [],
            archetypesReviewed: false,
            capabilitiesReviewed: true,
        });
    });

    it("absent from both layers in both sources -> null", () => {
        const resolve = resolveEventCardProfile(["lea"], NO_SEED, NO_SEED);
        expect(resolve("anything")).toBeNull();
    });

    it("a card with only one layer resolves with the other layer empty", () => {
        const resolve = resolveEventCardProfile(
            ["lea"],
            layers({ x: caps({ requires: ["reanimatable"] }) }),
            NO_SEED
        );
        expect(resolve("x")).toMatchObject({
            archetypes: [],
            requires: ["reanimatable"],
        });
    });

    it("Capabilities: a DB row beats the seed row; absent from the DB -> the seed", () => {
        const resolve = resolveEventCardProfile(
            ["lea"],
            layers({ a: caps({ provides: ["self-mills"] }) }),
            layers({
                a: caps({ provides: ["discard-outlet"] }),
                b: caps({ provides: ["cheap-artifact"] }),
            })
        );
        expect(resolve("a")?.provides).toEqual(["self-mills"]);
        expect(resolve("b")?.provides).toEqual(["cheap-artifact"]);
    });

    it("Capabilities are scope-free: a row reaches an event of ANY scope (ADR 0167 §1)", () => {
        const seed = layers({ wurm: caps({ provides: ["value-on-death"] }) });
        for (const scope of ["vintage-cube", "lea", "ice"]) {
            expect(
                resolveEventCardProfile([scope], NO_SEED, seed)("wurm")
                    ?.provides
            ).toEqual(["value-on-death"]);
        }
    });

    it("Archetypes: a DB row in ANY event scope beats every seed row", () => {
        const resolve = resolveEventCardProfile(
            ["lea", "vintage-cube"],
            layers(
                {},
                { "vintage-cube": { c: arch({ archetypes: ["aggro"] }) } }
            ),
            layers({}, { lea: { c: arch({ archetypes: ["control"] }) } })
        );
        expect(resolve("c")?.archetypes).toEqual(["aggro"]);
    });

    it("Archetypes: absent from the DB -> the seed of an event scope", () => {
        const resolve = resolveEventCardProfile(
            ["vintage-cube"],
            NO_SEED,
            layers(
                {},
                { "vintage-cube": { c: arch({ archetypes: ["reanimator"] }) } }
            )
        );
        expect(resolve("c")?.archetypes).toEqual(["reanimator"]);
    });

    it("Archetype scope isolation: a row in one scope never leaks into another, either source, either direction", () => {
        const db = layers(
            {},
            { "vintage-cube": { shared: arch({ archetypes: ["reanimator"] }) } }
        );
        const seed = layers(
            {},
            { lea: { shared: arch({ archetypes: ["aggro"] }) } }
        );
        expect(
            resolveEventCardProfile(["lea"], db, NO_SEED)("shared")
        ).toBeNull();
        expect(
            resolveEventCardProfile(["vintage-cube"], NO_SEED, seed)("shared")
        ).toBeNull();
        expect(resolveEventCardProfile(["ice"], db, seed)("shared")).toBeNull();
    });

    it("dedupes a repeated scope and matches scopes case-insensitively", () => {
        const resolve = resolveEventCardProfile(
            ["LEA", "lea", "Lea"],
            layers({}, { lea: { x: arch({ archetypes: ["aggro"] }) } }),
            NO_SEED
        );
        expect(resolve("x")?.archetypes).toEqual(["aggro"]);
    });

    it("Combo Edges ride the Capability layer", () => {
        const resolve = resolveEventCardProfile(
            ["lea"],
            layers({
                painter: caps({
                    comboEdges: [{ cardId: "grindstone", weight: 5 }],
                }),
            }),
            NO_SEED
        );
        expect(resolve("painter")?.comboEdges).toEqual([
            { cardId: "grindstone", weight: 5 },
        ]);
    });

    it("defaults to the real checked-in seed: the cube census answers through the two-arg call", () => {
        const [cardId] = Object.keys(
            getCardArchetypeFile("vintage-cube")!.archetypes
        );
        const resolved = resolveEventCardProfile(
            ["vintage-cube"],
            EMPTY_PROFILE_LAYERS
        )(cardId);
        expect(resolved?.archetypes).toEqual(
            getSeedCardArchetypes("vintage-cube", cardId)!.archetypes
        );
    });
});

describe("composeCardProfile / isCardProfileReviewed", () => {
    it("neither layer -> null", () => {
        expect(composeCardProfile(null, null)).toBeNull();
    });

    it("an empty layer never makes a profile 'unreviewed'; a layer with data does", () => {
        const archetypesOnly = composeCardProfile(
            null,
            arch({ archetypes: ["aggro"], reviewed: true })
        )!;
        expect(isCardProfileReviewed(archetypesOnly)).toBe(true);
        const unreviewedCapabilities = composeCardProfile(
            caps({ provides: ["self-mills"], reviewed: false }),
            arch({ archetypes: ["aggro"], reviewed: true })
        )!;
        expect(isCardProfileReviewed(unreviewedCapabilities)).toBe(false);
    });
});

describe("buildDbProfileLayers: rows -> ProfileLayers fold", () => {
    const db = buildDbProfileLayers({
        capabilities: [{ cardId: "a", ...caps({ provides: ["self-mills"] }) }],
        archetypes: [
            { scope: "lea", cardId: "a", ...arch({ archetypes: ["aggro"] }) },
            {
                scope: "vintage-cube",
                cardId: "b",
                ...arch({ archetypes: ["control"] }),
            },
        ],
    });

    it("strips the row keys and returns each layer by its own key", () => {
        expect(db.getCapabilities("a")).toEqual(
            caps({ provides: ["self-mills"] })
        );
        expect(db.getArchetypes("lea", "a")).toEqual(
            arch({ archetypes: ["aggro"] })
        );
        expect(db.getCapabilities("b")).toBeNull();
    });

    it("Archetypes are scope-isolated and case-insensitive on scope", () => {
        expect(db.getArchetypes("lea", "b")).toBeNull();
        expect(db.getArchetypes("VINTAGE-CUBE", "b")?.archetypes).toEqual([
            "control",
        ]);
    });
});

describe("seed validators (issue #8890): each layer's file checked against its own registry", () => {
    it("empty files validate clean", () => {
        expect(validateCardCapabilityFile({ capabilities: {} })).toEqual({
            valid: true,
            errors: [],
        });
        expect(
            validateCardArchetypeFile({ scope: "lea", archetypes: {} })
        ).toEqual({ valid: true, errors: [] });
    });
});
