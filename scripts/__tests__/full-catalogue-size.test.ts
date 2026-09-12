import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { join, resolve } from "node:path";

/**
 * Guards for the Full Catalogue (manual mode, ADR 0080 § 3).
 *
 * The catalogue is GENERATED (`scripts/fetch-full-catalogue.mjs`) and COMMITTED
 * under `data/full-catalogue/` — a production build must not depend on a
 * Scryfall bulk download. Three kinds of guard follow:
 *
 *  - **Wiring.** The asset's absence is silent at runtime — the fetch fails,
 *    `useFullCatalogue` errors, manual mode shows an empty pool and the real
 *    builder loses its Unavailable Cards. So the artifact must be present and
 *    `catalogue:ensure` must stay wired into `dev` and `build` for the
 *    checkouts that predate tracking it.
 *  - **Content addressing** (issue #3500). The file NAME is the client's only
 *    cache-busting mechanism: `src/lib/fullCatalogue.ts` globs the directory at
 *    build time, so a name that does not move when the bytes move leaves every
 *    CDN and browser free to answer with the previous payload — which is
 *    exactly what the old fixed `/data/full-catalogue.json.gz` did. The name is
 *    therefore re-derived here from the bytes on disk, and the directory must
 *    hold exactly one artifact (two would leave the client's glob with a choice
 *    it refuses to make).
 *  - **Budget + shape.** Measures the REAL file. An earlier version of this
 *    test gzipped a synthetic 3-card object it had just built and asserted THAT
 *    was under 1.5 MB — it could never fail on the real catalogue's growth,
 *    which is the only thing the budget is about. These assertions used to skip
 *    when the artifact was missing; now that it is committed, missing IS the
 *    failure.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const ARTIFACT_DIR = resolve(REPO_ROOT, "data/full-catalogue");

/** The same 16 hex characters of sha256 the generator names the file with. */
const HASH_CHARS = 16;

/** Every artifact in the directory, sorted — the question the client's glob
 *  asks at build time, asked here of the tree. */
function artifactNames(): string[] {
    if (!existsSync(ARTIFACT_DIR)) return [];
    return readdirSync(ARTIFACT_DIR)
        .filter(
            (f) => f.startsWith("full-catalogue-") && f.endsWith(".json.gz")
        )
        .sort();
}

/** The one artifact's absolute path. Fails loudly rather than picking. */
function artifactPath(): string {
    const names = artifactNames();
    expect(names).toHaveLength(1);
    return join(ARTIFACT_DIR, names[0]!);
}

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
        gunzipSync(readFileSync(artifactPath())).toString("utf8")
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
        expect(artifactNames()).toHaveLength(1);
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
        const path = artifactPath();
        const size = statSync(path).size;
        console.log(
            `full-catalogue.json.gz: ${(size / 1024).toFixed(1)} KB (budget: ${(
                BUDGET_BYTES / 1024
            ).toFixed(0)} KB)`
        );
        expect(size).toBeLessThanOrEqual(BUDGET_BYTES);
    });
});

/**
 * The cache-busting guard (issue #3500).
 *
 * The client asks for whatever single file this directory holds, and Vite
 * emits it under `/assets/` where `vercel.json` marks it `immutable` for a
 * year. That is only safe because the NAME moves with the BYTES: a hand-picked
 * or pinned name would hand every cache a permanent licence to serve the
 * previous catalogue. So the name is re-derived from the file's own bytes
 * here — regenerate without renaming and this reds.
 */
describe("Full Catalogue content addressing", () => {
    it("holds exactly one artifact, so the client's glob never picks", () => {
        // Two artifacts is an add/add merge of two generations. `fullCatalogueUrl`
        // throws rather than choose; this names the files before a build does.
        // Joined, so the failure message IS the file list, and so that a second
        // artifact fails the same assertion the shape does.
        expect(artifactNames().join(", ")).toMatch(
            /^full-catalogue-[0-9a-f]{16}\.json\.gz$/
        );
    });

    it("names the artifact by the sha256 of its own bytes", () => {
        const [name] = artifactNames();
        const hash = createHash("sha256")
            .update(readFileSync(join(ARTIFACT_DIR, name!)))
            .digest("hex")
            .slice(0, HASH_CHARS);
        expect(name).toBe(`full-catalogue-${hash}.json.gz`);
    });

    it("is fetched through the build-time glob, never a fixed URL", () => {
        // The regression this closes: a committed URL constant that keeps
        // pointing at the previous payload's path.
        const client = readFileSync(
            resolve(REPO_ROOT, "src/lib/fullCatalogue.ts"),
            "utf8"
        );
        expect(client).toContain("import.meta.glob");
        expect(client).not.toContain('"/data/full-catalogue.json.gz"');
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
        // Scanned in plain JS, asserted ONCE. Two `expect()` calls per id over
        // 32k ids is ~65k assertion objects, which blew this test's 5s budget
        // whenever the machine was busy — a false red on a shared machine that
        // several sessions gate on by design (see scripts/gate.ts). A single
        // assertion is also a better failure: it names the offenders instead of
        // stopping at the first.
        const bad = readArtifact().printIds.filter(
            (id) => id.length !== 32 || id.includes("-")
        );
        expect(bad.slice(0, 5)).toEqual([]);
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
