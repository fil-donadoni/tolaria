/**
 * The RED ladder's decisions (issue #5645, PRD #5620 story 57): what a fresh
 * run of a RED re-runs, what a run that does not reproduce it writes and
 * files, and the bisect that names the culprit PR between the last GREEN and
 * the RED tip. `scripts/health-bisect.ts` is the I/O; everything here is
 * pure.
 *
 *  1. **Fresh run.** The RED's failing test files (its evidence names them;
 *     the commit status may have had no room) re-run once at the RED sha in a
 *     fresh worktree, on a `lane` runner. A RED naming no file re-runs its
 *     failed health step instead. A RED naming neither has nothing to re-run
 *     and stands.
 *  2. **Not reproduced** → the RED closes as GREEN (`flake: …`, last writer
 *     wins on the sha) and each flaky file is filed, once (an open issue of
 *     the same title gets a comment instead) — only when the fresh run ran
 *     on the RED's runner class (`notReproduced`, issue #5858). A hosted RED
 *     that passes on `lane` is environment-dependent: the RED stands, its
 *     evidence names both machines.
 *  3. **Reproduced** → bisect the base's first-parent commits after the last
 *     GREEN: the failing TESTS at each probe, by name (a blade
 *     entry by its label over every shard file, since its shard moves with
 *     the registry's index); a commit that does not have a file or an entry
 *     yet is green for it (a test the culprit added is green before it). The
 *     first red commit is the culprit, then the same for the tests still
 *     red-unexplained after it; each PR rides in the evidence. A probe
 *     runs in the queue draft's role (`PROBE_BOOTSTRAP`): derived state is
 *     regenerated in the probed tree, so a PR commit reads the RED its own
 *     sources cause before the base's `derive:sync` writes it (issue #7417).
 *     A first red probe on a base-maintenance commit anyway is blamed on the
 *     one PR commit before it, or on none (`attributeMaintenance`).
 *
 * Node builtins plus `lib/health-verdict-store.ts`, `lib/health-evidence.ts`,
 * the leaves `lib/derive-sync.ts` and `lib/derived-state.ts`.
 */
import { isBaseMaintenanceSubject } from "./derive-sync";
import { TREE_ROLE_ENV } from "./derived-state";
import { evidenceTests, failLines, type FailingTest } from "./health-evidence";
import {
    HOSTED_MACHINE_PREFIX,
    type Verdict,
    type WriteOutcome,
} from "./health-verdict-store";

/**
 * The RED the ladder climbs at `sha` (issue #6986): the store's verdict, or
 * — when the store holds none for it — the RED a scheduled run held back
 * for this ladder (`defersRed`). `held` says the store never took it: the
 * ladder writes it there only once the fresh run did not clear it, so a RED
 * that clears is never written at all.
 */
export function ladderRed(
    stored: Verdict | null,
    held: Verdict | null,
    sha: string
): { verdict: Verdict | null; held: boolean } {
    if (stored !== null || held?.sha !== sha || held.status !== "red")
        return { verdict: stored, held: false };
    return { verdict: held, held: true };
}

/** What `settleHeldRed` acts through — the ladder's I/O, injected. */
export interface HeldRedEffects {
    note(line: string): void;
    /** Writes the held RED on the verdict store. */
    writeRed(v: Verdict): WriteOutcome;
    /** Drops the held RED from disk. */
    clear(): void;
}

/**
 * The held RED once the ladder has its exit code (`code`, 0 = no RED
 * stands): written to the store when it stands, dropped either way — the
 * GREEN that cleared it is the run's one write. A write that throws or is
 * refused leaves it on disk for the next health run (`flushDeferredRed`). Not held, or a
 * dry run: nothing. Returns `code`.
 */
export function settleHeldRed(
    input: {
        held: boolean;
        verdict: Verdict | null;
        code: number;
        dryRun: boolean;
    },
    fx: HeldRedEffects
): number {
    const { held, verdict, code } = input;
    if (!held || input.dryRun) return code;
    if (code !== 0 && verdict !== null) {
        try {
            const out = fx.writeRed(verdict);
            if (!out.written) {
                // Kept on disk: the next health run's flush re-judges it.
                fx.note(`the held RED not written — ${out.reason}`);
                return code;
            }
            fx.note("the held RED stands — written to the store");
        } catch (e) {
            fx.note(
                `the held RED could not be written — ${(e as Error).message}`
            );
            return code;
        }
    }
    fx.clear();
    return code;
}

/** What a fresh run of one RED re-runs. */
export type FreshRun =
    | { kind: "tests"; step: string; files: string[] }
    | { kind: "step"; step: string }
    | { kind: "none"; reason: string };

/** The health step a verdict's `step` names, stripped of a retry note
 *  (`test (retry: bot-node, timeout)` → `test`). */
export function baseStepName(step: string | undefined): string | undefined {
    const name = step?.split(" (")[0]?.trim();
    return name === "" ? undefined : name;
}

/**
 * The fresh run a RED owes. `evidenceFiles` are the files its published
 * evidence names — preferred over the verdict's own `tests`, which a
 * 140-character description may have cut. `steps` are the health steps a
 * run may re-run by name (`HEALTH_SCRIPTS`).
 */
export function freshRunPlan(
    verdict: Pick<Verdict, "status" | "step" | "tests"> | null,
    evidenceFiles: readonly string[],
    steps: readonly string[]
): FreshRun {
    if (verdict?.status !== "red")
        return {
            kind: "none",
            reason: `no RED to re-run (${verdict ? verdict.status.toUpperCase() : "no verdict"})`,
        };
    const step = baseStepName(verdict.step) ?? "unknown";
    const files =
        evidenceFiles.length > 0
            ? [...evidenceFiles]
            : [...(verdict.tests ?? [])];
    if (files.length > 0) return { kind: "tests", step, files };
    if (steps.includes(step)) return { kind: "step", step };
    return {
        kind: "none",
        reason: `the RED names no test file and no health step (${verdict.step ?? "no step"}) — nothing to re-run; it stands`,
    };
}

/** The failing tests a bisect probes (issue #7339): the ones the RED's
 *  evidence names, else `files` (the fresh run's), each as a whole file. */
export function bisectTests(
    evidence: string | null,
    files: readonly string[]
): FailingTest[] {
    const tests = evidence ? evidenceTests(evidence) : [];
    return tests.length > 0 ? tests : files.map((file) => ({ file }));
}

/**
 * How a bisect probe's worktree is made ready (issue #7417): bootstrapped,
 * then its derived state regenerated as the queue's draft does
 * (`check:lane --regenerate-derived`), every step and test run in the
 * `draft` role. Under ADR 0157 a PR commit does not carry its catalogue or
 * header — the base's `derive:sync` writes them after the merge — so probed
 * as committed, a PR whose cards break a test reads GREEN and the derive
 * commit after it reads RED.
 */
export const PROBE_BOOTSTRAP: {
    readonly steps: readonly (readonly string[])[];
    readonly env: Readonly<Record<string, string>>;
} = {
    steps: [
        ["run", "worktree:init"],
        ["run", "derive:regenerate"],
    ],
    env: { [TREE_ROLE_ENV]: "draft" },
};

/** One vitest invocation of a fresh run or a bisect probe, and the failing
 *  tests its outcome judges. */
export interface VitestCommand {
    args: string[];
    env: Record<string, string>;
    tests: FailingTest[];
}

/** The blade's specs run under their own config (`vitest.blade.config.ts`). */
const BLADE_SPEC = /^convex\/gre\/ai\/blade\/__tests__\/.+\.spec\.ts$/;

/**
 * A sharded spec file (`blade.shard-2.spec.ts`, `robustness.shard-0…`): its
 * entries go to shards by their index in the tier's list (`bladeShardOf`), so
 * one added or removed entry moves every later one to another file (issue
 * #7339). Group 1 is the prefix every shard file of the family shares.
 */
const SHARD_SPEC = /^(.+\.shard-)\d+\.spec\.ts$/;

/** The `shard N/M` a sharded spec's describe names. */
const SHARD_ORDINAL = /\bshard \d+\/\d+/g;

/**
 * Where a failing test lives at any commit: its file, or — in a sharded
 * family — every shard file of it (a vitest file filter is a substring), and
 * its name with the shard ordinal wildcarded. Two failing tests with the same
 * key are the same entry.
 */
export function testKey(t: FailingTest): string {
    const shard = SHARD_SPEC.exec(t.file);
    const file = shard ? shard[1] : t.file;
    const name = (t.name ?? "").replace(SHARD_ORDINAL, "shard */*");
    return `${file}\n${name}`;
}

/** The file filter that finds `t` at any commit: its shard family's prefix,
 *  else its own path. */
export function testFileFilter(t: FailingTest): string {
    return SHARD_SPEC.exec(t.file)?.[1] ?? t.file;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The `-t` pattern that selects exactly the named `tests`: vitest matches it
 * against the full name, its suites and the test's own joined by spaces, so
 * each name is anchored at both ends (a space or the start before it), and a sharded entry's `shard N/M` matches
 * any shard — the entry is found by its label wherever the index puts it.
 */
export function testNamePattern(tests: readonly FailingTest[]): string {
    return tests
        .map(
            (t) =>
                `(?:(?:^| )${escapeRegExp((t.name ?? "").split(" > ").join(" ")).replace(SHARD_ORDINAL, "shard \\d+/\\d+")}$)`
        )
        .join("|");
}

/**
 * The vitest commands that re-run `tests`: the default config's projects and
 * the blade's specs (`test:blade`'s tier) apart, whole files and named tests
 * apart (a `-t` would filter the whole files too). A test runs over its
 * file — or, sharded, over its whole family, never the one shard file the
 * RED saw it in — and a named one by name (`testNamePattern`). `exactFiles`
 * (the fresh run, at the RED's own sha) runs a whole file by its own path.
 */
export function vitestCommands(
    tests: readonly FailingTest[],
    opts: { exactFiles?: boolean } = {}
): VitestCommand[] {
    const out: VitestCommand[] = [];
    for (const blade of [false, true]) {
        const config = blade
            ? ["--config", "vitest.blade.config.ts"]
            : ([] as string[]);
        const env: Record<string, string> = blade ? { BLADE_TIER: "must" } : {};
        const mine = tests.filter((t) => BLADE_SPEC.test(t.file) === blade);
        const files = mine.filter((t) => t.name === undefined);
        const named = mine.filter((t) => t.name !== undefined);
        if (files.length > 0)
            out.push({
                args: [
                    "vitest",
                    "run",
                    ...config,
                    ...new Set(
                        files.map((t) =>
                            opts.exactFiles ? t.file : testFileFilter(t)
                        )
                    ),
                ],
                env,
                tests: files,
            });
        if (named.length > 0)
            out.push({
                args: [
                    "vitest",
                    "run",
                    ...config,
                    ...new Set(named.map(testFileFilter)),
                    "-t",
                    testNamePattern(named),
                ],
                env,
                tests: named,
            });
    }
    return out;
}

/**
 * The tests of `cmd` its run failed. An exit 0 fails none. A failed run
 * fails the tests its FAIL lines name (a named test by its key, a whole file
 * — a sharded family's — by any line in it); a failed run with no FAIL line
 * at all — a crash, a load error — fails them all: no line to clear one.
 * A FAIL line of another test the filter caught fails none of them.
 */
export function failedTests(
    cmd: Pick<VitestCommand, "tests">,
    run: { status: number | null; output: string }
): FailingTest[] {
    if (run.status === 0) return [];
    const lines = failLines(run.output);
    const keys = new Set(
        lines.filter((l) => l.name !== undefined).map((l) => testKey(l))
    );
    const hit = cmd.tests.filter((t) =>
        t.name === undefined
            ? lines.some((l) => testFileFilter(l) === testFileFilter(t))
            : keys.has(testKey(t))
    );
    return lines.length > 0 ? hit : [...cmd.tests];
}

/** The GREEN that closes a RED its fresh run did not reproduce. */
export function flakeVerdict(input: {
    sha: string;
    plan: Exclude<FreshRun, { kind: "none" }>;
    machine: string;
    at: string;
    log?: string;
}): Verdict {
    return {
        sha: input.sha,
        status: "green",
        step: `flake: ${input.plan.step} passed on a fresh run`,
        machine: input.machine,
        at: input.at,
        ...(input.log ? { log: input.log } : {}),
    };
}

/** The runner class a verdict's `machine` names: `machineName()` marks a
 *  GitHub-hosted runner's; every other name is a self-hosted machine's. */
export function runnerClass(
    machine: string | undefined
): "github-hosted" | "self-hosted" {
    return machine?.startsWith(HOSTED_MACHINE_PREFIX)
        ? "github-hosted"
        : "self-hosted";
}

/** What a fresh run that passed proves (issue #5858): a flake only on the
 *  RED's own runner class. On another class the same sha passing says the
 *  failure needs the RED's environment (a missing file, a secret, a tool
 *  version) — deterministic there, so the RED stands and its evidence names
 *  both machines. */
export type NotReproduced =
    | { kind: "flake" }
    | { kind: "environment"; line: string };

export function notReproduced(input: {
    redMachine: string | undefined;
    freshMachine: string;
}): NotReproduced {
    const red = runnerClass(input.redMachine);
    const fresh = runnerClass(input.freshMachine);
    if (red === fresh) return { kind: "flake" };
    return {
        kind: "environment",
        line: `${LADDER_MARK}not bisected — environment-dependent, not a flake: the RED ran on \`${input.redMachine ?? "-"}\` (${red}), the fresh run passed at the same sha on \`${input.freshMachine}\` (${fresh})`,
    };
}

/** What `settleFreshPass` acts through — the ladder's I/O, injected. */
export interface FreshPassEffects {
    note(line: string): void;
    /** Writes the GREEN on the verdict store. */
    writeGreen(v: Verdict): WriteOutcome;
    /** Files (or comments on) the flake issue of each subject. */
    fileFlake(): void;
    /** Adds one line to the RED's published evidence. */
    publish(line: string): void;
}

/**
 * A fresh run that passed the RED's failure, settled: a flake closes the RED
 * as GREEN and is filed; an environment-dependent pass (`notReproduced`)
 * leaves the RED standing, its evidence naming both machines. The exit code
 * the ladder returns: 0 when no RED stands.
 */
export function settleFreshPass(
    input: {
        red: Pick<Verdict, "sha" | "machine"> | null;
        sha: string;
        plan: Exclude<FreshRun, { kind: "none" }>;
        freshMachine: string;
        at: string;
        log?: string;
        dryRun: boolean;
    },
    fx: FreshPassEffects
): 0 | 1 {
    const passed = notReproduced({
        redMachine: input.red?.machine,
        freshMachine: input.freshMachine,
    });
    if (passed.kind === "environment") {
        fx.note(
            "not reproduced on another runner class — the RED stands, environment-dependent"
        );
        fx.note(passed.line);
        fx.publish(passed.line);
        return 1;
    }
    const v = flakeVerdict({
        sha: input.sha,
        plan: input.plan,
        machine: input.freshMachine,
        at: input.at,
        log: input.log,
    });
    if (input.dryRun) fx.note("(dry run) would close the RED as GREEN");
    else {
        const out = fx.writeGreen(v);
        fx.note(
            out.written
                ? "not reproduced — the RED closed as GREEN"
                : `GREEN not written — ${out.reason}`
        );
        if (!out.written) return 1;
    }
    fx.fileFlake();
    return 0;
}

/** What a flaky-test issue is about: each file, or the step itself. */
export function flakySubjects(
    plan: Exclude<FreshRun, { kind: "none" }>
): string[] {
    return plan.kind === "tests" ? [...plan.files] : [plan.step];
}

/** The title an issue about one flaky subject carries — the dedup key. */
export function flakyIssueTitle(
    plan: Exclude<FreshRun, { kind: "none" }>,
    subject: string
): string {
    return plan.kind === "tests"
        ? `Flaky test: ${subject}`
        : `Flaky health step: ${subject}`;
}

/** The body of a filed flaky-test issue. */
export function flakyIssueBody(input: {
    subject: string;
    sha: string;
    step: string;
    evidence?: string;
    runUrl?: string;
}): string {
    return [
        "## What happened",
        "",
        `Batch health went RED at \`${input.sha.slice(0, 12)}\` (step \`${input.step}\`) on \`${input.subject}\`. A fresh run of it at the same sha passed, so the RED closed as GREEN (issue #5645's flake check) and this issue records the flake.`,
        "",
        input.evidence
            ? `- **evidence:** ${input.evidence}`
            : "- **evidence:** none published",
        input.runUrl
            ? `- **run:** ${input.runUrl}`
            : "- **run:** not run in a job",
        "",
        "## What to do",
        "",
        "Find why it fails some of the time (order, timing, shared state, a timeout near its budget — `health:status` prints the headroom) and make it deterministic. Never silence it.",
        "",
        "## Band",
        "",
        "None set — filed by the health workflow, for the owner to triage.",
        "",
    ].join("\n");
}

/** The first ancestor (newest first) the store holds a GREEN for, or null. */
export function lastGreenOf(
    ancestors: readonly string[],
    read: (sha: string) => Verdict | null
): string | null {
    for (const sha of ancestors) if (read(sha)?.status === "green") return sha;
    return null;
}

export type ProbeOutcome = "red" | "green" | "infra";

export interface BisectResult {
    /** The first red commit, or null with `reason`. */
    culprit: string | null;
    probes: { sha: string; outcome: ProbeOutcome }[];
    reason?: string;
}

/**
 * The first red commit of `commits` (OLDEST first: every commit after the
 * last GREEN, the RED tip last). The tip is red — the fresh run just
 * reproduced it — and the GREEN before the range is green, so a binary
 * search finds the boundary in ⌈log₂ n⌉ probes. A probe that could not run
 * (`infra`) ends the search with no culprit: a guess is worse than none.
 */
export function bisectFirstRed(
    commits: readonly string[],
    probe: (sha: string) => ProbeOutcome
): BisectResult {
    if (commits.length === 0)
        return {
            culprit: null,
            probes: [],
            reason: "no commit between the last GREEN and the RED",
        };
    const probes: BisectResult["probes"] = [];
    let lo = 0;
    let hi = commits.length - 1;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const outcome = probe(commits[mid]);
        probes.push({ sha: commits[mid], outcome });
        if (outcome === "infra")
            return {
                culprit: null,
                probes,
                reason: `the probe at ${commits[mid].slice(0, 8)} could not run`,
            };
        if (outcome === "red") hi = mid;
        else lo = mid + 1;
    }
    return { culprit: commits[lo], probes };
}

/** What one probe of the failing tests at a commit found: the tests that
 *  failed there, or `infra` — it could not run. */
export type TestProbe = readonly FailingTest[] | "infra";

/** The commit that broke some of the RED's failing tests. */
export interface CulpritFinding {
    culprit: string;
    tests: FailingTest[];
    /** The base-maintenance commit the first red probe landed on, when the
     *  culprit is named in its stead (`attributeMaintenance`). */
    maintenance?: string;
}

export interface CulpritReport {
    /** Oldest first: the order the culprits went in. */
    found: CulpritFinding[];
    /** The failing tests no culprit explains, and why. */
    unexplained: { tests: FailingTest[]; reason: string } | null;
    probes: BisectResult["probes"];
}

/**
 * Every culprit of the RED's failing `tests` over `commits` (as
 * `bisectFirstRed`'s; issue #7339): the first commit any of them is red at,
 * the tests red there, then the same again for the rest over the commits
 * after it — a RED of two failures two PRs caused names both. A search
 * that lands on the tip probes it too: a name that selects nothing (a
 * suite's hook, a describe the probe's environment prints otherwise) is
 * green at every commit, and the tip is no culprit for a test that does not
 * fail there by name. A probe that could not run leaves the rest
 * unexplained.
 */
export function bisectCulprits(
    commits: readonly string[],
    tests: readonly FailingTest[],
    probe: (sha: string, tests: readonly FailingTest[]) => TestProbe
): CulpritReport {
    const found: CulpritFinding[] = [];
    const probes: BisectResult["probes"] = [];
    let rest = [...tests];
    let from = 0;
    while (rest.length > 0) {
        const pending = rest;
        const redAt = new Map<string, Set<string>>();
        const r = bisectFirstRed(commits.slice(from), (sha) => {
            const out = probe(sha, pending);
            if (out === "infra") return "infra";
            const red = new Set(out.map(testKey));
            redAt.set(sha, red);
            return pending.some((t) => red.has(testKey(t))) ? "red" : "green";
        });
        probes.push(...r.probes);
        if (r.culprit === null)
            return {
                found,
                unexplained: {
                    tests: rest,
                    reason: r.reason ?? "no bisect",
                },
                probes,
            };
        let red = redAt.get(r.culprit);
        if (red === undefined) {
            const out = probe(r.culprit, pending);
            probes.push({
                sha: r.culprit,
                outcome:
                    out === "infra"
                        ? "infra"
                        : out.length > 0
                          ? "red"
                          : "green",
            });
            if (out === "infra")
                return {
                    found,
                    unexplained: {
                        tests: rest,
                        reason: `the probe at ${r.culprit.slice(0, 8)} could not run`,
                    },
                    probes,
                };
            red = new Set(out.map(testKey));
        }
        const at = red;
        const explained = pending.filter((t) => at.has(testKey(t)));
        if (explained.length > 0)
            found.push({ culprit: r.culprit, tests: explained });
        rest = pending.filter((t) => !explained.includes(t));
        from = commits.indexOf(r.culprit, from) + 1;
        if (rest.length > 0 && from === commits.length)
            return {
                found,
                unexplained: {
                    tests: rest,
                    reason: `no probe reproduced it by name, the RED tip \`${r.culprit.slice(0, 12)}\` included`,
                },
                probes,
            };
    }
    return { found, unexplained: null, probes };
}

/**
 * The report with every culprit that is a base-maintenance commit
 * (`isBaseMaintenanceSubject`: `derive:sync`, `bot-replay`) replaced by the
 * PR commit of `commits` (oldest first, the bisected range) since the
 * previous maintenance commit (issue #7417). Such a commit writes derived
 * state only and its revert can never land (`check:derived-in-diff`): the
 * RED it first shows is a PR commit's derived effect. Its tests are
 * unexplained, never blamed on it, when no PR commit precedes it in the
 * range — or when several do: each probed green, so nothing tells them
 * apart, and the ladder reverts the first culprit line (`parseCulprit`) —
 * a guess is worse than none. The reason lists the candidates.
 */
export function attributeMaintenance(
    report: CulpritReport,
    commits: readonly string[],
    subjectOf: (sha: string) => string | undefined
): CulpritReport {
    const maintenance = (sha: string) =>
        isBaseMaintenanceSubject(subjectOf(sha) ?? "");
    const found: CulpritFinding[] = [];
    let unexplained = report.unexplained;
    for (const f of report.found) {
        if (!maintenance(f.culprit)) {
            found.push(f);
            continue;
        }
        const at = commits.indexOf(f.culprit);
        let from = at;
        while (from > 0 && !maintenance(commits[from - 1])) from--;
        const prs = at === -1 ? [] : commits.slice(from, at);
        if (prs.length !== 1) {
            const via = `the first red probe was base maintenance \`${f.culprit.slice(0, 12)}\` (\`${subjectOf(f.culprit) ?? ""}\`)`;
            const reason =
                prs.length === 0
                    ? `${via}, with no PR commit before it in the bisected range`
                    : `${via}; ${prs.length} PR commits precede it since the previous maintenance commit, none named: ${prs.map((sha) => `\`${sha.slice(0, 12)}\` (${subjectOf(sha) ?? ""})`).join(", ")}`;
            unexplained = {
                tests: [...(unexplained?.tests ?? []), ...f.tests],
                reason: unexplained
                    ? `${unexplained.reason}; ${reason}`
                    : reason,
            };
            continue;
        }
        const named = found.find((g) => g.culprit === prs[0]);
        if (named) named.tests = [...named.tests, ...f.tests];
        else
            found.push({
                culprit: prs[0],
                tests: f.tests,
                maintenance: f.culprit,
            });
    }
    return { found, unexplained, probes: report.probes };
}

/** A failing test as an evidence line names it: its own name (a blade
 *  entry's label), else its file. */
function testLabel(t: FailingTest): string {
    return t.name?.split(" > ").at(-1) ?? t.file;
}

function testList(tests: readonly FailingTest[]): string {
    const shown = tests.slice(0, 3).map((t) => `\`${testLabel(t)}\``);
    return tests.length > 3
        ? `${shown.join(", ")} and ${tests.length - 3} more`
        : shown.join(", ");
}

/**
 * The evidence bullets that name the bisect's outcome, the oldest culprit
 * first (the line `parseCulprit` reads). A culprit explaining every failing
 * test is `culpritLine`'s one line, as before; otherwise each line names the
 * tests it explains, and a last one those no culprit explains — never
 * dropped silently.
 */
export function culpritLines(input: {
    report: CulpritReport;
    total: number;
    good: string | null;
    commits: number;
    subjectOf: (sha: string) => string | undefined;
}): string[] {
    const { report } = input;
    const lineOf = (
        culprit: string | null,
        reason?: string,
        maintenance?: string
    ): string =>
        culpritLine({
            result: { culprit, probes: report.probes, reason },
            good: input.good,
            commits: input.commits,
            subject: culprit ? input.subjectOf(culprit) : undefined,
            maintenance:
                maintenance === undefined
                    ? undefined
                    : {
                          sha: maintenance,
                          subject: input.subjectOf(maintenance) ?? "",
                      },
        });
    if (report.found.length === 0)
        return [lineOf(null, report.unexplained?.reason)];
    if (report.found.length === 1 && report.unexplained === null)
        return [
            lineOf(
                report.found[0].culprit,
                undefined,
                report.found[0].maintenance
            ),
        ];
    const lines = report.found.map(
        (f) =>
            `${lineOf(f.culprit, undefined, f.maintenance)} · explains ${f.tests.length} of ${input.total} failing test(s): ${testList(f.tests)}`
    );
    if (report.unexplained !== null)
        lines.push(
            `${LADDER_MARK}not named for ${report.unexplained.tests.length} of ${input.total} failing test(s) (${testList(report.unexplained.tests)}) — ${report.unexplained.reason}`
        );
    return lines;
}

/** The PR a squash-merged commit's subject names (`… (#1234)`), or null. */
export function prOfSubject(subject: string): number | null {
    const m = /\(#(\d+)\)\s*$/.exec(subject);
    return m ? Number(m[1]) : null;
}

/** The evidence bullet that names the bisect's outcome. */
export function culpritLine(input: {
    result: BisectResult;
    good: string | null;
    commits: number;
    subject?: string;
    /** The base-maintenance commit the culprit is named in place of. */
    maintenance?: { sha: string; subject: string };
}): string {
    const { result } = input;
    if (result.culprit === null)
        return `- **culprit:** not named — ${result.reason ?? "no bisect"}`;
    const pr = input.subject ? prOfSubject(input.subject) : null;
    const who = pr !== null ? `PR #${pr}` : "a direct commit";
    const via = input.maintenance
        ? ` · the first red probe was base maintenance \`${input.maintenance.sha.slice(0, 12)}\` (\`${input.maintenance.subject}\`), which writes only derived state — named the one PR commit since the previous maintenance commit`
        : "";
    return `- **culprit:** ${who} · \`${result.culprit.slice(0, 12)}\` — bisected from GREEN \`${(input.good ?? "?").slice(0, 12)}\` over ${input.commits} commit(s), ${result.probes.length} probe(s)${via}`;
}

/** `bun run test`'s chain, in order (`lib/health-retry.ts`). */
const TEST_CHAIN = ["test:app", "test:bot", "test:blade"] as const;

/** The chain tier a test file runs in: the blade's specs, the Bot's suite,
 *  or the app's. */
function tierOf(file: string): number {
    if (BLADE_SPEC.test(file)) return 2;
    if (/\.bot\.test\.[cm]?[jt]sx?$/.test(file)) return 1;
    return 0;
}

/**
 * The gates the RED's run never reached — health stops at its first failed
 * step, and `test`'s chain at its first red tier. A fresh run that passes the
 * failing files proves only them: the RED may close as GREEN only once these
 * pass too. `offline` is the run's offline steps in order (`worktree:init`,
 * the probe's own bootstrap, is left out).
 */
export function remainingGates(
    plan: Exclude<FreshRun, { kind: "none" }>,
    offline: readonly string[]
): string[] {
    const steps = offline.filter((s) => s !== "worktree:init");
    const at = steps.indexOf(plan.step);
    const after = at === -1 ? [] : steps.slice(at + 1);
    if (plan.kind !== "tests" || plan.step !== "test") return after;
    const tier = Math.max(...plan.files.map(tierOf));
    return [...TEST_CHAIN.slice(tier + 1), ...after];
}

/** The evidence line every confirmed RED gets, culprit or not — the mark
 *  that its ladder ran, so a later run does not climb it twice (one email). */
export const LADDER_MARK = "- **culprit:** ";

/** Whether a published evidence body says its ladder already ran. */
export function laddered(body: string | null): boolean {
    return (body ?? "").split("\n").some((l) => l.startsWith(LADDER_MARK));
}

/** The worktree directory names a probe makes, and the pid that made it. */
export function bisectWorktreePid(path: string): number | null {
    const m = /(?:^|\/)tolaria-bisect-(\d+)-\d+$/.exec(path);
    return m ? Number(m[1]) : null;
}
