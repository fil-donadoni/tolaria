#!/usr/bin/env bun
/**
 * `bun run check:oracle` — the Oracle lockfile drift guard.
 *
 * Same job as `check:index` does for `data/card-index.json`: prove the
 * committed artefact matches the tree that generated it. What is different is
 * that the full regeneration needs a 24 MB Scryfall cache which is GITIGNORED,
 * and the gate is offline by contract (CLAUDE.md). So the guard is tiered, and
 * every tier that can run, runs:
 *
 *  1. HEADER HASHES (always, offline). The lockfile header pins a hash of the
 *     compiler's own source and a hash of the Mechanics Registry's names and
 *     statuses. Either one changing changes what the compiler emits, so either
 *     one differing from the tree means the lockfile is stale. This catches the
 *     failure that actually happens — a grammar rule edited without
 *     regenerating — with no corpus at all.
 *  2. PIN AGREEMENT (when `data/oracle-corpus.pin.json` is present). The header
 *     must name the same corpus the pin does, so a lockfile built from a
 *     different Scryfall snapshot than the one the repo pins is caught.
 *  3. FULL REGENERATE-AND-DIFF (when the corpus cache is present). Byte
 *     comparison, the strongest form. On a developer machine that has run
 *     `oracle:corpus` once, this is what runs.
 *
 * Tier 1 is not a weaker version of tier 3 — it is a DIFFERENT question that
 * tier 3 happens to also answer. Shipping only tier 3 would mean the guard is
 * silently a no-op on every clean checkout, which is the shape of a guard that
 * is not there.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildLockfile } from "./oracle-compile";
import { corpusIsCached, readCorpus, readPin } from "./oracle-corpus";
import {
    grammarHash,
    parseLockfile,
    registryHash,
    serializeLockfile,
} from "./lib/oracle-lockfile";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const LOCKFILE_PATH = join(ROOT, "data", "oracle-compiled.json");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function fail(message: string): never {
    process.stderr.write(`${RED}✗ oracle lockfile — ${message}${RESET}\n`);
    process.stderr.write(`${DIM}  fix: bun run oracle:compile${RESET}\n`);
    process.exit(1);
}

function main(): void {
    if (!existsSync(LOCKFILE_PATH))
        fail("data/oracle-compiled.json is missing");
    const lock = parseLockfile(readFileSync(LOCKFILE_PATH, "utf8"));

    // Tier 1 — header hashes.
    const expectedGrammar = grammarHash(ROOT);
    if (lock.header.grammarHash !== expectedGrammar) {
        fail(
            `grammar hash drift — convex/oracle/** has changed since the lockfile was generated\n` +
                `    header: ${lock.header.grammarHash}\n    tree:   ${expectedGrammar}`
        );
    }
    const expectedRegistry = registryHash();
    if (lock.header.registryHash !== expectedRegistry) {
        fail(
            `registry hash drift — a Mechanics Registry name or status has changed\n` +
                `    header: ${lock.header.registryHash}\n    tree:   ${expectedRegistry}`
        );
    }

    // Tier 2 — pin agreement.
    const pin = readPin();
    if (pin !== null && pin.sha256 !== lock.header.corpus.sha256) {
        fail(
            `corpus pin drift — the lockfile was built from a different Scryfall snapshot\n` +
                `    header: ${lock.header.corpus.updatedAt} (${lock.header.corpus.sha256.slice(0, 12)})\n` +
                `    pin:    ${pin.updatedAt} (${pin.sha256.slice(0, 12)})`
        );
    }

    // Tier 3 — full regenerate-and-diff, when the cache is here.
    if (corpusIsCached() && pin !== null) {
        const regenerated = serializeLockfile(buildLockfile(readCorpus()));
        if (regenerated !== readFileSync(LOCKFILE_PATH, "utf8")) {
            fail(
                "regenerating from the cached corpus does not reproduce the committed lockfile"
            );
        }
        process.stdout.write(
            `${GREEN}✓ oracle lockfile${RESET} ${DIM}(hashes + full regenerate-and-diff, ` +
                `${lock.header.counts.total} cards)${RESET}\n`
        );
        return;
    }

    process.stdout.write(
        `${GREEN}✓ oracle lockfile${RESET} ${DIM}(hashes; corpus cache absent, ` +
            `run \`bun run oracle:corpus\` for the full regenerate-and-diff)${RESET}\n`
    );
}

if (import.meta.main) {
    main();
}
