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
 *     `scripts/oracle-compile.ts`, `scripts/lib/oracle-lockfile.ts`) AND the
 *     committed data inputs it stamps onto rows (`data/oracle-retirements.json`)
 *     — plus a hash of the Mechanics Registry's names and statuses, plus a hash
 *     of the POOL PROJECTION (`data/card-index.json` read as the set of oracle
 *     ids a hand-written definition covers, which is what the per-format `pool`
 *     figure counts — issue #3068). Any of them changing
 *     changes what the compiler emits, so any of them differing from the tree
 *     means the lockfile is stale. This catches the failure that actually
 *     happens — a rule or a tally edited without regenerating — with no corpus
 *     at all.
 *
 *     The card index is hashed as that PROJECTION and not as a file: it also
 *     changes for reasons that cannot move a `pool` figure (the compiler's own
 *     `source: "compiled"` rows, a `firstPrintId` correction), and reding those
 *     would demand a corpus download to clear a red on a lockfile whose bytes
 *     would not change — exactly the unsatisfiable-offline red this tiering
 *     exists to avoid.
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
 * Also guards the RETIREMENT MARKERS (issue #3049, ADR 0114 §1) — the third
 * thing this file proves and the only one that is not about staleness. Once a
 * card's hand-written definition is retired its lockfile row is the sole copy
 * of its behaviour, so `checkRetirements` proves offline that every marker is
 * true: the ledger and the rows agree, and no marked card still has a
 * hand-written definition in `data/card-index.json`. It shares this file's
 * wiring rather than adding a package.json script for the same reason the
 * legality guard does — the gate surface must not grow per artifact.
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

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildLockfile, poolOracleIds } from "./oracle-compile";
import {
    buildLegalityFile,
    legalityContentHash,
    serializeLegalityFile,
    type OracleLegalityFile,
} from "./oracle-legality";
import { corpusIsCached, readCorpus, readPin } from "./oracle-corpus";
import {
    compilerHash,
    LOCKFILE_INPUT_SUMMARY,
    parseLockfile,
    POOL_PROJECTION_SOURCE,
    poolHash,
    registryHash,
    serializeLockfile,
    type HeaderHashes,
    type Lockfile,
} from "./lib/oracle-lockfile";
import { ORIGIN_BASE } from "./lib/branches";
import {
    emptyRegressionLedger,
    parseRegressionLedger,
    readyRegressions,
    regressionMessage,
    staleAcknowledgements,
    unacknowledgedRegressions,
    REGRESSION_LEDGER_PATH,
    type RegressionLedger,
} from "./lib/oracle-state-regressions";
import {
    emptyRetirementLedger,
    parseRetirementLedger,
    validateRetirementLedger,
    RETIREMENT_LEDGER_PATH,
    type RetirementLedger,
} from "./lib/oracle-retirements";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const LOCKFILE_PATH = join(ROOT, "data", "oracle-compiled.json");
const LEGALITY_PATH = join(ROOT, "data", "oracle-legality.json");
const RETIREMENTS_PATH = join(ROOT, RETIREMENT_LEDGER_PATH);
const REGRESSIONS_PATH = join(ROOT, REGRESSION_LEDGER_PATH);

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
 *
 * `needsCorpus: false` suppresses that preamble for a failure whose remedy is
 * editing a committed LEDGER rather than regenerating an artefact. Telling a
 * reader to spend a 24 MB download before hand-writing one line of JSON sends
 * them down a bootstrap they do not need, and a fix line that is wrong once is
 * a fix line nobody reads again (issue #2696).
 */
function fail(
    label: string,
    message: string,
    fixCommand: string,
    needsCorpus = true
): never {
    process.stderr.write(`${RED}✗ ${label} — ${message}${RESET}\n`);
    if (!needsCorpus || corpusIsCached()) {
        process.stderr.write(`${DIM}  fix: ${fixCommand}${RESET}\n`);
    } else {
        process.stderr.write(
            `${DIM}  fix: bun run oracle:corpus   # fetches THE COMMITTED PIN — ` +
                `data/oracle-corpus.json.gz is gitignored and absent here\n` +
                `       then: ${fixCommand}\n` +
                `       (do NOT add --repin: taking today's Scryfall drop instead ` +
                `renumbers every gap index and\n` +
                `        turns a few-line lockfile diff into ~50k lines of churn)${RESET}\n`
        );
    }
    process.exit(1);
}

/**
 * Tier 1 as a PURE comparison over the three header hashes (issue #3068).
 *
 * Extracted for the same reason `retirementProblems` is: tier 1 is the only
 * tier that runs on a clean checkout, so its every branch has to be provable
 * without the 24 MB gitignored corpus — and a test that rebuilds the
 * comparison by hand proves nothing about the comparison the guard makes.
 * `checkLockfile` is the thin wrapper that supplies the tree's hashes and
 * turns a message into an exit code.
 *
 * Returns the FIRST drift as a ready-to-print message, or `null` when the
 * header matches the tree on all three.
 */
export function headerHashDrift(
    header: HeaderHashes,
    tree: HeaderHashes
): string | null {
    if (header.compilerHash !== tree.compilerHash) {
        return (
            `compiler hash drift — a lockfile input has changed since the lockfile was generated\n` +
            `    (${LOCKFILE_INPUT_SUMMARY})\n` +
            `    header: ${header.compilerHash}\n    tree:   ${tree.compilerHash}`
        );
    }
    if (header.registryHash !== tree.registryHash) {
        return (
            `registry hash drift — a Mechanics Registry name or status has changed\n` +
            `    header: ${header.registryHash}\n    tree:   ${tree.registryHash}`
        );
    }
    // The one input no offline tier used to see (issue #3068): the card index
    // reaches the lockfile ONLY as the per-format `pool` figure, so shipping a
    // card moved the true pool while the committed lockfile kept the old
    // number and every offline tier stayed green. Hashed as the PROJECTION
    // rather than the file, so the changes that cannot move a `pool` figure —
    // a `source: "compiled"` row, a `firstPrintId` correction — do not red a
    // lockfile whose bytes would not change.
    if (header.poolHash !== tree.poolHash) {
        return (
            `pool drift — ${POOL_PROJECTION_SOURCE} covers a different set of cards with a\n` +
            `    hand-written definition than the lockfile's per-format \`pool\` counts were built from\n` +
            `    header: ${header.poolHash}\n    tree:   ${tree.poolHash}`
        );
    }
    return null;
}

/** The tree's own answer to each of {@link headerHashDrift}'s three hashes. */
function treeHashes(): HeaderHashes {
    return {
        compilerHash: compilerHash(ROOT),
        registryHash: registryHash(),
        poolHash: poolHash(handWrittenOracleIds()),
    };
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
    const drift = headerHashDrift(lock.header, treeHashes());
    if (drift !== null)
        fail("oracle lockfile", drift, "bun run oracle:compile");

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
            `run \`bun run oracle:corpus\` — it reproduces the committed pin — for the full regenerate-and-diff)${RESET}\n`
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
            `run \`bun run oracle:corpus\` — it reproduces the committed pin — for the full regenerate-and-diff)${RESET}\n`
    );
}

/**
 * Every way a retirement marker can be a LIE, checked offline against the
 * committed tree (issue #3049, ADR 0114 §1).
 *
 * Pure over its three inputs — the ledger, the lockfile, and the oracle ids
 * still covered by a hand-written definition — so each refusal is testable
 * without a corpus, a lockfile on disk, or a card index.
 *
 * The marker's claim is "this row is the only copy of this card's behaviour".
 * Three things can falsify it, and all three are cheap to check:
 *
 *  - the ledger names a card the lockfile has no row for (the marker guards
 *    nothing);
 *  - a row carries a marker the ledger does not (a hand-edit to a file stamped
 *    "never hand-edited", or a marker that survived its ledger entry through a
 *    bad merge);
 *  - a marked card STILL has a hand-written definition in `data/card-index.json`
 *    (the retirement never happened, or the module came back). This one is the
 *    substantive check: a marker that says "no twin remains" while a twin
 *    remains sends a reviewer looking for a fallback that is right there, and
 *    hides the real problem — two authorities for one card, which ADR 0114 §3
 *    makes a RED rather than a precedence.
 */
export function retirementProblems(
    ledger: RetirementLedger,
    lock: Pick<Lockfile, "cards">,
    handWrittenOracleIds: ReadonlySet<string>
): string[] {
    const problems = validateRetirementLedger(ledger);
    const rowsById = new Map(lock.cards.map((row) => [row.oracleId, row]));
    const ledgerIds = new Set(ledger.retirements.map((e) => e.oracleId));

    for (const entry of ledger.retirements) {
        const where = `${entry.name} (${entry.oracleId})`;
        const row = rowsById.get(entry.oracleId);
        if (row === undefined) {
            problems.push(
                `${where}: the ledger retires this card but the lockfile has no row for it — the marker guards nothing`
            );
            continue;
        }
        if (row.retired === undefined) {
            problems.push(
                `${where}: the lockfile row carries no retirement marker — the lockfile is stale (run: bun run oracle:compile)`
            );
        } else if (
            row.retired.at !== entry.retiredAt ||
            row.retired.issue !== entry.issue ||
            row.retired.pr !== entry.pr
        ) {
            problems.push(
                `${where}: the row's marker disagrees with the ledger — the lockfile is stale or hand-edited ` +
                    `(row: ${JSON.stringify(row.retired)}, ledger: ${JSON.stringify({ at: entry.retiredAt, issue: entry.issue, pr: entry.pr })})`
            );
        }
        if (handWrittenOracleIds.has(entry.oracleId)) {
            problems.push(
                `${where}: marked retired, but data/card-index.json still lists a HAND-WRITTEN definition for it. ` +
                    `The marker claims this row is the only copy of the card and it is not — either the retirement ` +
                    `never deleted the module, or the module came back (ADR 0114 §3: two authorities for one card is a RED)`
            );
        }
    }

    for (const row of lock.cards) {
        if (row.retired !== undefined && !ledgerIds.has(row.oracleId)) {
            problems.push(
                `${row.name} (${row.oracleId}): the lockfile row is marked retired but ${RETIREMENT_LEDGER_PATH} ` +
                    `has no entry for it — the lockfile is generated from that ledger, so a marker without one was hand-added`
            );
        }
    }
    return problems;
}

function readLedger(): RetirementLedger {
    if (!existsSync(RETIREMENTS_PATH)) return emptyRetirementLedger();
    try {
        return parseRetirementLedger(readFileSync(RETIREMENTS_PATH, "utf8"));
    } catch (err) {
        fail(
            "oracle retirements",
            `${RETIREMENT_LEDGER_PATH} does not parse: ${(err as Error).message}`,
            "bun run oracle:retire --help"
        );
    }
}

function handWrittenOracleIds(): Set<string> {
    return poolOracleIds();
}

/**
 * Offline, always — no corpus, no pin. The retirement markers are the guard
 * for cards that no longer have a hand-written definition anywhere, so a
 * marker nobody verified is worse than no marker at all.
 */
function checkRetirements(): void {
    const ledger = readLedger();
    const lock = parseLockfile(readFileSync(LOCKFILE_PATH, "utf8"));
    const problems = retirementProblems(ledger, lock, handWrittenOracleIds());
    if (problems.length > 0) {
        fail(
            "oracle retirements",
            `${problems.length} problem(s) with the retirement markers ` +
                `(ADR 0114 §1 — a marked row is the ONLY copy of that card's behaviour):\n` +
                problems.map((p) => `    - ${p}`).join("\n"),
            // Not always `oracle:compile`: a marked card that still has a
            // hand-written definition is fixed by DELETING that definition (or
            // by dropping the ledger entry, if the retirement was wrong), and
            // regenerating would only re-stamp the same lie.
            "bun run oracle:compile   # or, for a card that still has a hand-written definition, delete that definition"
        );
    }
    process.stdout.write(
        `${GREEN}✓ oracle retirements${RESET} ${DIM}(${ledger.retirements.length} retired card(s); ` +
            `ledger, row markers and hand-written coverage agree)${RESET}\n`
    );
}

function readRegressionLedger(): RegressionLedger {
    if (!existsSync(REGRESSIONS_PATH)) return emptyRegressionLedger();
    try {
        return parseRegressionLedger(readFileSync(REGRESSIONS_PATH, "utf8"));
    } catch (err) {
        fail(
            "oracle state regressions",
            (err as Error).message,
            `edit ${REGRESSION_LEDGER_PATH}`,
            false
        );
    }
}

/** One git invocation's outcome, so a failure is a value rather than a throw. */
export type GitResult =
    | { readonly ok: true; readonly out: string }
    | {
          readonly ok: false;
          readonly error: string;
          /**
           * The git BINARY could not be spawned at all (ENOENT), as opposed to
           * git running and answering "no".
           *
           * The difference decides skip vs red on the very first probe: a
           * tarball export with no `.git` is a legitimate skip, while git
           * missing from `PATH` is broken tooling on a tree that IS a
           * repository — and collapsing the two is how the guard came to
           * print green with no git at all (review of issue #2696, finding 1).
           */
          readonly missing?: boolean;
      };

/** Runs `git <args>` in the repo root. Injected so the decision below is testable. */
export type GitRunner = (args: readonly string[]) => GitResult;

/**
 * What the base branch can tell us, as three OUTCOMES rather than a nullable.
 *
 * The distinction is the whole point. "There is no other commit to compare
 * against" is a legitimate skip — a tarball export, a clone that never fetched.
 * "The comparison broke" is a RED: git missing from `PATH`, a `git show` that
 * failed for a reason we did not anticipate, a baseline lockfile that does not
 * parse (exactly the schema-rewrite moment when a real regression is most
 * likely). Collapsing the two into `null` made every one of those print the
 * green skip line and exit 0 — the guard silently not guarding, which is the
 * failure mode this guard exists to prevent (review of issue #2696, finding 1).
 */
export type BaselineOutcome =
    | { readonly kind: "lockfile"; readonly lock: Lockfile }
    | { readonly kind: "unavailable"; readonly why: string }
    | { readonly kind: "broken"; readonly detail: string };

const BASELINE_LOCKFILE_REL = "data/oracle-compiled.json";

/**
 * The lockfile as the BASE BRANCH has it — the only honest baseline for "did
 * this change shrink the pool".
 *
 * Read through git rather than kept as a committed second copy of the same
 * rows: a checked-in baseline would have to be regenerated alongside the
 * lockfile, and a baseline you refresh in the same commit as the thing it
 * guards guards nothing.
 *
 * PURE given its runner, so every branch has a fixture. The wrapper that
 * actually shells out is `runGit` below; this function only decides.
 */
export function baselineOutcome(git: GitRunner): BaselineOutcome {
    const repo = git(["rev-parse", "--is-inside-work-tree"]);
    if (!repo.ok && repo.missing === true)
        return {
            kind: "broken",
            detail: `git is not on PATH (${repo.error}) — this tree is a git repository, so the baseline is readable and something is wrong with the environment, not with the repo`,
        };
    if (!repo.ok)
        return {
            kind: "unavailable",
            why: `not a git work tree here (${repo.error})`,
        };
    const ref = git([
        "rev-parse",
        "--verify",
        "--quiet",
        `${ORIGIN_BASE}^{commit}`,
    ]);
    if (!ref.ok)
        return {
            kind: "unavailable",
            why: `${ORIGIN_BASE} is not a ref in this clone — fetch the base branch to enable it`,
        };
    const mergeBase = git(["merge-base", "HEAD", ORIGIN_BASE]);
    if (!mergeBase.ok)
        return {
            kind: "broken",
            detail: `git merge-base HEAD ${ORIGIN_BASE} failed: ${mergeBase.error}`,
        };
    const at = `${mergeBase.out.trim()}:${BASELINE_LOCKFILE_REL}`;
    // `cat-file -e` separates "the merge-base predates the lockfile" (a
    // legitimate skip) from "git show blew up" (a red). Without it both arrive
    // as the same non-zero exit from `show`.
    if (!git(["cat-file", "-e", at]).ok)
        return {
            kind: "unavailable",
            why: `${BASELINE_LOCKFILE_REL} does not exist at the merge-base with ${ORIGIN_BASE}`,
        };
    const show = git(["show", at]);
    if (!show.ok)
        return {
            kind: "broken",
            detail: `git show ${at} failed: ${show.error}`,
        };
    try {
        return { kind: "lockfile", lock: parseLockfile(show.out) };
    } catch (err) {
        return {
            kind: "broken",
            detail: `the lockfile at ${at} does not parse: ${(err as Error).message}`,
        };
    }
}

/**
 * The real runner. `maxBuffer` is generous on purpose: the lockfile is ~10 MB
 * of text today and grows with the corpus, and a buffer overrun would surface
 * as `broken` — a red on a healthy tree — rather than as a wrong answer.
 */
const runGit: GitRunner = (args) => {
    try {
        return {
            ok: true,
            out: execFileSync("git", [...args], {
                cwd: ROOT,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                maxBuffer: 512 * 1024 * 1024,
            }),
        };
    } catch (err) {
        const e = err as { stderr?: string; message?: string; code?: string };
        return {
            ok: false,
            error: (e.stderr || e.message || "unknown error").trim(),
            ...(e.code === "ENOENT" ? { missing: true } : {}),
        };
    }
};

/**
 * Offline, and the one tier that asks a question about CHANGE rather than
 * about staleness: the committed lockfile may match the tree perfectly and
 * still have dropped 40 cards out of the pool since the base branch.
 */
function checkStateRegressions(): void {
    const baseline = baselineOutcome(runGit);
    if (baseline.kind === "broken") {
        fail(
            "oracle state regressions",
            `the base-branch comparison could not be made — ${baseline.detail}\n` +
                `    This is NOT a skip: a guard that cannot read its baseline is a guard\n` +
                `    that is not there, and the pool could be shrinking behind it.`,
            `fix the git state above, then re-run \`bun run check:oracle\``,
            false
        );
    }
    if (baseline.kind === "unavailable") {
        process.stdout.write(
            `${GREEN}✓ oracle state regressions${RESET} ${DIM}(skipped — ` +
                `${baseline.why})${RESET}\n`
        );
        return;
    }
    const lock = parseLockfile(readFileSync(LOCKFILE_PATH, "utf8"));
    const ledger = readRegressionLedger();
    const regressions = readyRegressions(baseline.lock.cards, lock.cards);
    const unacknowledged = unacknowledgedRegressions(regressions, ledger);
    if (unacknowledged.length > 0) {
        fail(
            "oracle state regressions",
            regressionMessage(unacknowledged),
            `edit ${REGRESSION_LEDGER_PATH}, or restore the rule that made those cards ready`,
            false
        );
    }
    const stale = staleAcknowledgements(regressions, ledger);
    process.stdout.write(
        `${GREEN}✓ oracle state regressions${RESET} ${DIM}(${regressions.length} ` +
            `ready-state loss(es) vs ${ORIGIN_BASE}, all acknowledged)${RESET}\n`
    );
    if (stale.length > 0) {
        process.stdout.write(
            `${DIM}  ${stale.length} stale acknowledgement(s) in ${REGRESSION_LEDGER_PATH} ` +
                `matching no current regression — safe to delete: ` +
                `${stale.map((a) => a.name).join(", ")}${RESET}\n`
        );
    }
}

function main(): void {
    checkLockfile();
    checkRetirements();
    checkStateRegressions();
    checkLegality();
}

if (import.meta.main) {
    main();
}
