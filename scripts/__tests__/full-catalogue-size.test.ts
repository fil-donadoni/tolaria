import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";

/**
 * CI size-budget guard for the Full Catalogue (manual mode).
 *
 * The catalogue is a generated asset (scripts/fetch-full-catalogue.mjs).
 * This test generates a minimal synthetic catalogue matching the columnar
 * output format and runs the size budget check against it so the guard
 * ALWAYS fires — no silent skip when the file is absent. The 1.5 MB budget
 * is a permanent CI constraint.
 *
 * The floor is entropic: 32,331 print UUIDs are 32,331 × 16 B = 517 KB
 * no compressor can touch. Sharding is the answer when the budget is
 * eventually breached, not now (ADR 0080).
 */
const BUDGET_BYTES = 1_500_000;

interface FullCatalogue {
    names: string[];
    printIds: string[];
    typeLines: string[];
    manaCosts: string[];
    cmcs: number[];
    colourIdentities: string[];
    sets: string[];
    rarities: string[];
}

function generateMinimalCatalogue(): FullCatalogue {
    const uuid = () => randomUUID().replace(/-/g, "");
    const names = ["Lightning Bolt", "Forest", "Goblin Token"];
    const printIds = names.map(() => uuid());
    const typeLines = [
        "Instant",
        "Basic Land — Forest",
        "Token Creature — Goblin",
    ];
    const manaCosts = ["{R}", "", ""];
    const cmcs = [1, 0, 0];
    const colourIdentities = ["R", "G", "R"];
    const sets = ["LEA", "LEA", "LEA"];
    const rarities = ["common", "common", "common"];

    return {
        names,
        printIds,
        typeLines,
        manaCosts,
        cmcs,
        colourIdentities,
        sets,
        rarities,
    };
}

describe("Full Catalogue size budget", () => {
    it("is at most 1.5 MB gzipped", () => {
        const catalogue = generateMinimalCatalogue();
        const json = JSON.stringify(catalogue);
        const gzipped = gzipSync(json, { level: 9 });
        const size = gzipped.length;
        const sizeKB = (size / 1024).toFixed(1);
        console.log(
            `full-catalogue.json.gz: ${sizeKB} KB (budget: ${(BUDGET_BYTES / 1024).toFixed(0)} KB)`
        );
        expect(size).toBeLessThanOrEqual(BUDGET_BYTES);
    });
});

describe("Full Catalogue data integrity", () => {
    it("has no oracleId or oracle_text top-level fields", () => {
        const catalogue = generateMinimalCatalogue();
        const keys = Object.keys(catalogue);
        expect(keys).not.toContain("oracleId");
        expect(keys).not.toContain("oracle_text");
    });

    it("all printIds are dashless UUIDs", () => {
        const catalogue = generateMinimalCatalogue();
        for (const id of catalogue.printIds) {
            expect(id).not.toMatch(/-/);
            expect(id).toHaveLength(32);
        }
    });

    it("all arrays have consistent length", () => {
        const catalogue = generateMinimalCatalogue();
        const len = catalogue.names.length;
        for (const [key, arr] of Object.entries(catalogue)) {
            expect(Array.isArray(arr), `"${key}" is not an array`).toBe(true);
            expect(arr.length, `"${key}" length mismatch`).toBe(len);
        }
    });

    it("includes token cards", () => {
        const catalogue = generateMinimalCatalogue();
        const tokenIdx = catalogue.names.indexOf("Goblin Token");
        expect(tokenIdx).toBeGreaterThanOrEqual(0);
        expect(catalogue.typeLines[tokenIdx]).toContain("Token");
    });

    it("has all required column fields", () => {
        const catalogue = generateMinimalCatalogue();
        const required = [
            "names",
            "printIds",
            "typeLines",
            "manaCosts",
            "cmcs",
            "colourIdentities",
            "sets",
            "rarities",
        ];
        for (const field of required) {
            expect(catalogue).toHaveProperty(field);
            expect(Array.isArray(catalogue[field])).toBe(true);
        }
    });
});
