// Capability Registry guard tests (ADR 0072, PRD #1607 slice 1, issue
// #1608). Mirrors `convex/cards/__tests__/mechanicsRegistry.test.ts`'s
// authority-plus-CI-guard shape: this suite is the single CI authority on
// Capability names — any `provides`/`requires` string in a checked-in
// `cardProfiles` seed file that isn't a registry row fails here, and the
// registry itself is guarded against duplicate ids and an oversized
// vocabulary (ADR 0072: "the vocabulary must stay small (~15-25 names) to
// stay meaningful").
import { describe, it, expect } from "vitest";
import {
    CAPABILITY_REGISTRY,
    capabilitySatisfiedBy,
    isRegisteredCapability,
} from "../capabilityRegistry";
import {
    getCardCapabilityFile,
    validateCardCapabilityFile,
    type CardCapabilityFile,
} from "../cardProfilesCore";

describe("Capability Registry (ADR 0072, issue #1608)", () => {
    it("stays small — growth past ~25 rows is the signal to check Combo Edge/Archetype instead (ADR 0072 Consequences)", () => {
        // No LOWER bound: a smaller, fully-participating vocabulary is the
        // correct outcome (issue #1608 review, findings 2+3) — never padded
        // to hit a row-count target.
        expect(CAPABILITY_REGISTRY.length).toBeGreaterThan(0);
        expect(CAPABILITY_REGISTRY.length).toBeLessThanOrEqual(25);
    });

    it("every row documents BOTH a PROVIDES and a REQUIRES side (ADR 0072's two-sided matching requirement)", () => {
        // The structural check for the findings-2/3 bug class: a row
        // documenting only one direction (a `REQUIRES:`-only clause
        // describing the requiring card itself, or a `PROVIDES:`-only
        // standalone card-quality tag with no relational requirer) can
        // never match anything under "fit is computed by matching one
        // card's `requires` against another's `provides`" and must not be
        // in this registry.
        for (const row of CAPABILITY_REGISTRY) {
            expect(row.description, `row "${row.id}"`).toContain("PROVIDES:");
            expect(row.description, `row "${row.id}"`).toContain("REQUIRES:");
        }
    });

    it("every row has a unique id", () => {
        const ids = CAPABILITY_REGISTRY.map((row) => row.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("every row's id is a non-empty kebab-case string", () => {
        for (const row of CAPABILITY_REGISTRY) {
            expect(row.id).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
        }
    });

    it("every row carries a non-trivial description (the census-repeatability requirement)", () => {
        for (const row of CAPABILITY_REGISTRY) {
            expect(row.description.length).toBeGreaterThan(40);
        }
    });

    it("seeds the vocabulary this design was built on (ADR 0072 / issue #1608 scope)", () => {
        const ids = new Set(CAPABILITY_REGISTRY.map((row) => row.id));
        expect(ids.has("value-on-death")).toBe(true);
        expect(ids.has("value-on-attack")).toBe(true);
        expect(ids.has("value-on-cast")).toBe(true);
        expect(ids.has("reanimatable")).toBe(true);
    });
});

describe("isRegisteredCapability", () => {
    it("accepts every registered row id", () => {
        for (const row of CAPABILITY_REGISTRY) {
            expect(isRegisteredCapability(row.id)).toBe(true);
        }
    });

    it("rejects an unregistered name", () => {
        expect(isRegisteredCapability("dies-value")).toBe(false);
        expect(isRegisteredCapability("death-trigger")).toBe(false);
        expect(isRegisteredCapability("not-a-real-capability")).toBe(false);
    });

    it("rejects an empty string", () => {
        expect(isRegisteredCapability("")).toBe(false);
    });

    it("is case-sensitive (Capability ids are internal vocabulary, not user-facing text)", () => {
        expect(isRegisteredCapability("Reanimatable")).toBe(false);
        expect(isRegisteredCapability("REANIMATABLE")).toBe(false);
    });
});

// Real `CardDefinition.id`s (definitionIds, not display names) so a "clean"
// fixture validates with ZERO errors — not just zero Capability errors.
const BLACK_LOTUS_ID = "b0faa7f2-b547-42c4-a810-839da50dadfe";
const ANIMATE_DEAD_ID = "8fd7861d-925f-4b4c-a4ab-60be6f43d50b";

describe("Guard test — unregistered Capability name fails validation (issue #1608 acceptance)", () => {
    it("validateCardCapabilityFile rejects a `provides` string not in the registry", () => {
        const badFile: CardCapabilityFile = {
            capabilities: {
                [BLACK_LOTUS_ID]: {
                    provides: ["not-a-real-capability"],
                    requires: [],
                    reviewed: false,
                },
            },
        };
        const result = validateCardCapabilityFile(badFile);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) => e.includes("not-a-real-capability"))
        ).toBe(true);
    });

    it("validateCardCapabilityFile rejects a `requires` string not in the registry", () => {
        const badFile: CardCapabilityFile = {
            capabilities: {
                [ANIMATE_DEAD_ID]: {
                    provides: [],
                    requires: ["dies-value"],
                    reviewed: false,
                },
            },
        };
        const result = validateCardCapabilityFile(badFile);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("dies-value"))).toBe(true);
    });

    it("validateCardCapabilityFile accepts a fixture whose cardId resolves and whose Capabilities are registered", () => {
        const goodFile: CardCapabilityFile = {
            capabilities: {
                [ANIMATE_DEAD_ID]: {
                    provides: [],
                    requires: ["reanimatable"],
                    reviewed: false,
                },
            },
        };
        const result = validateCardCapabilityFile(goodFile);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it("flags an unresolvable cardId as well as an unregistered Capability", () => {
        const badFile: CardCapabilityFile = {
            capabilities: {
                "totally-not-a-card": {
                    provides: ["reanimatable"],
                    requires: [],
                    reviewed: false,
                },
            },
        };
        const result = validateCardCapabilityFile(badFile);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) => e.includes("totally-not-a-card"))
        ).toBe(true);
    });
});

describe("Catalogue-wide sweep — the checked-in Capability seed file (issues #1608, #8890)", () => {
    it("the catalogue-wide Capability file validates clean", () => {
        expect(
            validateCardCapabilityFile(getCardCapabilityFile()).errors
        ).toEqual([]);
    });

    it("the sweep above is NON-VACUOUS — the checked-in file really declares Capabilities (issue #1614)", () => {
        // Issue #1608 shipped this guard with zero checked-in files, so the
        // sweep passed without checking anything; the Vintage Cube census
        // (issue #1614) is the first real content. Asserting the collection
        // is non-empty is what stops the guard silently reverting to a
        // vacuous pass if a future refactor drops a file from the registry.
        const declared = Object.values(
            getCardCapabilityFile().capabilities
        ).flatMap((row) => [...row.provides, ...row.requires]);
        expect(declared.length).toBeGreaterThan(0);
    });
});

describe("mana-value-bounded rows (issue #1677)", () => {
    const bounded = CAPABILITY_REGISTRY.filter((row) => row.bound);

    it("every bound names a registered, non-bounded base capability", () => {
        expect(bounded.length).toBeGreaterThan(0);
        for (const row of bounded) {
            const baseId = row.bound!.capability;
            expect(isRegisteredCapability(baseId), row.id).toBe(true);
            expect(capabilitySatisfiedBy(baseId, [baseId], 0), row.id).toBe(
                true
            );
            expect(
                CAPABILITY_REGISTRY.find((r) => r.id === baseId)!.bound,
                row.id
            ).toBeUndefined();
        }
    });

    it("satisfied by the base capability at or below the ceiling, never above, never by the bounded id itself", () => {
        for (const row of bounded) {
            const { capability, maxManaValue } = row.bound!;
            expect(
                capabilitySatisfiedBy(row.id, [capability], maxManaValue)
            ).toBe(true);
            expect(
                capabilitySatisfiedBy(row.id, [capability], maxManaValue + 1)
            ).toBe(false);
            expect(capabilitySatisfiedBy(row.id, [], 0)).toBe(false);
            expect(capabilitySatisfiedBy(row.id, [row.id], 0)).toBe(false);
        }
    });

    it("a plain row is still matched by plain membership", () => {
        expect(capabilitySatisfiedBy("self-mills", ["self-mills"], 9)).toBe(
            true
        );
        expect(capabilitySatisfiedBy("self-mills", [], 0)).toBe(false);
    });
});
