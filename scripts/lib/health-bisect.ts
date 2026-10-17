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
 *     the same title gets a comment instead).
 *  3. **Reproduced** → bisect the base's first-parent commits after the last
 *     GREEN: the failing files at each probe, a probe at a commit that does
 *     not have a file yet skips it (a test the culprit added is green before
 *     it). The first red commit is the culprit; its PR rides in the evidence.
 *
 * Node builtins plus `lib/health-verdict-store.ts` (types only).
 */
import type { Verdict } from "./health-verdict-store";

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

/** The vitest commands that re-run `files`: the default config's projects
 *  in one, the blade's specs (`test:blade`'s tier) in another. */
export function vitestCommands(files: readonly string[]): VitestCommand[] {
    const blade = files.filter((f) => BLADE_SPEC.test(f));
    const rest = files.filter((f) => !BLADE_SPEC.test(f));
    const out: VitestCommand[] = [];
    if (rest.length > 0)
        out.push({ args: ["vitest", "run", ...rest], env: {} });
    if (blade.length > 0)
        out.push({
            args: [
                "vitest",
                "run",
                "--config",
                "vitest.blade.config.ts",
                ...blade,
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
}): string {
    const { result } = input;
    if (result.culprit === null)
        return `- **culprit:** not named — ${result.reason ?? "no bisect"}`;
    const pr = input.subject ? prOfSubject(input.subject) : null;
    const who = pr !== null ? `PR #${pr}` : "a direct commit";
    return `- **culprit:** ${who} · \`${result.culprit.slice(0, 12)}\` — bisected from GREEN \`${(input.good ?? "?").slice(0, 12)}\` over ${input.commits} commit(s), ${result.probes.length} probe(s)`;
}
