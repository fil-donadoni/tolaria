#!/usr/bin/env node
/**
 * Makes sure the Full Catalogue asset the client fetches actually exists
 * (`public/data/full-catalogue.json.gz`, ADR 0080 § 3).
 *
 * The asset is GENERATED (`scripts/fetch-full-catalogue.mjs`) and gitignored,
 * so a fresh clone, a new worktree, and every deploy start without it — the
 * fetch 404s, `useFullCatalogue` errors, and manual mode silently degrades to
 * an empty card pool while the real builder loses its Unavailable Cards. That
 * is invisible unless you already know to look for it, which is why the dev
 * and build scripts run this first.
 *
 * Order of preference, cheapest first:
 *   1. already in `public/data/` and plausibly sized → nothing to do
 *   2. present in `data/` (the generator's primary output) → copy it over
 *   3. otherwise → run the generator (downloads the Scryfall bulk)
 *
 * `--force` skips straight to the generator.
 */

import { existsSync, statSync } from "node:fs";
import { mkdir, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const dataPath = resolve(repoRoot, "data/full-catalogue.json.gz");
const publicPath = resolve(repoRoot, "public/data/full-catalogue.json.gz");

/** A truncated/aborted download leaves a small file behind. The real asset is
 *  ~1.1 MB; anything under 100 KB is treated as absent rather than trusted. */
const MIN_PLAUSIBLE_BYTES = 100_000;

function isUsable(path) {
    return existsSync(path) && statSync(path).size >= MIN_PLAUSIBLE_BYTES;
}

async function main() {
    const force = process.argv.includes("--force");

    if (!force && isUsable(publicPath)) {
        console.log("Full Catalogue: present, skipping generation.");
        return;
    }

    if (!force && isUsable(dataPath)) {
        await mkdir(dirname(publicPath), { recursive: true });
        await copyFile(dataPath, publicPath);
        console.log("Full Catalogue: copied data/ → public/data/.");
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
