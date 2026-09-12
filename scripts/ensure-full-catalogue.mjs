#!/usr/bin/env node
/**
 * Makes sure the Full Catalogue asset the client fetches actually exists —
 * exactly one content-addressed artifact under `data/full-catalogue/`
 * (ADR 0080 § 3, issue #3500).
 *
 * The asset is GENERATED (`scripts/fetch-full-catalogue.mjs`) but COMMITTED,
 * deliberately: the alternative is re-downloading the Scryfall bulk on every
 * production build, which makes each deploy depend on a third party being up
 * and fast. Committed, the build is offline and deterministic and this script
 * is a no-op there.
 *
 * It still earns its place in `dev`/`build` for the cases where the asset is
 * genuinely absent — a checkout of an older ref, a deleted file, a `--force`
 * refresh. Absence is INVISIBLE at runtime until the fetch runs: the client's
 * build-time glob resolves to nothing, `useFullCatalogue` errors, and manual
 * mode silently degrades to an empty card pool while the real builder loses
 * its Unavailable Cards.
 *
 *   0 artifacts → run the generator (downloads the Scryfall bulk)
 *   1 artifact, plausibly sized → nothing to do
 *   2+ artifacts → HARD FAILURE naming them. Two artifacts is a merge that
 *     brought in a second generation; the client refuses to pick one
 *     (`fullCatalogueUrl`) and so does this. Deleting the wrong one ships a
 *     catalogue nobody chose, so the remedy is to regenerate, which also
 *     deletes the stale sibling.
 *
 * `--force` skips straight to the generator.
 */

import { existsSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { committedArtifacts } from "./fetch-full-catalogue.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = resolve(repoRoot, "data/full-catalogue");

/** A truncated/aborted download leaves a small file behind. The real asset is
 *  ~1.1 MB; anything under 100 KB is treated as absent rather than trusted. */
const MIN_PLAUSIBLE_BYTES = 100_000;

function usableArtifacts() {
    return committedArtifacts(outDir).filter(
        (f) =>
            existsSync(join(outDir, f)) &&
            statSync(join(outDir, f)).size >= MIN_PLAUSIBLE_BYTES
    );
}

async function main() {
    const force = process.argv.includes("--force");
    const present = committedArtifacts(outDir);

    if (present.length > 1) {
        throw new Error(
            `Full Catalogue: data/full-catalogue/ holds ${present.length} artifacts — ` +
                `${present.join(", ")}.\n` +
                "  A merge brought in a second generation; picking one would ship a " +
                "catalogue nobody chose.\n" +
                "  fix: bun run catalogue:build (it writes one and deletes the rest)"
        );
    }

    if (!force && usableArtifacts().length === 1) {
        console.log("Full Catalogue: present, skipping generation.");
        return;
    }

    console.log("Full Catalogue: missing — generating from Scryfall bulk...");
    const result = spawnSync(
        process.execPath,
        [resolve(here, "fetch-full-catalogue.mjs")],
        { stdio: "inherit", cwd: repoRoot }
    );
    if (result.status !== 0) {
        throw new Error(
            `Full Catalogue generation failed (exit ${result.status}).`
        );
    }
}

main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
});
