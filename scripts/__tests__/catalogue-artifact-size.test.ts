import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { CATALOGUE_DIR } from "../lib/catalogue-merge";
import { committedArtifacts } from "../catalogue-artifact";

/**
 * Size budget for the SERVED catalogue artifact (issue #3053, ADR 0113 §3).
 *
 * SUBJECT CHANGED, and that is the point of this file's rename. Its ancestor
 * (`oracle-pool-size.test.ts`, issue #2702) budgeted
 * `data/oracle-compiled-pool.json` as a proxy for a BUNDLE cost: that file was
 * imported at module load into both the `card-catalogue` chunk and the
 * `brain.worker` bundle, so its bytes were cold-load bytes. Issue #3053
 * removed that import — the client fetches
 * `data/catalogue/catalogue-<hash>.json` once, from a content-addressed
 * `immutable` URL — so the pool's committed size no longer describes anything
 * a user pays for. What the user pays for now is this artifact, over the wire
 * once per content hash, and resident in the heap for the session.
 *
 * WHAT CROSSING THIS MEANS IS ALSO DIFFERENT, and it is NOT "never raise the
 * number". The old budget's message was "build the store, don't raise it".
 * ADR 0113 §3 has since BUILT that store and decided, on measurements, that it
 * carries the WHOLE corpus: at 34,890 rows that is ~13.9 MB raw, ~1.09 MB
 * Brotli, ~29.5 MB of heap and ~100 ms to become resident — all of it
 * deliberate, and all of it roughly 3.5x ABOVE the ceilings below. So these
 * ceilings sit deliberately below the end state the ADR sanctions: they are a
 * DISCLOSURE trigger, and raising them IS the correct outcome of crossing one
 * — but only after the re-measure, never as the way to get a green run.
 *
 * Concretely, crossing means the cold-load cost has roughly tripled since it
 * was last measured in a real browser. Re-measure fetch/parse/heap
 * (`performance.measureUserAgentSpecificMemory()` under `crossOriginIsolated`,
 * the way ADR 0113 § Measured, not assumed did), restate the ADR's table with
 * the new numbers, and set the ceiling from that measurement. What ENDS the
 * whole-corpus design is heap, at the 45-60 MB ADR 0113 names — not this
 * number, which can be raised as far as that table stays honest.
 *
 * Measured 2026-09-06 on the committed artifact, 3,168 rows:
 * 1,461,663 B raw / 181,211 B Brotli (`brotliCompressSync` defaults, i.e.
 * quality 11 — the same setting a CDN serves this with, and the setting the
 * ADR's 12.7x ratio was measured at).
 */
const REPO_ROOT = resolve(__dirname, "..", "..");

/** ~2.7x today's 1,461,663 B. The heap proxy: raw JSON bytes are what the
 *  parse allocates against, and ADR 0113 measured 1.6 MB of heap for 763,663 B
 *  of rows. */
const RAW_BUDGET_BYTES = 4_000_000;

/** ~2.7x today's 181,211 B. The wire cost, once per content hash — a CDN
 *  serves JSON Brotli-compressed, so this is the number a cold load actually
 *  downloads, not the raw one above. */
const BROTLI_BUDGET_BYTES = 500_000;

function artifactPath(): string {
    const committed = committedArtifacts(REPO_ROOT);
    expect(
        committed,
        "data/catalogue/ must hold exactly one artifact — run: bun run catalogue:pack"
    ).toHaveLength(1);
    return resolve(REPO_ROOT, CATALOGUE_DIR, committed[0]!);
}

describe("Catalogue artifact generation wiring (issue #3053)", () => {
    const pkg = JSON.parse(
        readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    it("exposes catalogue:pack and catalogue:check, backed by a real file", () => {
        expect(pkg.scripts["catalogue:pack"]).toContain(
            "catalogue-artifact.ts"
        );
        expect(pkg.scripts["catalogue:check"]).toContain("--check");
        expect(
            existsSync(resolve(REPO_ROOT, "scripts/catalogue-artifact.ts"))
        ).toBe(true);
    });

    it("ships the artifact itself (committed, not generated per deploy)", () => {
        expect(existsSync(artifactPath())).toBe(true);
    });
});

describe("Catalogue artifact size budget (issue #3053, ADR 0113 §3)", () => {
    it(`is at most ${(RAW_BUDGET_BYTES / 1024 / 1024).toFixed(1)} MB raw — past this, re-measure heap in a real browser and restate ADR 0113 §3, don't raise the number`, () => {
        const size = statSync(artifactPath()).size;
        console.log(
            `catalogue artifact: ${(size / 1024).toFixed(1)} KB raw (budget: ${(
                RAW_BUDGET_BYTES / 1024
            ).toFixed(0)} KB)`
        );
        expect(size).toBeLessThanOrEqual(RAW_BUDGET_BYTES);
    });

    it(`is at most ${(BROTLI_BUDGET_BYTES / 1024).toFixed(0)} KB Brotli — the bytes a cold load really fetches`, () => {
        const compressed = brotliCompressSync(readFileSync(artifactPath()));
        console.log(
            `catalogue artifact: ${(compressed.length / 1024).toFixed(1)} KB Brotli (budget: ${(
                BROTLI_BUDGET_BYTES / 1024
            ).toFixed(0)} KB)`
        );
        expect(compressed.length).toBeLessThanOrEqual(BROTLI_BUDGET_BYTES);
    });

    it("is a non-empty array of CardDefinition-shaped rows", () => {
        const rows = JSON.parse(readFileSync(artifactPath(), "utf8")) as Array<{
            id: string;
            name: string;
            types: string[];
        }>;
        expect(Array.isArray(rows)).toBe(true);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows.slice(0, 20)) {
            expect(typeof row.id).toBe("string");
            expect(typeof row.name).toBe("string");
            expect(Array.isArray(row.types)).toBe(true);
        }
    });
});
