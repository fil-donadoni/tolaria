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
 *     compiler's own source — the grammar under `convex/oracle/**` AND the
 *     driver that turns it into this file (`scripts/oracle-corpus.ts`,
 *     `scripts/oracle-compile.ts`, `scripts/lib/oracle-lockfile.ts`) — plus a
 *     hash of the Mechanics Registry's names and statuses. Any of them changing
 *     changes what the compiler emits, so any of them differing from the tree
 *     means the lockfile is stale. This catches the failure that actually
 *     happens — a rule or a tally edited without regenerating — with no corpus
 *     at all.
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
 *
 * Also guards `data/oracle-legality.json` (issue #2695), the sibling artifact
 * `convex/formats.ts` consumes for Premodern deck legality. It has no
 * "compiler source" to hash (its only input is the corpus), so its tiers are:
 * a self-contained CONTENT-HASH check offline (always — no corpus, no pin,
 * just the committed file re-hashing its own `premodern[]` and comparing
 * against its own committed `contentHash`), pin agreement offline (when
 * `data/oracle-corpus.pin.json` is present), and full regenerate-and-diff
 * when the corpus cache is present. The content-hash tier exists because pin
 * agreement alone is content-blind: it proves the file CLAIMS to come from a
 * given Scryfall snapshot, never that `premodern[]` itself still matches that
 * claim — a hand-edit or a bad merge-conflict resolution touching only the
 * array used to pass with exit 0 on a clean checkout (no corpus cache, the
 * NORMAL state — issue #2695 review finding 4). A production-consumed
 * artifact with no drift guard at all would silently rot the moment the
 * corpus is re-pinned without re-running `oracle:legality` — sharing this
 * file's `check:oracle` wiring (rather than a second package.json script)
 * keeps the gate surface from growing per artifact.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildLockfile } from "./oracle-compile";
import {
    buildLegalityFile,
    legalityContentHash,
    serializeLegalityFile,
    type OracleLegalityFile,
} from "./oracle-legality";
import { corpusIsCached, readCorpus, readPin } from "./oracle-corpus";
import {
    compilerHash,
    parseLockfile,
    registryHash,
    serializeLockfile,
} from "./lib/oracle-lockfile";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const LOCKFILE_PATH = join(ROOT, "data", "oracle-compiled.json");
const LEGALITY_PATH = join(ROOT, "data", "oracle-legality.json");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/**
 * Fail with a remedy the reader can actually run.
 *
 * `bun run oracle:compile` alone is a dead end on a machine that has never
 * fetched the corpus: `data/oracle-corpus.json.gz` is gitignored, so the
 * compile exits 1 on a missing cache and the reader is left reverse-engineering
 * a bootstrap step out of a hash mismatch. So the fix line names the ONE-OFF
 * `oracle:corpus` fetch explicitly whenever the cache is absent.
 *
 * Same problem, and the same shape of answer, as `catalogue:ensure`
 * (`scripts/ensure-full-catalogue.mjs`): a generated artefact that is not in
 * git needs its bootstrap named at the point of failure, not in a doc the
 * reader would have to already know to open. The difference is that
 * `catalogue:ensure` can run its generator itself, and this one must not — the
 * gate is offline by contract (CLAUDE.md), so a check may TELL you to hit the
 * network and may never do it for you.
 */
function fail(label: string, message: string, fixCommand: string): never {
    process.stderr.write(`${RED}✗ ${label} — ${message}${RESET}\n`);
    if (corpusIsCached()) {
        process.stderr.write(`${DIM}  fix: ${fixCommand}${RESET}\n`);
    } else {
        process.stderr.write(
            `${DIM}  fix: bun run oracle:corpus   # one-off Scryfall fetch — ` +
                `data/oracle-corpus.json.gz is gitignored and absent here\n` +
                `       then: ${fixCommand}${RESET}\n`
        );
    }
    process.exit(1);
}

function checkLockfile(): void {
    if (!existsSync(LOCKFILE_PATH))
        fail(
            "oracle lockfile",
            "data/oracle-compiled.json is missing",
            "bun run oracle:compile"
        );
    const lock = parseLockfile(readFileSync(LOCKFILE_PATH, "utf8"));

    // Tier 1 — header hashes.
    const expectedCompiler = compilerHash(ROOT);
    if (lock.header.compilerHash !== expectedCompiler) {
        fail(
            "oracle lockfile",
            `compiler hash drift — a compiler source file has changed since the lockfile was generated\n` +
                `    (convex/oracle/**, scripts/oracle-corpus.ts, scripts/oracle-compile.ts, scripts/lib/oracle-lockfile.ts)\n` +
                `    header: ${lock.header.compilerHash}\n    tree:   ${expectedCompiler}`,
            "bun run oracle:compile"
        );
    }
    const expectedRegistry = registryHash();
    if (lock.header.registryHash !== expectedRegistry) {
        fail(
            "oracle lockfile",
            `registry hash drift — a Mechanics Registry name or status has changed\n` +
                `    header: ${lock.header.registryHash}\n    tree:   ${expectedRegistry}`,
            "bun run oracle:compile"
        );
    }

    // Tier 2 — pin agreement.
    const pin = readPin();
    if (pin !== null && pin.sha256 !== lock.header.corpus.sha256) {
        fail(
            "oracle lockfile",
            `corpus pin drift — the lockfile was built from a different Scryfall snapshot\n` +
                `    header: ${lock.header.corpus.updatedAt} (${lock.header.corpus.sha256.slice(0, 12)})\n` +
                `    pin:    ${pin.updatedAt} (${pin.sha256.slice(0, 12)})`,
            "bun run oracle:compile"
        );
    }

    // Tier 3 — full regenerate-and-diff, when the cache is here.
    if (corpusIsCached() && pin !== null) {
        const regenerated = serializeLockfile(buildLockfile(readCorpus()));
        if (regenerated !== readFileSync(LOCKFILE_PATH, "utf8")) {
            fail(
                "oracle lockfile",
                "regenerating from the cached corpus does not reproduce the committed lockfile",
                "bun run oracle:compile"
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

/**
 * Guards `data/oracle-legality.json` (issue #2695). No compiler/registry hash
 * applies — the file's only input is the corpus — so this has just the pin
 * and full-regenerate tiers.
 */
function checkLegality(): void {
    if (!existsSync(LEGALITY_PATH))
        fail(
            "oracle legality",
            "data/oracle-legality.json is missing",
            "bun run oracle:legality"
        );
    const legality = JSON.parse(
        readFileSync(LEGALITY_PATH, "utf8")
    ) as OracleLegalityFile;

    // Tier "content hash" — always, offline, no corpus/pin needed. Proves
    // `premodern[]` matches its own committed `contentHash`; see the file
    // header for why pin agreement alone cannot catch this.
    const expectedContentHash = legalityContentHash(legality.premodern);
    if (legality.contentHash !== expectedContentHash) {
        fail(
            "oracle legality",
            `content-hash mismatch — data/oracle-legality.json's premodern[] array ` +
                `does not match its own committed contentHash (hand-edited or corrupted)\n` +
                `    committed: ${legality.contentHash}\n` +
                `    computed:  ${expectedContentHash}`,
            "bun run oracle:legality"
        );
    }

    // Tier "pin agreement" — offline.
    const pin = readPin();
    if (pin !== null && pin.sha256 !== legality.corpus.sha256) {
        fail(
            "oracle legality",
            `corpus pin drift — data/oracle-legality.json was built from a different Scryfall snapshot\n` +
                `    header: ${legality.corpus.updatedAt} (${legality.corpus.sha256.slice(0, 12)})\n` +
                `    pin:    ${pin.updatedAt} (${pin.sha256.slice(0, 12)})`,
            "bun run oracle:legality"
        );
    }

    // Tier "full regenerate-and-diff" — when the corpus cache is here.
    if (corpusIsCached() && pin !== null) {
        const regenerated = serializeLegalityFile(
            buildLegalityFile(readCorpus(), pin)
        );
        if (regenerated !== readFileSync(LEGALITY_PATH, "utf8")) {
            fail(
                "oracle legality",
                "regenerating from the cached corpus does not reproduce the committed data/oracle-legality.json",
                "bun run oracle:legality"
            );
        }
        process.stdout.write(
            `${GREEN}✓ oracle legality${RESET} ${DIM}(content-hash + pin + full regenerate-and-diff, ` +
                `${legality.premodern.length} Premodern names)${RESET}\n`
        );
        return;
    }

    process.stdout.write(
        `${GREEN}✓ oracle legality${RESET} ${DIM}(content-hash + pin; corpus cache absent, ` +
            `run \`bun run oracle:corpus\` for the full regenerate-and-diff)${RESET}\n`
    );
}

function main(): void {
    checkLockfile();
    checkLegality();
}

if (import.meta.main) {
    main();
}
