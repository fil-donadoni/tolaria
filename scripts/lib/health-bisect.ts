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
 *     GREEN: the failing files at each probe, a probe at a commit that does
 *     not have a file yet skips it (a test the culprit added is green before
 *     it). The first red commit is the culprit; its PR rides in the evidence.
 *
 * Node builtins plus `lib/health-verdict-store.ts`.
 */
import type { ProbeTarget } from "./health-evidence";
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

/** One vitest invocation of a fresh run or a bisect probe. */
export interface VitestCommand {
    args: string[];
    env: Record<string, string>;
}

/** The blade's specs run under their own config (`vitest.blade.config.ts`). */
const BLADE_SPEC = /^convex\/gre\/ai\/blade\/__tests__\/.+\.spec\.ts$/;

/** The describe a blade shard wraps its entries in (`bladeShardRunner.helper`):
 *  `blade suite — must tier — shard 1/4 > <label>`. */
const BLADE_SHARD_PREFIX = /^blade suite — .*? shard \d+\/\d+ > /;

/** The part of a test name that survives a commit: a blade entry's label
 *  without its shard describe, else the name as printed. */
function stableName(t: ProbeTarget): string | undefined {
    if (t.test === undefined) return undefined;
    return BLADE_SPEC.test(t.file)
        ? t.test.replace(BLADE_SHARD_PREFIX, "")
        : t.test;
}

/** Whether two targets are the same failing test. A blade entry moves between
 *  shard files whenever the tier list changes (index modulo shard count), so
 *  it is the label alone; any other test is its file and name. */
export function sameTarget(a: ProbeTarget, b: ProbeTarget): boolean {
    const [x, y] = [stableName(a), stableName(b)];
    if (x === undefined || y === undefined) return a.file === b.file;
    if (BLADE_SPEC.test(a.file) && BLADE_SPEC.test(b.file)) return x === y;
    return a.file === b.file && x === y;
}

/** A `-t` pattern matching exactly the named tests: vitest joins a test's
 *  describes with a space, so `a > b > c` is `a b c`, end-anchored. */
function namePattern(names: readonly string[]): string {
    const alt = names.map((n) =>
        n
            .split(" > ")
            .join(" ")
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    return `(?:^| )(?:${alt.join("|")})$`;
}

/** The vitest commands that re-run `targets`: the default config's projects,
 *  the blade's specs (`test:blade`'s tier) under their own. A target with a
 *  test name selects that test (`-t`), never its file's whole content; a
 *  blade entry pins no shard file, since the shard it falls in changes with
 *  the tier list. `--passWithNoTests`: a test the commit does not have yet is
 *  green, like a missing file. */
export function vitestCommands(
    targets: readonly ProbeTarget[]
): VitestCommand[] {
    const out: VitestCommand[] = [];
    const wholeFiles = [
        ...new Set(
            targets
                .filter((t) => t.test === undefined && !BLADE_SPEC.test(t.file))
                .map((t) => t.file)
        ),
    ];
    if (wholeFiles.length > 0)
        out.push({ args: ["vitest", "run", ...wholeFiles], env: {} });
    const byFile = new Map<string, string[]>();
    for (const t of targets)
        if (t.test !== undefined && !BLADE_SPEC.test(t.file))
            byFile.set(t.file, [...(byFile.get(t.file) ?? []), t.test]);
    for (const [file, names] of byFile)
        out.push({
            args: [
                "vitest",
                "run",
                "--passWithNoTests",
                file,
                "-t",
                namePattern(names),
            ],
            env: {},
        });
    const blade = { config: ["--config", "vitest.blade.config.ts"] };
    const bladeFiles = [
        ...new Set(
            targets
                .filter((t) => t.test === undefined && BLADE_SPEC.test(t.file))
                .map((t) => t.file)
        ),
    ];
    if (bladeFiles.length > 0)
        out.push({
            args: ["vitest", "run", ...blade.config, ...bladeFiles],
            env: { BLADE_TIER: "must" },
        });
    const bladeNames = targets
        .filter((t) => t.test !== undefined && BLADE_SPEC.test(t.file))
        .map((t) => stableName(t) as string);
    if (bladeNames.length > 0)
        out.push({
            args: [
                "vitest",
                "run",
                ...blade.config,
                "--passWithNoTests",
                "-t",
                namePattern(bladeNames),
            ],
            env: { BLADE_TIER: "must" },
        });
    return out;
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

/** One culprit of a failing set, and the tests it explains. */
export interface Culprit {
    result: BisectResult;
    tests: ProbeTarget[];
    /** The commit's subject, to read its PR. */
    subject?: string;
}

/**
 * The culprit of EACH failing test, not of the set (issue #7339): two
 * failures from two commits are two culprits. `probe` runs `targets` at a
 * commit (green when it has none yet); `failingAt` names which of `targets`
 * fail at a commit. The set is bisected, the first red commit's own failures
 * are its, and the tests still green there are bisected again over the
 * commits after it. A round that names no culprit ends the search with the
 * rest unexplained — the last entry then carries `culprit: null`.
 */
export function bisectCulprits(
    commits: readonly string[],
    targets: readonly ProbeTarget[],
    probe: (sha: string, targets: readonly ProbeTarget[]) => ProbeOutcome,
    failingAt: (sha: string, targets: readonly ProbeTarget[]) => ProbeTarget[],
    subjectOf: (sha: string) => string | undefined = () => undefined
): Culprit[] {
    const out: Culprit[] = [];
    let remaining = [...targets];
    let range = commits;
    while (remaining.length > 0) {
        const result = bisectFirstRed(range, (sha) => probe(sha, remaining));
        if (result.culprit === null) {
            out.push({ result, tests: remaining });
            break;
        }
        const at = result.culprit;
        const red = failingAt(at, remaining);
        const explained = remaining.filter((t) =>
            red.some((r) => sameTarget(r, t))
        );
        // Nothing parsed at the culprit: it is the first red of the set, so
        // it takes the whole set rather than loop on tests it cannot place.
        const mine = explained.length > 0 ? explained : remaining;
        out.push({ result, tests: mine, subject: subjectOf(at) });
        remaining = remaining.filter((t) => !mine.includes(t));
        range = range.slice(range.indexOf(at) + 1);
        if (range.length === 0 && remaining.length > 0) {
            out.push({
                result: {
                    culprit: null,
                    probes: [],
                    reason: "no commit left after the culprit",
                },
                tests: remaining,
            });
            break;
        }
    }
    return out;
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
    /** How many failing tests this culprit explains, of how many in all;
     *  said only when it is not all of them (issue #7339). */
    explains?: { tests: number; of: number };
}): string {
    const { result } = input;
    const part =
        input.explains && input.explains.tests < input.explains.of
            ? ` · explains ${input.explains.tests} of ${input.explains.of} failing test(s)`
            : input.explains && result.culprit === null
              ? ` for ${input.explains.tests} failing test(s)`
              : "";
    if (result.culprit === null)
        return `- **culprit:** not named${part} — ${result.reason ?? "no bisect"}`;
    const pr = input.subject ? prOfSubject(input.subject) : null;
    const who = pr !== null ? `PR #${pr}` : "a direct commit";
    return `- **culprit:** ${who} · \`${result.culprit.slice(0, 12)}\` — bisected from GREEN \`${(input.good ?? "?").slice(0, 12)}\` over ${input.commits} commit(s), ${result.probes.length} probe(s)${part}`;
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
