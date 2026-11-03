/**
 * The repair proof (issue #5462, #5639): a declared repair of a standing RED
 * re-runs the failing test files the RED verdict names, one file per run — a
 * RED can have several culprits, each repair turning only its own share green
 * (issue #7448).
 *
 * Two readers. `pr-check`'s `repair-proof` job refuses a repair that turns
 * none of them green. `health:fix amber`, on the push that merges the repair
 * (`health-early`, issue #7990), turns the lineage AMBER when ALL of them pass
 * on the merged tip: picks and landings resume, the next health run confirms
 * (GREEN) or refutes (the SECOND RED). Everything that decides is pure; the
 * reads are injected.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FITTED_WEIGHTS_PATH } from "./bot-refit";
import { readsLockedCorpus } from "./corpus-exclusion";
import { DERIVED_PATHS } from "./derive-sync";
import {
    lineageBlocks,
    type Lineage,
    type Verdict,
} from "./health-verdict-store";
import { createImportGraph } from "./import-graph";
import type { LandingKind } from "./red-land-gate";
import { TEST_ALIASES } from "./test-reach";

const FULL_SHA = /^[0-9a-f]{40}$/;

export interface RepairProof {
    tests: string[];
    redSha: string;
}

/** The repair proof a landing owes: a declared repair of a standing RED whose
 *  verdict names failing test files. */
export function repairProofOf(
    lineage: Lineage,
    landingKind: LandingKind | undefined
): RepairProof | undefined {
    const v = lineage.verdict;
    if (landingKind !== "repair" || !lineageBlocks(lineage.kind) || !v)
        return undefined;
    // `*.test.*` only: a blade `*.spec.ts` belongs to `vitest.blade.config.ts`
    // and the default config would answer "No test files found" — refusing
    // the repair. A blade RED stands until health, as before AMBER.
    const tests = (v.tests ?? []).filter((t) =>
        /\.test\.[cm]?[jt]sx?$/.test(t)
    );
    if (tests.length === 0 || !FULL_SHA.test(v.sha)) return undefined;
    return { tests, redSha: v.sha };
}

/** One command of the repair proof's run; the exit code (null → 1). */
export type ProofExec = (argv: readonly string[], cwd: string) => number;

function spawnExec(argv: readonly string[], cwd: string): number {
    const [cmd, ...args] = argv;
    return spawnSync(cmd, args, { cwd, stdio: "inherit" }).status ?? 1;
}

/** Runs the failing tests of a repaired RED, ONE FILE PER RUN: the exit code
 *  of each, in order (every one `derive:regenerate`'s when the tree cannot be
 *  rebuilt). Per file because a RED can have several culprits, each repair
 *  turning only its own share green (issue #7448) — one vitest run over them
 *  all would read as red whichever repair landed first. The caller skips the
 *  files the repair deleted or moved.
 *
 *  On the derived state REBUILT, like the queue's draft (`check:lane
 *  --regenerate-derived`): a PR stops carrying it (ADR 0157),
 *  so the merge-base's bytes still index a card a revert removed and every
 *  catalogue-freezing suite crashes on a stale Definition Index — the repair
 *  could never prove itself (issue #7489). Restored after, whatever the
 *  verdict: `land:ready` runs this in the PR's own worktree. */
export function repairProofRun(
    tests: readonly string[],
    cwd: string,
    exec: ProofExec = spawnExec
): number[] {
    const regen = exec(["bun", "run", "derive:regenerate"], cwd);
    try {
        if (regen !== 0) return tests.map(() => regen);
        return tests.map((t) => exec(["bunx", "vitest", "run", t], cwd));
    } finally {
        exec(["git", "checkout", "-q", "HEAD", "--", ...DERIVED_PATHS], cwd);
    }
}

/** Whether a test's verdict rests on the locked verdict corpus: it reads the
 *  corpus fixture itself, or its import closure reaches the fitted weights —
 *  fitted FROM the corpus, so a hosted `derive:regenerate` (no reader key)
 *  leaves them at their committed bytes instead of refitting them
 *  (`refitPlan`, issue #7819). Such a test, run there, judges the PR against
 *  the base's weights, not its own: a weight-floor test a repair turns green
 *  only through the refit reads red, and the proof refuses a sound repair. */
export function fileReadsCorpus(file: string, cwd: string): boolean {
    if (readsLockedCorpus(readFileSync(resolve(cwd, file), "utf8")))
        return true;
    const graph = createImportGraph({ root: cwd, aliases: TEST_ALIASES });
    return graph.closureOf(file).has(FITTED_WEIGHTS_PATH);
}

/** Everything `repairAmberDecision` reads, each injected. */
export interface RepairAmberFacts {
    /** The pushed base tip. */
    tip: string;
    lineage: Lineage & { error?: string };
    /** The verdict already stored on `tip`, if any. */
    stored: () => Verdict | null;
    /** Does `sha` lie on the tip's history? */
    descendsFrom: (sha: string) => boolean;
    /** Does the push merge a declared repair of the standing RED? */
    mergesRepair: () => boolean;
    exists: (test: string) => boolean;
    /** The tests this runner cannot judge (no reader key). */
    unprovable: (tests: readonly string[]) => readonly string[];
    /** One exit code per test file, in order. */
    run: (tests: readonly string[]) => readonly number[];
}

export type RepairAmberDecision =
    | { kind: "amber"; repairOf: string; tests: readonly string[] }
    | { kind: "none"; why: string };

/**
 * Does the pushed tip earn AMBER (issue #7990)? Only when it merges a declared
 * repair and EVERY failing test the RED names passes on it. Fail closed: all
 * else leaves the RED standing until health, which is only slower. The checks
 * that cost nothing come first, the test run last.
 *
 *  - a verdict already on the tip: never overwritten (health's, or the early
 *    run's RED — last writer wins on the store);
 *  - a RED the tip does not descend from: an AMBER older than its RED would
 *    read as a SECOND RED (`lineageOf`) and skip the ladder's rungs;
 *  - a cut file list (`testsMore`): "all named" is not "all failing";
 *  - a test this runner cannot judge: unproved, not proved.
 */
export function repairAmberDecision(f: RepairAmberFacts): RepairAmberDecision {
    const none = (why: string): RepairAmberDecision => ({ kind: "none", why });
    if (f.lineage.error)
        return none(`the verdict store could not be read: ${f.lineage.error}`);
    if (!lineageBlocks(f.lineage.kind)) return none("no RED stands");
    if (f.stored() !== null)
        return none(`${f.tip.slice(0, 8)} already holds a verdict`);
    if (!f.mergesRepair())
        return none("the push merges no declared repair of the RED");
    const proof = repairProofOf(f.lineage, "repair");
    if (proof === undefined)
        return none("the RED names no failing test file to prove");
    if (!f.descendsFrom(proof.redSha))
        return none(
            `the tip does not descend from ${proof.redSha.slice(0, 8)}`
        );
    if (f.lineage.verdict?.testsMore)
        return none("the RED's failing-file list was cut");
    const tests = proof.tests.filter(f.exists);
    if (tests.length === 0)
        return none("no failing test the RED names exists on the tip");
    const unprovable = f.unprovable(tests);
    if (unprovable.length > 0)
        return none(`not provable here: ${unprovable.join(", ")}`);
    const status = f.run(tests);
    const stillRed = tests.filter((_, i) => status[i] !== 0);
    if (stillRed.length > 0)
        return none(`still red on the tip: ${stillRed.join(", ")}`);
    return { kind: "amber", repairOf: proof.redSha, tests };
}
