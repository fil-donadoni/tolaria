// Archetype Registry guard tests (ADR 0072, PRD #1607, issue #3597). Mirrors
// `capabilityRegistry.bot.test.ts`'s authority-plus-CI-guard shape: this
// suite is the single CI authority on Archetype names — any `archetypes`
// string in a checked-in `cardProfiles` seed file that isn't a registry row
// fails here, and the registry itself is guarded against duplicate ids, a
// non-normalized id and an oversized vocabulary (ADR 0072: an Archetype is a
// COARSE plan; a name that is really a two-card loop is a Combo Edge and one
// that is really relational is a Capability).
import { describe, it, expect } from "vitest";
import {
    ARCHETYPE_REGISTRY,
    isRegisteredArchetype,
} from "../archetypeRegistry";
import {
    getAllCheckedInCardArchetypeFiles,
    normalizeArchetypes,
    cardProfileWriteErrors,
    validateCardArchetypeFile,
    type CardArchetypeFile,
} from "../cardProfilesCore";

describe("Archetype Registry (ADR 0072, issue #3597)", () => {
    it("stays small and coarse — growth past ~25 rows is the signal to check Capability/Combo Edge instead", () => {
        expect(ARCHETYPE_REGISTRY.length).toBeGreaterThan(0);
        expect(ARCHETYPE_REGISTRY.length).toBeLessThanOrEqual(25);
    });

    it("every row states BOTH sides of its own boundary — a TAG WHEN: and a NOT: clause", () => {
        // The structural check for the bug class a 285-row review pass
        // invites: two neighbouring archetypes (`graveyard` vs `reanimator`,
        // `combo` vs `storm`) drifting into each other card by card because
        // only one of them was ever defined. A row that says when to tag it
        // and never says what it is NOT is half a definition.
        for (const row of ARCHETYPE_REGISTRY) {
            expect(row.description, `row "${row.id}"`).toContain("TAG WHEN:");
            expect(row.description, `row "${row.id}"`).toContain("NOT:");
        }
    });

    it("every row has a unique id", () => {
        const ids = ARCHETYPE_REGISTRY.map((row) => row.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("every row's id is a non-empty lowercase kebab-case string", () => {
        for (const row of ARCHETYPE_REGISTRY) {
            expect(row.id).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
        }
    });

    it("every row's id survives normalization unchanged — the stored form IS the registry form", () => {
        // `cardProfileWriteErrors` checks the NORMALIZED archetype against
        // this registry, so a row whose id does not round-trip through
        // `normalizeArchetypes` could never be written through the editor.
        for (const row of ARCHETYPE_REGISTRY) {
            expect(normalizeArchetypes([row.id])).toEqual([row.id]);
        }
    });

    it("every row carries a non-trivial description (the review-repeatability requirement)", () => {
        for (const row of ARCHETYPE_REGISTRY) {
            expect(row.description.length).toBeGreaterThan(40);
        }
    });

    it("seeds the exact eight names the Vintage Cube census already uses (issue #3597 scope)", () => {
        // Closing the vocabulary must invalidate no existing seed row — the
        // acceptance criterion this assertion IS.
        const ids = new Set(ARCHETYPE_REGISTRY.map((row) => row.id));
        for (const seeded of [
            "aggro",
            "artifacts",
            "combo",
            "control",
            "graveyard",
            "ramp",
            "reanimator",
            "storm",
        ]) {
            expect(ids.has(seeded), seeded).toBe(true);
        }
    });
});

describe("isRegisteredArchetype", () => {
    it("accepts every registered row id", () => {
        for (const row of ARCHETYPE_REGISTRY) {
            expect(isRegisteredArchetype(row.id)).toBe(true);
        }
    });

    it("rejects the fork this registry exists to prevent", () => {
        expect(isRegisteredArchetype("reanimate")).toBe(false);
        expect(isRegisteredArchetype("graveyard-reanimator")).toBe(false);
        expect(isRegisteredArchetype("jeskai-tempo")).toBe(false);
    });

    it("rejects an empty string", () => {
        expect(isRegisteredArchetype("")).toBe(false);
    });

    it("does NOT normalize its input — it reads the stored form verbatim", () => {
        // Normalizing here would let a checked-in seed file carry ` Control `
        // through the guard while `archetypeFitTerm` grouped on a name no
        // other row matches. Callers normalize; this function does not.
        expect(isRegisteredArchetype("Control")).toBe(false);
        expect(isRegisteredArchetype(" control ")).toBe(false);
    });
});

// Real `CardDefinition.id`s (definitionIds, not display names) so a "clean"
// fixture validates with ZERO errors — not just zero Archetype errors.
const BLACK_LOTUS_ID = "b0faa7f2-b547-42c4-a810-839da50dadfe";
const ANIMATE_DEAD_ID = "8fd7861d-925f-4b4c-a4ab-60be6f43d50b";

describe("Guard test — unregistered Archetype name fails validation (issue #3597 acceptance)", () => {
    it("validateCardArchetypeFile rejects an `archetypes` string not in the registry", () => {
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

    it("validateCardArchetypeFile rejects a seed string that is only a CASING away from a row", () => {
        const badFile: CardArchetypeFile = {
            scope: "vintage-cube",
            archetypes: {
                [BLACK_LOTUS_ID]: {
                    archetypes: ["Storm"],
                    reviewed: false,
                },
            },
        };
        const result = validateCardArchetypeFile(badFile);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("Storm"))).toBe(true);
    });

    it("validateCardArchetypeFile accepts a fixture whose Archetypes are all registry rows", () => {
        const goodFile: CardArchetypeFile = {
            scope: "vintage-cube",
            archetypes: {
                [ANIMATE_DEAD_ID]: {
                    archetypes: ["reanimator", "graveyard"],
                    reviewed: false,
                },
            },
        };
        const result = validateCardArchetypeFile(goodFile);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });
});

describe("Write boundary — the database layer is held to the same vocabulary", () => {
    it("cardProfileWriteErrors rejects an unregistered Archetype", () => {
        const errors = cardProfileWriteErrors(ANIMATE_DEAD_ID, {
            archetypes: ["jeskai-tempo"],
            provides: [],
            requires: ["reanimatable"],
            reviewed: true,
        });
        expect(errors.some((e) => e.includes("jeskai-tempo"))).toBe(true);
    });

    it("cardProfileWriteErrors ACCEPTS a row whose casing normalization makes legal", () => {
        // The write boundary checks the normalized form — what
        // `buildCardProfileRows` is about to store — so `Reanimator` is a
        // legal write that lands as `reanimator`, never as a third spelling.
        expect(
            cardProfileWriteErrors(ANIMATE_DEAD_ID, {
                archetypes: [" Reanimator "],
                provides: [],
                requires: ["reanimatable"],
                reviewed: true,
            })
        ).toEqual([]);
    });
});

describe("Catalogue-wide sweep — every checked-in Archetype seed file (issues #3597, #8890)", () => {
    it("every checked-in seed file declares only registered Archetypes", () => {
        const files = getAllCheckedInCardArchetypeFiles();
        for (const file of files) {
            const unregistered = new Set<string>();
            for (const profile of Object.values(file.archetypes)) {
                for (const archetype of profile.archetypes) {
                    if (!isRegisteredArchetype(archetype)) {
                        unregistered.add(archetype);
                    }
                }
            }
            expect(
                [...unregistered],
                `unregistered Archetypes in scope "${file.scope}"`
            ).toEqual([]);
        }
    });

    it("the sweep above is NON-VACUOUS — the checked-in census really does declare Archetypes", () => {
        // Guards the same regression `capabilityRegistry.bot.test.ts`'s
        // non-vacuity test does: a sweep over zero strings passes forever.
        const declared = getAllCheckedInCardArchetypeFiles().flatMap((file) =>
            Object.values(file.archetypes).flatMap((p) => p.archetypes)
        );
        expect(declared.length).toBeGreaterThan(0);
        expect(new Set(declared).size).toBeGreaterThan(1);
    });
});
