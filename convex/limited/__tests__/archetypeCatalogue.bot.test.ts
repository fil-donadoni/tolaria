// Archetype Catalogue tests (ADR 0072, ADR 0167, issue #8892): the row
// shape the seed and the Admin create/edit mutations share, the seed guard
// (checked-in Card Archetype files against the catalogue SEED, offline), the
// write boundary (a DB Card Archetype write against seed ∪ DB), and a scope's
// emergent view — `activeRows` / `colourSignature`.
import { describe, it, expect } from "vitest";
import {
    ARCHETYPE_CATALOGUE_SEED,
    ARCHETYPE_CATALOGUE_SEED_IDS,
    activeRows,
    archetypeCatalogueWriteErrors,
    archetypeRowErrors,
    catalogueIds,
    colourSignature,
    mergeArchetypeCatalogue,
    type ArchetypeCatalogueRow,
    type ArchetypeScopeCard,
} from "../archetypeCatalogueCore";
import {
    getAllCheckedInCardArchetypeFiles,
    normalizeArchetypes,
    cardProfileWriteErrors,
    validateCardArchetypeFile,
    type CardArchetypeFile,
} from "../cardProfilesCore";

/** A well-formed row no seed row uses — the base each refusal test breaks
 *  in exactly one field. */
const KICKER: ArchetypeCatalogueRow = {
    id: "kicker",
    description:
        "TAG WHEN: the card has kicker or pays it off. NOT: a card that merely costs a lot (`ramp`).",
    gloss: {
        when: "Kicker cards and their payoffs.",
        not: "Expensive cards without kicker (ramp).",
    },
    example: "Lightning Bolt",
};

describe("Archetype Catalogue seed (issue #8892)", () => {
    it("every seed row is well-formed — the same check create/edit run", () => {
        for (const row of ARCHETYPE_CATALOGUE_SEED) {
            expect(archetypeRowErrors(row), row.id).toEqual([]);
        }
    });

    it("every seed row has a unique id", () => {
        const ids = ARCHETYPE_CATALOGUE_SEED.map((row) => row.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("every seed id survives normalization unchanged — the stored form IS the catalogue form", () => {
        // `cardProfileWriteErrors` checks the NORMALIZED archetype, so an id
        // that does not round-trip could never be written through the editor.
        for (const row of ARCHETYPE_CATALOGUE_SEED) {
            expect(normalizeArchetypes([row.id])).toEqual([row.id]);
        }
    });

    it("stays small and coarse — growth past ~25 rows is the signal to check Capability/Combo Edge instead", () => {
        expect(ARCHETYPE_CATALOGUE_SEED.length).toBeGreaterThan(0);
        expect(ARCHETYPE_CATALOGUE_SEED.length).toBeLessThanOrEqual(25);
    });
});

describe("archetypeRowErrors — create/edit refuse a malformed row", () => {
    it("accepts a well-formed row", () => {
        expect(archetypeRowErrors(KICKER)).toEqual([]);
    });

    it("refuses a row without a TAG WHEN clause", () => {
        const errors = archetypeRowErrors({
            ...KICKER,
            description: "Kicker cards. NOT: expensive cards (`ramp`).",
        });
        expect(errors.some((e) => e.includes("TAG WHEN:"))).toBe(true);
    });

    it("refuses a row without a NOT clause", () => {
        const errors = archetypeRowErrors({
            ...KICKER,
            description: "TAG WHEN: the card has kicker or pays it off.",
        });
        expect(errors.some((e) => e.includes("NOT:"))).toBe(true);
    });

    it("refuses a NOT clause that only precedes TAG WHEN — the NOT side must follow", () => {
        const errors = archetypeRowErrors({
            ...KICKER,
            description: "NOT: expensive cards. TAG WHEN: kicker cards.",
        });
        expect(errors.some((e) => e.includes("NOT:"))).toBe(true);
    });

    it("refuses an empty clause", () => {
        expect(
            archetypeRowErrors({
                ...KICKER,
                description: "TAG WHEN:   NOT: expensive cards.",
            }).some((e) => e.includes("TAG WHEN:"))
        ).toBe(true);
        expect(
            archetypeRowErrors({
                ...KICKER,
                description: "TAG WHEN: kicker cards. NOT:  ",
            }).some((e) => e.includes("NOT:"))
        ).toBe(true);
    });

    it("refuses a non-kebab-case or non-lowercase id", () => {
        for (const id of [
            "Kicker",
            "kicker_payoff",
            "kicker payoff",
            "kicker--payoff",
            "-kicker",
            "kicker-",
            "1kicker",
            "",
        ]) {
            expect(
                archetypeRowErrors({ ...KICKER, id }).some((e) =>
                    e.includes("kebab-case")
                ),
                JSON.stringify(id)
            ).toBe(true);
        }
        expect(archetypeRowErrors({ ...KICKER, id: "kicker-payoff" })).toEqual(
            []
        );
    });

    it("refuses an empty or multi-line gloss half", () => {
        expect(
            archetypeRowErrors({
                ...KICKER,
                gloss: { ...KICKER.gloss, when: " " },
            }).some((e) => e.includes("gloss.when"))
        ).toBe(true);
        expect(
            archetypeRowErrors({
                ...KICKER,
                gloss: { ...KICKER.gloss, not: "one\ntwo" },
            }).some((e) => e.includes("gloss.not"))
        ).toBe(true);
    });

    it("refuses an example that is not a card", () => {
        expect(
            archetypeRowErrors({
                ...KICKER,
                example: "Not A Real Card Name",
            }).some((e) => e.includes("example"))
        ).toBe(true);
    });
});

describe("archetypeCatalogueWriteErrors — create vs edit against seed ∪ DB", () => {
    const catalogue = mergeArchetypeCatalogue(ARCHETYPE_CATALOGUE_SEED, [
        KICKER,
    ]);

    it("create refuses an id already in the seed or the DB", () => {
        expect(
            archetypeCatalogueWriteErrors("create", KICKER, catalogue).some(
                (e) => e.includes("already exists")
            )
        ).toBe(true);
        const aggro = ARCHETYPE_CATALOGUE_SEED.find((r) => r.id === "aggro")!;
        expect(
            archetypeCatalogueWriteErrors("create", aggro, catalogue).some(
                (e) => e.includes("already exists")
            )
        ).toBe(true);
    });

    it("create accepts a new well-formed row", () => {
        expect(
            archetypeCatalogueWriteErrors(
                "create",
                KICKER,
                ARCHETYPE_CATALOGUE_SEED
            )
        ).toEqual([]);
    });

    it("edit refuses an id no row has, accepts an existing one", () => {
        expect(
            archetypeCatalogueWriteErrors(
                "edit",
                KICKER,
                ARCHETYPE_CATALOGUE_SEED
            ).some((e) => e.includes("does not exist"))
        ).toBe(true);
        expect(
            archetypeCatalogueWriteErrors("edit", KICKER, catalogue)
        ).toEqual([]);
    });

    it("create and edit both refuse a malformed row", () => {
        const bad = { ...KICKER, description: "TAG WHEN: kicker cards." };
        expect(
            archetypeCatalogueWriteErrors(
                "create",
                bad,
                ARCHETYPE_CATALOGUE_SEED
            )
        ).not.toEqual([]);
        expect(
            archetypeCatalogueWriteErrors("edit", bad, catalogue)
        ).not.toEqual([]);
    });
});

describe("mergeArchetypeCatalogue — the DB layer over the seed", () => {
    it("a DB row with a seed id replaces it; any other is added; sorted by id", () => {
        const edited = {
            ...ARCHETYPE_CATALOGUE_SEED.find((r) => r.id === "storm")!,
            example: "Dark Ritual",
        };
        const merged = mergeArchetypeCatalogue(ARCHETYPE_CATALOGUE_SEED, [
            edited,
            KICKER,
        ]);
        expect(merged.length).toBe(ARCHETYPE_CATALOGUE_SEED.length + 1);
        expect(merged.find((r) => r.id === "storm")!.example).toBe(
            "Dark Ritual"
        );
        const ids = merged.map((r) => r.id);
        expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
        expect(ids).toContain("kicker");
    });
});

// Real `CardDefinition.id`s so a "clean" fixture validates with ZERO errors.
const BLACK_LOTUS_ID = "b0faa7f2-b547-42c4-a810-839da50dadfe";
const ANIMATE_DEAD_ID = "8fd7861d-925f-4b4c-a4ab-60be6f43d50b";

describe("Seed guard — a Card Archetype seed file is checked against the catalogue SEED", () => {
    it("rejects an archetype absent from the catalogue seed", () => {
        const badFile: CardArchetypeFile = {
            scope: "vintage-cube",
            archetypes: {
                [ANIMATE_DEAD_ID]: {
                    archetypes: ["graveyard-reanimator"],
                    reviewed: false,
                },
            },
        };
        const result = validateCardArchetypeFile(badFile);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) => e.includes("graveyard-reanimator"))
        ).toBe(true);
    });

    it("rejects a seed string only a CASING away from a row — seed files are checked as written", () => {
        const result = validateCardArchetypeFile({
            scope: "vintage-cube",
            archetypes: {
                [BLACK_LOTUS_ID]: { archetypes: ["Storm"], reviewed: false },
            },
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("Storm"))).toBe(true);
    });

    it("accepts a fixture whose archetypes are all seed rows", () => {
        const result = validateCardArchetypeFile({
            scope: "vintage-cube",
            archetypes: {
                [ANIMATE_DEAD_ID]: {
                    archetypes: ["reanimator", "graveyard"],
                    reviewed: false,
                },
            },
        });
        expect(result).toEqual({ valid: true, errors: [] });
    });

    it("every checked-in Card Archetype file names only catalogue seed rows", () => {
        for (const file of getAllCheckedInCardArchetypeFiles()) {
            expect(
                validateCardArchetypeFile(file).errors.filter((e) =>
                    e.includes("not a catalogue seed row")
                ),
                file.scope
            ).toEqual([]);
        }
    });

    it("the sweep above is NON-VACUOUS — the checked-in census really does declare Archetypes", () => {
        const declared = getAllCheckedInCardArchetypeFiles().flatMap((file) =>
            Object.values(file.archetypes).flatMap((p) => p.archetypes)
        );
        expect(new Set(declared).size).toBeGreaterThan(1);
        for (const archetype of declared) {
            expect(ARCHETYPE_CATALOGUE_SEED_IDS.has(archetype)).toBe(true);
        }
    });
});

describe("Write boundary — a DB Card Archetype write is checked against seed ∪ DB", () => {
    const profile = (archetypes: string[]) => ({
        archetypes,
        provides: [],
        requires: ["reanimatable"],
        reviewed: true,
    });
    const seedOnly = catalogueIds(ARCHETYPE_CATALOGUE_SEED);
    const withDbRow = catalogueIds(
        mergeArchetypeCatalogue(ARCHETYPE_CATALOGUE_SEED, [KICKER])
    );

    it("refuses an archetype outside seed ∪ DB", () => {
        const errors = cardProfileWriteErrors(
            ANIMATE_DEAD_ID,
            profile(["jeskai-tempo"]),
            withDbRow
        );
        expect(errors.some((e) => e.includes("jeskai-tempo"))).toBe(true);
    });

    it("accepts a DB-only row once the DB holds it — refuses it against the seed alone", () => {
        expect(
            cardProfileWriteErrors(
                ANIMATE_DEAD_ID,
                profile(["kicker"]),
                withDbRow
            )
        ).toEqual([]);
        expect(
            cardProfileWriteErrors(
                ANIMATE_DEAD_ID,
                profile(["kicker"]),
                seedOnly
            ).some((e) => e.includes("kicker"))
        ).toBe(true);
    });

    it("checks the NORMALIZED form — ` Reanimator ` lands as `reanimator`", () => {
        expect(
            cardProfileWriteErrors(
                ANIMATE_DEAD_ID,
                profile([" Reanimator "]),
                seedOnly
            )
        ).toEqual([]);
    });
});

describe("A scope's view — activeRows and colourSignature (fixture scope)", () => {
    const SCOPE: ArchetypeScopeCard[] = [
        { archetypes: ["aggro"], colours: ["R"] },
        { archetypes: ["aggro"], colours: ["R", "G"] },
        { archetypes: ["aggro", "artifacts"], colours: [] },
        { archetypes: ["control"], colours: ["U"] },
        { archetypes: [], colours: ["W"] },
    ];

    it("activeRows holds exactly the rows the scope's cards carry, in catalogue order", () => {
        const catalogue = mergeArchetypeCatalogue(ARCHETYPE_CATALOGUE_SEED, [
            KICKER,
        ]);
        expect(activeRows(SCOPE, catalogue).map((r) => r.id)).toEqual([
            "aggro",
            "artifacts",
            "control",
        ]);
    });

    it("a row no card of the scope tags is absent from it", () => {
        const ids = activeRows(
            SCOPE,
            mergeArchetypeCatalogue(ARCHETYPE_CATALOGUE_SEED, [KICKER])
        ).map((r) => r.id);
        expect(ids).not.toContain("kicker");
        expect(ids).not.toContain("storm");
    });

    it("a multicolour card counts partly toward each of its colours; a colourless card toward none", () => {
        // aggro: Mono-R (1 to R) + RG (½ R, ½ G) + colourless (nothing) →
        // R 1.5 / G 0.5 over 2 coloured cards.
        expect(colourSignature(SCOPE, "aggro")).toEqual({
            W: 0,
            U: 0,
            B: 0,
            R: 0.75,
            G: 0.25,
        });
    });

    it("a row whose tagged cards are all colourless, or a row unused in the scope, reads all zero", () => {
        const zero = { W: 0, U: 0, B: 0, R: 0, G: 0 };
        expect(colourSignature(SCOPE, "artifacts")).toEqual(zero);
        expect(colourSignature(SCOPE, "storm")).toEqual(zero);
    });

    it("the same row reads differently in another scope — computed, never authored", () => {
        const other: ArchetypeScopeCard[] = [
            { archetypes: ["aggro"], colours: ["W"] },
            { archetypes: ["aggro"], colours: ["W", "R"] },
        ];
        expect(colourSignature(other, "aggro")).toEqual({
            W: 0.75,
            U: 0,
            B: 0,
            R: 0.25,
            G: 0,
        });
    });
});
