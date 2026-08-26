import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Size budget guard for the compiled-card interim hydration artifact
 * (issue #2702, PRD #2693).
 *
 * `convex/cards/compiledCatalogue.ts` imports `data/oracle-compiled-pool.json`
 * — the compiler's `ready` rows, joined to a Scryfall id via
 * `data/card-index.json` — at MODULE LOAD, on both the server and (through
 * `convex/cards/catalogue.ts`, which `src/main.tsx` imports) the client
 * bundle. That is deliberately the WHOLE compiled-ready pool, not a per-deck
 * slice — issue #2702's title calls this "interim bundle-time JSON import",
 * explicitly distinct from the "hydrated by id per game/deck, never the
 * whole set" contract PRD #2693 fixes for the LATER physical store (that
 * store's design — table vs shard asset, hot/cold split — is out of scope
 * here by the PRD's own text: "decided in a separate grill").
 *
 * The risk this guards against is concrete: the full lockfile
 * (`data/oracle-compiled.json`) is 34,890 rows across three states and is
 * ~11.4 MB; if EVERY corpus row were ever `ready` and imported the same way,
 * the interim artifact would be the "35k case" issue #2702 names explicitly
 * as the thing "the guard's message points at the store PRD" for. This test
 * measures the REAL committed artifact (mirrors
 * `scripts/__tests__/full-catalogue-size.test.ts`'s pattern and its own
 * documented lesson: an earlier version of that guard measured a
 * synthetic rebuilt object and could never fail on the real asset's growth).
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const ARTIFACT = resolve(REPO_ROOT, "data/oracle-compiled-pool.json");

/**
 * 2 MB budget. Measured at issue #2702's round-2 landing directly off the
 * committed artifact (`statSync`, not the pre-prettier generator output —
 * round 1 cited the wrong one; `data/oracle-compiled-pool.json` is now
 * `.prettierignore`d, so the two are the same number): 1,638 compiled
 * `ready` rows in the source lockfile, 1,429 of them (209 already
 * hand-written are excluded, ADR 0108) in the committed artifact —
 * 1,094,857 B (1.04 MB). 2 MB leaves roughly 2x headroom before this
 * interim JSON-import shape has to become the real per-deck store PRD #2693
 * defers. It is not remotely close to the "35k rows in the bundle" case: at
 * ~766 B/row measured here, the full 34,890-row corpus would be ~25.5 MB,
 * ~13x over this budget. Crossing it is
 * the intended signal to build that store, not to raise the number.
 */
const BUDGET_BYTES = 2_000_000;

describe("Compiled pool generation wiring (issue #2702)", () => {
    const pkg = JSON.parse(
        readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    it("exposes oracle:index and oracle:pool scripts backed by real files", () => {
        expect(pkg.scripts["oracle:index"]).toContain(
            "oracle-index-backfill.ts"
        );
        expect(pkg.scripts["oracle:pool"]).toContain("oracle-pool.ts");
        expect(
            existsSync(resolve(REPO_ROOT, "scripts/oracle-index-backfill.ts"))
        ).toBe(true);
        expect(existsSync(resolve(REPO_ROOT, "scripts/oracle-pool.ts"))).toBe(
            true
        );
    });

    it("ships the artifact itself (committed, not generated per deploy)", () => {
        expect(existsSync(ARTIFACT)).toBe(true);
    });
});

describe("Compiled pool size budget (issue #2702)", () => {
    it(`is at most ${(BUDGET_BYTES / 1024 / 1024).toFixed(1)} MB — past this, build the per-deck store PRD #2693 defers, don't raise the number`, () => {
        const size = statSync(ARTIFACT).size;
        console.log(
            `oracle-compiled-pool.json: ${(size / 1024).toFixed(1)} KB (budget: ${(
                BUDGET_BYTES / 1024
            ).toFixed(0)} KB)`
        );
        expect(size).toBeLessThanOrEqual(BUDGET_BYTES);
    });

    it("is a non-empty array of CardDefinition-shaped rows", () => {
        const pool = JSON.parse(readFileSync(ARTIFACT, "utf8")) as Array<{
            id: string;
            name: string;
            rarity: string;
        }>;
        expect(Array.isArray(pool)).toBe(true);
        expect(pool.length).toBeGreaterThan(0);
        for (const row of pool.slice(0, 20)) {
            expect(typeof row.id).toBe("string");
            expect(typeof row.name).toBe("string");
            expect(["common", "uncommon", "rare", "mythic"]).toContain(
                row.rarity
            );
        }
    });
});
