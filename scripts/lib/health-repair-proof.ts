/**
 * A declared repair's tip is GREEN on the RED's own evidence (issue #7657,
 * ADR 0156 Amendment V, ADR 0159 Amendment I).
 *
 * A base tip that merges a declared repair of the standing RED — the PR that
 * closes one of the repair issues recorded on the pivot (`health-fix`
 * statuses, `readRunRepairIssues`) — is judged by what the RED proved, not by
 * a full gate: `health-main` runs the RED's failing files (then, when they
 * pass alone and ran in a shared-worker project, that project whole in one
 * worker — a cross-file leak reproduces only beside its polluter, issue
 * #7584), then every health step the RED's run never reached
 * (`remainingGates`: `test`'s chain after the failing tier, the steps after
 * the failed one), and writes GREEN when all pass. The steps the RED's run
 * already passed on the RED tip are not re-run. The rung-2 flake path
 * (`freshRunSteps`, `lib/health-bisect.ts`) applied to the repair tip
 * instead of the RED's own sha; the GREEN carries `REPAIR_PROOF_MARK` in its
 * description (`repairProofNote`), no new verdict state. The ordinary batch
 * gate still runs on the base (ADR 0154) and reads such a GREEN as not yet
 * the full gate (`gateSkipReason`), as does `release` (ADR 0116,
 * `releaseDecision`); the bisect's good bound walks past it (`lastGreenOf`):
 * a defect the proof never ran is found between the last FULL GREEN and the
 * new RED, the proof tip inside the range.
 *
 * The 15 RED episodes of 2026-10-24 → 10-31 spent ~8 h in full gates that
 * re-proved files a revert had restored.
 *
 * Fail closed: a RED naming no failing test file (a step failure — `check:all`
 * red, a crash) owes the full gate; so does a RED whose description cut its
 * file list (`testsMore`) with no evidence to read, a RED whose evidence
 * could not be read, a RED a proof run itself wrote (the trust would chain),
 * a RED at a step the run does not know, a tip that does not descend from
 * the RED, a lineage with no RED, a failing file the tip neither has nor
 * deleted nor renamed, and any fact that could not be read. A RED a
 * GitHub-hosted run wrote skipped the committed-corpus tests
 * (`corpusExcluded`): those files join the proof.
 *
 * Everything that decides is pure (`repairProofPlan`, `declaredRepairAmong`,
 * `resolveMovedFiles`, `runRepairProof` over injected effects);
 * `tipMergesDeclaredRepair`, `fileMovesBetween` and `corpusTestFiles` are the
 * I/O, each total.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readsLockedCorpus } from "./corpus-exclusion";
import {
    baseStepName,
    bisectTests,
    prOfSubject,
    probeCommands,
    remainingGates,
    runnerClass,
    sharedWorkerProjects,
    testKey,
    vitestCommands,
    type VitestCommand,
} from "./health-bisect";
import { evidenceFiles, type FailingTest } from "./health-evidence";
import { readRunRepairIssues, type PivotOpts } from "./health-pivot";
import { issuesClosedBy, mergesDeclaredRepair } from "./health-repair-merge";
import { TEST_CHAIN_SCRIPTS, WORKTREE_BOOTSTRAP } from "./health-step";
import { REPAIR_PROOF_MARK } from "./health-verdict-store";

/** One RED of the standing run, as the plan reads it. */
export interface RedRecord {
    sha: string;
    /** The failed step, as the verdict names it (a retry note allowed). */
    step?: string;
    /** The failing files the verdict's description had room for. */
    tests?: readonly string[];
    /** How many more failing files the description had no room for (issue
     *  #7656): with no evidence to read them from, the list is partial. */
    testsMore?: number;
    /** The machine that wrote it (`machineName()`): a GitHub-hosted RED
     *  skipped the corpus tests. */
    machine?: string;
    /** A RED a repair proof run wrote (`Verdict.proof`): its own run passed
     *  nothing the next proof could trust. */
    proof?: "repair";
    /** Its published evidence body, null when none was published — the
     *  files it names win over `tests`, which a 140-character description may
     *  have cut; its projects and FAIL lines say where the files ran. */
    evidence?: string | null;
    /** The evidence could not be read (the pivot down) — not merely absent. */
    evidenceUnreadable?: boolean;
}

export type RepairProofPlan =
    | {
          kind: "proof";
          /** The failing files of every RED of the run, sorted, unique. */
          files: string[];
          /** The same, as the tests a whole-project re-run puts last. */
          tests: FailingTest[];
          /** The shared-worker projects the files ran in (issue #7584):
           *  re-run whole once the files pass alone. */
          projects: string[];
          /** The health step the files failed in (`test`) — what a failing
           *  file run is RED at. */
          step: string;
          /** The steps the RED's run never reached, in the run's order:
           *  `test`'s later suites by name, then the steps after `test`. */
          unreached: string[];
          /** The corpus tests a hosted RED's run skipped ride in `files`. */
          corpus: boolean;
      }
    /** The full gate: the RED's evidence cannot stand in for it. */
    | { kind: "full"; reason: string };

export type ProofPlan = Extract<RepairProofPlan, { kind: "proof" }>;

const short = (sha: string) => sha.slice(0, 8);

/**
 * The repair proof plan, pure, from the RED's record: the failing files, the
 * step it stopped at, and — by the run's step order — the steps it never
 * reached. Over EVERY RED of the standing run (stacked REDs, one per suite,
 * issue #7139): the files are the union, the unreached steps the union too.
 *
 *  - RED at `test` (files in `test:app`) with steps after it → files +
 *    `test:bot`, `test:blade` + those steps;
 *  - RED at the last step, last tier → files only;
 *  - a RED with no files (a step failure), a cut file list with no evidence,
 *    unreadable evidence, a proof-written RED, or a step the run does not
 *    know → `full` (fail closed).
 */
export function repairProofPlan(input: {
    reds: readonly RedRecord[];
    /** The run's offline steps in order
     *  (`splitHealthGates(HEALTH_SCRIPTS).offline`). */
    offline: readonly string[];
    /** The test files that read the locked corpus (`corpusTestFiles`):
     *  skipped by a GitHub-hosted RED's run, so owed by its repair's proof.
     *  Asked only when a RED is hosted. */
    corpusTests: () => readonly string[];
}): RepairProofPlan {
    const { reds, offline } = input;
    if (reds.length === 0) return { kind: "full", reason: "no RED stands" };
    const files = new Set<string>();
    const tests = new Map<string, FailingTest>();
    const projects = new Set<string>();
    const unreached = new Set<string>();
    let step: string | undefined;
    let hosted = false;
    for (const red of reds) {
        const full = (why: string): RepairProofPlan => ({
            kind: "full",
            reason: `the RED @ ${short(red.sha)} ${why} — the full gate`,
        });
        if (red.proof === "repair")
            return full(
                "was written by a repair proof itself: its run passed nothing a second proof could trust"
            );
        const own = baseStepName(red.step);
        if (
            own === undefined ||
            own === WORKTREE_BOOTSTRAP ||
            !offline.includes(own)
        )
            return full(`names no health step (${red.step ?? "none"})`);
        if (red.evidenceUnreadable)
            return full("has evidence this run could not read");
        const evidence = red.evidence ?? null;
        const fromEvidence = evidence ? evidenceFiles(evidence) : [];
        if (fromEvidence.length === 0 && (red.testsMore ?? 0) > 0)
            return full(
                `names ${red.testsMore} more failing file(s) than its description holds, and no evidence names them`
            );
        const named =
            fromEvidence.length > 0 ? fromEvidence : (red.tests ?? []);
        if (named.length === 0)
            return full(
                `at ${own} names no failing test file (a step failure)`
            );
        for (const f of named) files.add(f);
        for (const t of bisectTests(evidence, named)) tests.set(testKey(t), t);
        for (const p of sharedWorkerProjects(evidence, named)) projects.add(p);
        for (const g of remainingGates(
            { kind: "tests", step: own, files: [...named] },
            offline
        ))
            unreached.add(g);
        // The earliest failed step in the run's order names the files' run.
        if (step === undefined || offline.indexOf(own) < offline.indexOf(step))
            step = own;
        if (runnerClass(red.machine) === "github-hosted") hosted = true;
    }
    const corpusFiles = hosted ? input.corpusTests() : [];
    const corpus = corpusFiles.length > 0;
    for (const f of corpusFiles) {
        files.add(f);
        const t = { file: f };
        tests.set(testKey(t), t);
    }
    // The run's order: `test` expanded into its chain.
    const canonical = offline
        .filter((s) => s !== WORKTREE_BOOTSTRAP)
        .flatMap((s) => (s === "test" ? [...TEST_CHAIN_SCRIPTS] : [s]));
    return {
        kind: "proof",
        files: [...files].sort(),
        tests: [...tests.values()],
        projects: [...projects].sort(),
        step: step ?? "test",
        unreached: canonical.filter((s) => unreached.has(s)),
        corpus,
    };
}

/** The GREEN's `step`: `repair: failing files + N unreached steps green`
 *  (`+ corpus tests` after a hosted RED; `failing files green` alone when the
 *  RED's run reached every step). Fits the 140-character description beside
 *  the status and the machine. */
export function repairProofNote(plan: ProofPlan): string {
    const n = plan.unreached.length;
    const parts = [
        "failing files",
        ...(plan.corpus ? ["corpus tests"] : []),
        ...(n > 0 ? [`${n} unreached step${n === 1 ? "" : "s"}`] : []),
    ];
    return `${REPAIR_PROOF_MARK}${parts.join(" + ")} green`;
}

/** One first-parent commit between the standing RED and the tip. */
export interface SinceRedCommit {
    sha: string;
    /** The PR its squash subject names, or null for a direct commit. */
    pr: number | null;
}

/** The PR commits since the RED a repair tip may hold (generated commits —
 *  `derive:sync`, `bot-replay` — not counted): under a RED the queue admits
 *  declared repairs and `--red-ok` landings, so a longer run is not a repair
 *  tip (fail closed). */
export const MAX_PR_COMMITS_SINCE_RED = 20;

/**
 * The commit since the RED that merges a declared repair, pure: the first
 * PR commit (in the caller's order) whose merged PR closes one of the run's
 * repair issues (`mergesDeclaredRepair`). Null when none does, when no repair
 * is declared, or when the run holds more than `MAX_PR_COMMITS_SINCE_RED` PR
 * commits.
 */
export function declaredRepairAmong(input: {
    commits: readonly SinceRedCommit[];
    repairIssues: readonly number[];
    /** The issues the PRs merged by `sha` close (`issuesClosedBy`). */
    closedBy: (sha: string) => readonly number[];
}): SinceRedCommit | null {
    if (input.repairIssues.length === 0) return null;
    const prs = input.commits.filter((c) => c.pr !== null);
    if (prs.length > MAX_PR_COMMITS_SINCE_RED) return null;
    for (const c of prs)
        if (mergesDeclaredRepair(input.repairIssues, input.closedBy(c.sha)))
            return c;
    return null;
}

/** The first-parent commits `red..tip`, newest first, with the PR each
 *  squash subject names; null when `tip` does not descend from `red`. */
export function commitsSinceRed(
    root: string,
    red: string,
    tip: string
): SinceRedCommit[] | null {
    const ancestor = spawnSync(
        "git",
        ["merge-base", "--is-ancestor", red, tip],
        { cwd: root }
    );
    if (ancestor.status === 1) return null;
    if (ancestor.status !== 0)
        throw new Error(`git merge-base --is-ancestor ${red} ${tip} failed`);
    const r = spawnSync(
        "git",
        ["log", "--first-parent", "--format=%H%x09%s", `${red}..${tip}`],
        { cwd: root, encoding: "utf8" }
    );
    if (r.status !== 0)
        throw new Error(`git log ${red}..${tip} failed: ${r.stderr.trim()}`);
    return r.stdout
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => {
            const [sha, ...subject] = l.split("\t");
            return { sha, pr: prOfSubject(subject.join("\t")) };
        });
}

/**
 * Does `tip` merge a declared repair of the standing RED at `red`? Total:
 * any fact that cannot be read answers null — the full gate then runs,
 * which is only slower, never wrong. `deps` are the I/O seams a test injects.
 */
export function tipMergesDeclaredRepair(
    root: string,
    red: string,
    tip: string,
    deps: {
        repairIssues?: () => readonly number[];
        closedBy?: (sha: string) => readonly number[];
        commits?: () => SinceRedCommit[] | null;
        pivot?: PivotOpts;
        /** Where a refusal to read is reported. */
        warn?: (line: string) => void;
    } = {}
): SinceRedCommit | null {
    try {
        const repairIssues = (
            deps.repairIssues ?? (() => readRunRepairIssues(root, deps.pivot))
        )();
        if (repairIssues.length === 0) return null;
        const commits = (
            deps.commits ?? (() => commitsSinceRed(root, red, tip))
        )();
        if (commits === null) return null;
        return declaredRepairAmong({
            commits,
            repairIssues,
            closedBy: deps.closedBy ?? ((sha) => issuesClosedBy(root, sha)),
        });
    } catch (e) {
        deps.warn?.(
            `the repair tip could not be recognised — ${(e as Error).message}`
        );
        return null;
    }
}

/** What became of the files between the RED and the tip: renamed (old path
 *  → new), or deleted. `git diff --name-status -M`. */
export interface FileMoves {
    renamed: ReadonlyMap<string, string>;
    deleted: ReadonlySet<string>;
}

/**
 * The failing files as the tip holds them, pure: a file still there runs at
 * its path, a renamed one at its new path, a deleted one is dropped (a revert
 * of the culprit that added it), and a file missing for no reason the diff
 * explains is `unknown` — the caller's full gate (fail closed).
 */
export function resolveMovedFiles(
    files: readonly string[],
    present: (file: string) => boolean,
    moves: FileMoves
): {
    files: string[];
    deleted: string[];
    unknown: string[];
    /** Each file that still runs → the path it runs at. */
    mapped: Map<string, string>;
} {
    const mapped = new Map<string, string>();
    const deleted: string[] = [];
    const unknown: string[] = [];
    for (const f of files) {
        if (present(f)) mapped.set(f, f);
        else if (moves.renamed.has(f)) mapped.set(f, moves.renamed.get(f)!);
        else if (moves.deleted.has(f)) deleted.push(f);
        else unknown.push(f);
    }
    return {
        files: [...new Set(mapped.values())].sort(),
        deleted,
        unknown,
        mapped,
    };
}

/** `git diff --name-status -M <red> <tip>`, as `resolveMovedFiles` reads it.
 *  Throws when git cannot answer. */
export function fileMovesBetween(
    root: string,
    red: string,
    tip: string
): FileMoves {
    const r = spawnSync(
        "git",
        ["diff", "--name-status", "-M", "-z", red, tip],
        { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    if (r.status !== 0)
        throw new Error(`git diff --name-status ${red} ${tip} failed`);
    const renamed = new Map<string, string>();
    const deleted = new Set<string>();
    const fields = r.stdout.split("\0");
    for (let i = 0; i < fields.length; ) {
        const status = fields[i];
        if (!status) break;
        if (status.startsWith("R") || status.startsWith("C")) {
            if (status.startsWith("R"))
                renamed.set(fields[i + 1], fields[i + 2]);
            i += 3;
        } else {
            if (status === "D") deleted.add(fields[i + 1]);
            i += 2;
        }
    }
    return { renamed, deleted };
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** The test files of `wt` that read the locked verdict corpus
 *  (`readsLockedCorpus`) — the ones a GitHub-hosted run skips. Sorted. A tree
 *  that cannot be listed reads as none, loudly through `warn`. */
export function corpusTestFiles(
    wt: string,
    warn: (line: string) => void = () => {}
): string[] {
    const r = spawnSync("git", ["ls-files", "-z"], {
        cwd: wt,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0) {
        warn(`the tree's test files could not be listed — ${r.stderr.trim()}`);
        return [];
    }
    const out: string[] = [];
    for (const file of r.stdout.split("\0")) {
        if (!TEST_FILE.test(file)) continue;
        try {
            if (readsLockedCorpus(readFileSync(join(wt, file), "utf8")))
                out.push(file);
        } catch {
            // a listed file that cannot be read is not a corpus test
        }
    }
    return out.sort();
}

/** What `runRepairProof` acts through — the proof's I/O at the repair tip. */
export interface RepairProofEffects {
    note(line: string): void;
    /** Runs vitest commands; true when every one passed. */
    runFiles(cmds: readonly VitestCommand[]): boolean | Promise<boolean>;
    /** Runs one health step by name; true when it passed. */
    runStep(step: string): boolean | Promise<boolean>;
}

export type RepairProofOutcome =
    | { outcome: "green" }
    /** `step` is what the RED names — the `HEALTH_SCRIPTS` entry, so the
     *  ladder's fresh run reads it (`remainingGates` knows `test`, not its
     *  tiers); `ran` what actually failed (`test:bot`). */
    | { outcome: "red"; step: string; ran: string };

/** The verdict's step for a failed part: a chain tier is written as its
 *  `HEALTH_SCRIPTS` entry `test` (the files say the tier). */
export function redStepOf(ran: string): string {
    return (TEST_CHAIN_SCRIPTS as readonly string[]).includes(ran)
        ? "test"
        : ran;
}

/**
 * The proof, in the flake path's order (`freshRunSteps`): the failing files
 * as whole files at their own paths (`exactFiles`, the default config's and
 * the blade's apart); when they pass alone and ran in a shared-worker
 * project, that project whole in one worker, the failing files last (issue
 * #7584); then every unreached step by name. The first failure is the RED;
 * only all green is a pass. `files` the tip does not have are the caller's
 * to resolve first (`resolveMovedFiles`).
 */
export async function runRepairProof(
    plan: ProofPlan,
    fx: RepairProofEffects
): Promise<RepairProofOutcome> {
    const red = (ran: string): RepairProofOutcome => ({
        outcome: "red",
        step: redStepOf(ran),
        ran,
    });
    if (plan.files.length > 0) {
        fx.note(
            `repair proof — the RED's failing files${plan.corpus ? " and the corpus tests a hosted run skipped" : ""}: ${plan.files.join(", ")}`
        );
        if (!(await fx.runFiles(repairProofCommands(plan))))
            return red(plan.step);
        if (plan.projects.length > 0) {
            fx.note(
                `the failing files pass alone — re-running ${plan.projects.join(", ")} whole, one worker (issue #7584)`
            );
            if (!(await fx.runFiles(repairProofProjectCommands(plan))))
                return red(plan.step);
        }
    }
    if (plan.unreached.length > 0)
        fx.note(
            `repair proof — the steps the RED's run never reached: ${plan.unreached.join(", ")}`
        );
    for (const step of plan.unreached)
        if (!(await fx.runStep(step))) return red(step);
    return { outcome: "green" };
}

/** The vitest commands the plan's files run as: whole files at their own
 *  paths, the default config's and the blade's apart (`vitestCommands`). */
export function repairProofCommands(
    plan: Pick<ProofPlan, "files">
): VitestCommand[] {
    return vitestCommands(
        plan.files.map((file) => ({ file })),
        { exactFiles: true }
    );
}

/** The whole-project re-runs (one per shared-worker project, the failing
 *  tests last) the plan owes once the files pass alone. */
export function repairProofProjectCommands(
    plan: Pick<ProofPlan, "tests" | "projects">
): VitestCommand[] {
    return probeCommands(plan.tests, {
        kind: "projects",
        projects: [...plan.projects],
    });
}
