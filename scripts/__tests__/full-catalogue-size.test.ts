import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";

/**
 * Guards for the Full Catalogue (manual mode, ADR 0080 § 3).
 *
 * The catalogue is GENERATED (`scripts/fetch-full-catalogue.mjs`) and the
 * `public/data/` copy the client fetches is COMMITTED — a production build must
 * not depend on a Scryfall bulk download. Two kinds of guard follow:
 *
 *  - **Wiring.** The asset's absence is silent at runtime — the fetch 404s,
 *    `useFullCatalogue` errors, manual mode shows an empty pool and the real
 *    builder loses its Unavailable Cards. So the artifact must be present and
 *    `catalogue:ensure` must stay wired into `dev` and `build` for the
 *    checkouts that predate tracking it.
 *  - **Budget + shape.** Measures the REAL file. An earlier version of this
 *    test gzipped a synthetic 3-card object it had just built and asserted THAT
 *    was under 1.5 MB — it could never fail on the real catalogue's growth,
 *    which is the only thing the budget is about. These assertions used to skip
 *    when the artifact was missing; now that it is committed, missing IS the
 *    failure.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const ARTIFACT = resolve(REPO_ROOT, "public/data/full-catalogue.json.gz");

/** The 1.5 MB budget is a permanent CI constraint (1.13 MB measured at ADR
 *  0080). The floor is entropic: 32,331 print UUIDs are 32,331 × 16 B = 517 KB
 *  no compressor can touch. Sharding is the answer when it is breached. */
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

function readArtifact(): FullCatalogue {
    return JSON.parse(
        gunzipSync(readFileSync(ARTIFACT)).toString("utf8")
    ) as FullCatalogue;
}

describe("Full Catalogue generation wiring", () => {
    const pkg = JSON.parse(
        readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    it("exposes a catalogue:ensure script backed by a real file", () => {
        expect(pkg.scripts["catalogue:ensure"]).toContain(
            "ensure-full-catalogue.mjs"
        );
        expect(
            existsSync(resolve(REPO_ROOT, "scripts/ensure-full-catalogue.mjs"))
        ).toBe(true);
    });

    it("ships the artifact itself (committed, not generated per deploy)", () => {
        expect(existsSync(ARTIFACT)).toBe(true);
    });

    it("runs the ensure step before dev and before build", () => {
        // Without this, a fresh clone / worktree / deploy serves no catalogue
        // and manual mode is silently dead.
        expect(pkg.scripts.dev).toContain("catalogue:ensure");
        expect(pkg.scripts.build).toContain("catalogue:ensure");
    });
});

describe("Full Catalogue size budget", () => {
    it("is at most 1.5 MB gzipped", () => {
        const size = statSync(ARTIFACT).size;
        console.log(
            `full-catalogue.json.gz: ${(size / 1024).toFixed(1)} KB (budget: ${(
                BUDGET_BYTES / 1024
            ).toFixed(0)} KB)`
        );
        expect(size).toBeLessThanOrEqual(BUDGET_BYTES);
    });
});

describe("Full Catalogue data integrity", () => {
    it("has no oracleId or oracle_text top-level fields", () => {
        const keys = Object.keys(readArtifact());
        expect(keys).not.toContain("oracleId");
        expect(keys).not.toContain("oracle_text");
    });

    // The ASSET stays dashless (the size reduction). The client restores the
    // dashes in `rehydrate` — see `src/lib/scryfallId.ts` — because every other
    // id in the project, and every Scryfall image path, is the dashed form.
    it("all printIds are dashless UUIDs", () => {
        for (const id of readArtifact().printIds) {
            expect(id).not.toMatch(/-/);
            expect(id).toHaveLength(32);
        }
    });

    it("all arrays have consistent length", () => {
        const catalogue = readArtifact();
        const len = catalogue.names.length;
        expect(catalogue.printIds).toHaveLength(len);
        expect(catalogue.typeLines).toHaveLength(len);
        expect(catalogue.manaCosts).toHaveLength(len);
        expect(catalogue.cmcs).toHaveLength(len);
        expect(catalogue.colourIdentities).toHaveLength(len);
        expect(catalogue.sets).toHaveLength(len);
        expect(catalogue.rarities).toHaveLength(len);
    });
});
