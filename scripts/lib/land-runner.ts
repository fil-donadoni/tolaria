/**
 * The land-runner's decisions (issue #5469, ADR 0154 topology B'): which
 * `ready-to-land` PR lands next, what a `land` exit means for its labels, and
 * what the failure comment says. Pure — `scripts/land-runner.ts` is the I/O.
 *
 * Landing is asynchronous: a session ends at push + `bun run land:ready
 * <PR#>`, which labels the PR `ready-to-land` and writes the claim's `pr-open`
 * row; ONE runner on the MacBook — the single merger, on the fast CPU —
 * serializes rebase → lane → merge → scenario seed by running the existing
 * `land` pipeline in the PR's worktree. A red `land` relabels the PR
 * `land-failed` with the lane excerpt as a comment, and `queue:plan` hands it
 * to the next pass as a REPAIR pick, ahead of new issues.
 */
import { FAILED_LABEL, READY_LABEL, SHADOW_LABEL } from "./land-labels";
import { healthAdmission } from "./pr-gate";

export { FAILED_LABEL, READY_LABEL, SHADOW_LABEL };
/** Set on the `land` the runner spawns — the one hatch `deny-guard.sh` § 8
 *  admits for a `land` invocation. */
export const RUNNER_ENV = "TOLARIA_LAND_RUNNER";
/** `land`'s "the machine stayed saturated, nothing ran" exit (issue #4966) —
 *  mirrored from `lib/machine-admission.ts` so this module stays pure. */
export const SATURATED_EXIT = 77;
/** Lines of `land`'s output the failure comment carries. */
export const EXCERPT_LINES = 60;

/** One PR as `gh pr list --label ready-to-land --state all` reads it. */
export interface QueuedPr {
    number: number;
    state: "OPEN" | "CLOSED" | "MERGED";
    headRefName: string;
    createdAt: string;
    body: string;
    labels: { name: string }[];
}

/** What one tick does with the queue. */
export interface TickPlan {
    /** Left alone — not landed, not unlabelled: Mergify's queue owns it. */
    shadowed: { pr: number; reason: string }[];
    /** Unlabel and log: the PR is closed/merged or its branch is gone. */
    stale: { pr: number; reason: string }[];
    /** Left labelled for a later tick: a non-repair PR under RED. */
    held: { pr: number; reason: string }[];
    /** The PR this tick lands, `null` when there is none to land. */
    next: QueuedPr | null;
}

/**
 * The tick's plan: oldest `ready-to-land` PR first (creation time, then
 * number), stale ones unlabelled, and — under RED — only a declared repair
 * (a PR closing a recorded `/health-fix` issue — `healthAdmission`, the rule
 * `pr-gate`'s `base-health` posts too) lands; the rest stay queued until the
 * lineage reads AMBER or GREEN. A PR labelled `queue:shadow` is Mergify's
 * (issue #5642, the shadow phase): the runner never lands, unlabels nor
 * relabels it, merged or closed included — one merger per PR.
 */
export function planTick(
    prs: readonly QueuedPr[],
    ctx: {
        /** Remote head branch names (`git ls-remote --heads origin`). */
        remoteBranches: ReadonlySet<string>;
        /** `lineageBlocks(lineage.kind)` — RED or second RED. */
        red: boolean;
        repairIssues: readonly number[];
    }
): TickPlan {
    const plan: TickPlan = { shadowed: [], stale: [], held: [], next: null };
    const ordered = [...prs].sort(
        (a, b) =>
            Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
            a.number - b.number
    );
    for (const pr of ordered) {
        if (pr.labels.some((l) => l.name === SHADOW_LABEL)) {
            plan.shadowed.push({
                pr: pr.number,
                reason: `labelled \`${SHADOW_LABEL}\` — the Mergify queue lands it`,
            });
            continue;
        }
        if (pr.state !== "OPEN") {
            plan.stale.push({
                pr: pr.number,
                reason: `PR is ${pr.state.toLowerCase()}`,
            });
            continue;
        }
        if (!ctx.remoteBranches.has(pr.headRefName)) {
            plan.stale.push({
                pr: pr.number,
                reason: `branch ${pr.headRefName} is gone from origin`,
            });
            continue;
        }
        const admission = healthAdmission({
            red: ctx.red,
            prBody: pr.body,
            repairIssues: ctx.repairIssues,
        });
        if (!admission.admit) {
            plan.held.push({
                pr: pr.number,
                reason: "health is RED and this PR closes no recorded repair issue — queued until AMBER/GREEN",
            });
            continue;
        }
        plan.next ??= pr;
    }
    return plan;
}

/** What a `land` exit means for the PR. */
export type LandOutcome =
    | { action: "merged" }
    | { action: "requeue"; reason: string }
    | { action: "failed"; excerpt: string };

/**
 * `land`'s exit code read as a labelling decision. 0 merged. 77 is the
 * machine staying saturated — `land` ran NOTHING (issue #4966), so the PR
 * stays queued, never `land-failed`. A `null` status is `land` killed by a
 * signal (the runner stopped mid-landing): nothing proves the PR red, so it
 * stays queued too. Anything else is a red landing.
 */
export function outcomeOf(status: number | null, output: string): LandOutcome {
    if (status === 0) return { action: "merged" };
    if (status === SATURATED_EXIT)
        return {
            action: "requeue",
            reason: "machine stayed saturated — land ran nothing",
        };
    if (status === null)
        return { action: "requeue", reason: "land was killed by a signal" };
    return { action: "failed", excerpt: landExcerpt(output) };
}

// eslint-disable-next-line no-control-regex -- stripping the ANSI colour codes
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * The part of `land`'s output a repairer needs: its refusal line when it
 * refused (it may sit above a long tail), then the last `EXCERPT_LINES`
 * lines — the lane receipt and the failing check's output end the log.
 */
export function landExcerpt(output: string, lines = EXCERPT_LINES): string {
    const all = output.replace(ANSI, "").replace(/\s+$/, "").split("\n");
    const tail = all.slice(-lines);
    const refusal = all.find((l) => l.startsWith("land: refusing"));
    if (refusal !== undefined && !tail.includes(refusal))
        return [refusal, "…", ...tail].join("\n");
    return tail.join("\n");
}

/**
 * `land`'s lane receipt line — `lane: ran` or `lane: skipped (gated <sha>
 * against <base>)` (ADR 0136 §2) — or `null` when the output carries none.
 * The session that used to quote it in its report no longer sees the
 * landing, so the runner records it on the merged PR.
 */
export function laneReceipt(output: string): string | null {
    const line = output
        .replace(ANSI, "")
        .split("\n")
        .map((l) => l.trim())
        .find((l) => /^lane: (ran|skipped\b)/.test(l));
    return line ?? null;
}

/** The comment the runner leaves on a PR it merged. */
export function mergedComment(output: string): string {
    const receipt = laneReceipt(output);
    return `**land-runner: merged.** ${receipt === null ? "No lane receipt in `land`'s output." : `\`${receipt}\``}`;
}

/** The comment the runner leaves on a PR it labelled `land-failed`. */
export function failureComment(input: {
    status: number | null;
    excerpt: string;
    logPath: string;
    /** The branch names an issue (`feat|fix/issue-N`): `queue:plan` makes it
     *  a repair pick. `false` (a `docs/` lane): nobody is picked — say so. */
    repairable?: boolean;
}): string {
    // A fence the excerpt cannot close early.
    const fence = "`".repeat(
        Math.max(
            3,
            ...[...input.excerpt.matchAll(/`+/g)].map((m) => m[0].length + 1)
        )
    );
    return [
        `**land-runner: \`land\` exited ${input.status ?? "on a signal"}** — labelled \`${FAILED_LABEL}\`.`,
        "",
        input.repairable === false
            ? "This branch names no issue, so no pass is handed it: a human repairs it; after the fix, `bun run land:ready <PR#>` re-queues it."
            : `\`queue:plan\` hands this PR to the next pass as a repair pick (\`/next-ticket <issue> --resume\`); after the fix, \`bun run land:ready <PR#>\` re-queues it.`,
        "",
        fence,
        input.excerpt,
        fence,
        "",
        `Full log on the runner: \`${input.logPath}\``,
    ].join("\n");
}

/**
 * Whether a merged PR owes `bun run seed:preset --all` — a diff under
 * `convex/cards/sets/` (a preset deck may name the card). It was the
 * session's post-merge step; the session no longer sees the merge.
 */
export function owesPresetSeed(paths: readonly string[]): boolean {
    return paths.some((p) => p.startsWith("convex/cards/sets/"));
}

/** `gh` argv for each label move — one place, so tests pin them. */
export const labelArgs = {
    ready: (pr: number): string[] => [
        "pr",
        "edit",
        String(pr),
        "--add-label",
        READY_LABEL,
        "--remove-label",
        FAILED_LABEL,
    ],
    unqueue: (pr: number): string[] => [
        "pr",
        "edit",
        String(pr),
        "--remove-label",
        READY_LABEL,
    ],
    failed: (pr: number): string[] => [
        "pr",
        "edit",
        String(pr),
        "--remove-label",
        READY_LABEL,
        "--add-label",
        FAILED_LABEL,
    ],
};

/**
 * The worktree `git worktree list --porcelain` shows holding `branch`, or
 * `null`. A session's own worktree outlives the session that pushed it; the
 * runner lands from it (and `land` tears it down) rather than failing to
 * check the branch out a second time.
 */
export function worktreeOfBranch(
    porcelain: string,
    branch: string
): string | null {
    let path: string | null = null;
    for (const line of porcelain.split("\n")) {
        if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
        else if (line === `branch refs/heads/${branch}` && path !== null)
            return path;
        else if (line === "") path = null;
    }
    return null;
}

/** The runner's own `tolaria.config.json` block. */
export interface LandRunnerConfig {
    /** `process.platform` of the ONE machine that runs it (topology B': the
     *  MacBook, `darwin`; the Huawei never does). */
    platform: string;
    /** Seconds between ticks of the loop. */
    intervalS: number;
}

export function parseLandRunnerConfig(raw: unknown): LandRunnerConfig {
    const block = (raw as { landRunner?: Record<string, unknown> } | null)
        ?.landRunner;
    const platform =
        typeof block?.platform === "string" ? block.platform : "darwin";
    const intervalS =
        typeof block?.intervalS === "number" &&
        Number.isInteger(block.intervalS) &&
        block.intervalS > 0
            ? block.intervalS
            : 60;
    return { platform, intervalS };
}

/** `TOLARIA_LAND_RUNNER_PLATFORM` overrides `landRunner.platform` for one
 *  process (empty = runs nowhere) — a test, like
 *  `TOLARIA_HEALTH_RUNNER_PLATFORM` for the health runner (issue #5590). */
export function pinLandRunnerPlatform(
    config: LandRunnerConfig,
    env: NodeJS.ProcessEnv = process.env
): LandRunnerConfig {
    const pin = env.TOLARIA_LAND_RUNNER_PLATFORM;
    return pin === undefined ? config : { ...config, platform: pin };
}

/** Whether THIS machine runs the land-runner. */
export function runsHere(config: LandRunnerConfig, platform: string): boolean {
    return config.platform === platform;
}

/** One PR the runner labelled `land-failed`, as the owner notification sees it. */
export interface LandFailure {
    pr: number;
    /** One line: the failing step's first error line. */
    reason: string;
    logPath: string;
}

const ERROR_LINE =
    /error|fail|refus|no such file|not found|cannot|denied|✗|exited \d/i;

/**
 * The one line naming why a `land` went red: the first error-looking line of
 * its excerpt (its `land: refusing` line sorts first by construction), else
 * the last non-empty line — a receipt's tail. Same cause on two PRs yields
 * the same string, which is what `describeLandFailures` coalesces on.
 */
export function failureReason(excerpt: string): string {
    const lines = excerpt
        .replace(ANSI, "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "" && l !== "…");
    const line = lines.find((l) => ERROR_LINE.test(l)) ?? lines.at(-1);
    return (line ?? "no output").slice(0, 160);
}

/**
 * The ONE owner notification for the `land-failed` relabels of a burst of
 * ticks (issue #5599), or `null` when there were none. Failures sharing a
 * reason coalesce into one clause; a reason on 2+ PRs — or equal to the
 * `previous` failure's — is called out as machine-level, not the PRs' fault
 * (four PRs went red on a missing `node`, 2026-10-14).
 */
export function describeLandFailures(
    failures: readonly LandFailure[],
    previous: string | null = null
): string | null {
    if (failures.length === 0) return null;
    const groups = new Map<string, LandFailure[]>();
    for (const f of failures)
        groups.set(f.reason, [...(groups.get(f.reason) ?? []), f]);
    const prs = (g: readonly LandFailure[]): string =>
        g.map((f) => `#${f.pr}`).join(", ");
    const head =
        failures.length === 1
            ? `PR #${failures[0].pr} land-failed`
            : `${failures.length} PRs land-failed`;
    const clauses = [...groups].map(([reason, g]) => {
        const lead = groups.size === 1 && g.length > 1 ? "" : `${prs(g)}: `;
        const repeated = g.length > 1 || reason === previous;
        const callout = repeated
            ? g.length > 1
                ? ` — same cause on ${g.length} PRs — likely infra, not the PRs`
                : " — same cause as the previous failure — likely infra, not the PR"
            : "";
        return `${lead}${reason}${callout}`;
    });
    const where =
        groups.size === 1 && failures.length > 1
            ? `${prs(failures)}; log ${failures[0].logPath}`
            : `log ${failures.at(-1)!.logPath}`;
    return `${head}: ${clauses.join(" | ")} (${where})`;
}
