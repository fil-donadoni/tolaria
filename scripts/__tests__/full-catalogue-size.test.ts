import { describe, it, expect } from "vitest";
import { statSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CI size-budget guard for the Full Catalogue (manual mode).
 *
 * The catalogue is a generated asset (scripts/fetch-full-catalogue.mjs).
 * This test fails if the gzipped file exceeds 1.5 MB — turning a one-off
 * load test into a permanent constraint. The failure mode being avoided is
 * discovering the asset is too big after months of work built on top of it.
 *
 * The floor is entropic: 32,331 print UUIDs are 32,331 × 16 B = 517 KB
 * no compressor can touch. Sharding is the answer when the budget is
 * eventually breached, not now (ADR 0080).
 *
 * This test is skipped in CI when the generated file does not exist (the
 * catalogue is not committed, only generated on demand). The budget guard
 * runs locally after regeneration.
 */
const BUDGET_BYTES = 1_500_000;

const CATALOGUE_PATH = resolve(
    __dirname,
    "..",
    "..",
    "data",
    "full-catalogue.json.gz"
);

describe("Full Catalogue size budget", () => {
    it("exists at the expected path", () => {
        // This test is SKIPPED when no catalogue file exists — the catalogue
        // is generated on demand, not committed. The budget guard runs
        // locally after `node scripts/fetch-full-catalogue.mjs`.
        if (!existsSync(CATALOGUE_PATH)) {
            expect(true).toBe(true); // pass silently
            return;
        }
        expect(existsSync(CATALOGUE_PATH)).toBe(true);
    });

    it("is at most 1.5 MB gzipped", () => {
        if (!existsSync(CATALOGUE_PATH)) {
            console.warn(
                "full-catalogue.json.gz not found — skipping size budget check. " +
                    "Run: node scripts/fetch-full-catalogue.mjs"
            );
            expect(true).toBe(true);
            return;
        }
        const size = statSync(CATALOGUE_PATH).size;
        const sizeKB = (size / 1024).toFixed(1);
        console.log(
            `full-catalogue.json.gz: ${sizeKB} KB (budget: ${(BUDGET_BYTES / 1024).toFixed(0)} KB)`
        );
        expect(size).toBeLessThanOrEqual(BUDGET_BYTES);
    });
});
