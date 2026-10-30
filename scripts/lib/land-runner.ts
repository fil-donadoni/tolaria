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
 * to the next pass as a REPAIR pick, ahead of new issues — unless the red is
 * one `classifyRed` (`pr-fixup.ts`, issue #5955) calls `regenerable` (the
 * runner fixes the PR up and keeps it queued) or `infra` (re-queued after a
 * backoff): only `needs-pass` costs a pass.
 */
import { classifyRed, type FixKey, type LaneJson } from "../pr-fixup";
import { FAILED_LABEL, READY_LABEL, MANUAL_LABEL } from "./land-labels";
import { healthAdmission, type GateState } from "./pr-gate";

export { FAILED_LABEL, READY_LABEL, MANUAL_LABEL };
/** Set on the `land` the runner spawns — the one hatch `deny-guard.sh` § 8
 *  admits for a `land` invocation. */
export const RUNNER_ENV = "TOLARIA_LAND_RUNNER";
/** `land`'s "nothing ran" (INFRA) exit —
 *  mirrored from `lib/infra-exit.ts` so this module stays pure. */
export const SATURATED_EXIT = 77;
/** Lines of `land`'s output the failure comment carries. */
export const EXCERPT_LINES = 60;
/** How long an `infra` red keeps its PR out of the tick (issue #5955): long
 *  enough for a gateway blip to pass, short enough that a queue of one PR
 *  is not idle for an hour. */
export const INFRA_BACKOFF_S = 300;
/** Consecutive `infra` reds on one PR before it is `land-failed` after all
 *  (issue #5955): a deterministic line the pattern happens to match must
 *  reach a human, never re-queue forever. */
export const INFRA_MAX_STRIKES = 3;

/** One PR's infra backoff: not retried before `until`, `strikes` in a row. */
export interface Deferral {
    until: number;
    strikes: number;
}

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
    queued: { pr: number; reason: string }[];
    /** Unlabel and log: the PR is closed/merged or its branch is gone. */
    stale: { pr: number; reason: string }[];
    /** Left as it is for a later tick: a non-repair PR under RED, or a row
     *  the search index still lists after its labels moved. */
    held: { pr: number; reason: string }[];
    /** The PR this tick lands, `null` when there is none to land. */
    next: QueuedPr | null;
}

/**
 * The tick's plan: oldest `ready-to-land` PR first (creation time, then
 * number), stale ones unlabelled, and — under RED — only a declared repair
 * (a PR closing a recorded `/health-fix` issue — `healthAdmission`, the rule
 * `pr-gate`'s `base-health` posts too) lands; the rest stay queued until the
 * lineage reads AMBER or GREEN. A PR without `merge:manual` is Mergify's
 * (issues #5642, #6213): the runner never lands, unlabels nor relabels it,
 * merged or closed included — one merger per PR.
 *
 * A row is read by its OWN labels, never by the list's filter (issue #5941):
 * the `--label`/`--search` read goes through GitHub's search index, which
 * keeps listing a PR for seconds after its `ready-to-land` label left, while
 * the row's `labels` field is already fresh (PR #5945, 2026-10-18). Trusting
 * the filter landed the same head twice right after a `land-failed` relabel
 * — 34 of 77 failure episodes, 12–18 October. A row without `ready-to-land`,
 * or carrying `land-failed`, is held: nothing to land, nothing to unlabel.
 */
export function planTick(
    prs: readonly QueuedPr[],
    ctx: {
        /** Remote head branch names (`git ls-remote --heads origin`). */
        remoteBranches: ReadonlySet<string>;
        /** `lineageBlocks(lineage.kind)` — RED or second RED. */
        red: boolean;
        repairIssues: readonly number[];
        /** PR → its infra backoff (issue #5955). */
        deferred?: ReadonlyMap<number, Deferral>;
        /** Epoch ms now — paired with `deferred`. */
        now?: number;
    }
): TickPlan {
    const plan: TickPlan = { queued: [], stale: [], held: [], next: null };
    const ordered = [...prs].sort(
        (a, b) =>
            Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
            a.number - b.number
    );
    for (const pr of ordered) {
        if (!pr.labels.some((l) => l.name === MANUAL_LABEL)) {
            plan.queued.push({
                pr: pr.number,
                reason: `not labelled \`${MANUAL_LABEL}\` — the Mergify queue lands it`,
            });
            continue;
        }
        const labels = new Set(pr.labels.map((l) => l.name));
        if (!labels.has(READY_LABEL) || labels.has(FAILED_LABEL)) {
            plan.held.push({
                pr: pr.number,
                reason: `listed by the search index but its own labels are ${[...labels].join(", ") || "none"} — not \`${READY_LABEL}\` alone`,
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
        const deferral = ctx.deferred?.get(pr.number);
        if (deferral !== undefined && (ctx.now ?? 0) < deferral.until) {
            plan.held.push({
                pr: pr.number,
                reason: `infra red (${deferral.strikes}/${INFRA_MAX_STRIKES}) — retried after ${new Date(deferral.until).toISOString()}`,
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
    | { action: "requeue"; reason: string; backoffS?: number }
    | { action: "fixup"; fixes: FixKey[] }
    | { action: "failed"; excerpt: string; cause: string };

/**
 * `land`'s exit code read as a labelling decision. 0 merged. 77 is the
 * a failed post-rebase
 * dependency install (issue #6000) — `land` gated NOTHING, so the PR
 * stays queued, never `land-failed`. A `null` status is `land` killed by a
 * signal (the runner stopped mid-landing): nothing proves the PR red, so it
 * stays queued too. Anything else is a red landing, read by `classifyRed`
 * (issue #5955): `regenerable` → the runner fixes it up (`fixup`),
 * `infra` → stays queued behind a backoff, `needs-pass` → `land-failed`
 * with the cause in its comment.
 */
export function outcomeOf(
    status: number | null,
    output: string,
    red: {
        /** The sidecar lane receipt (`TOLARIA_LANE_JSON_OUT`), or null. */
        lane: LaneJson | null;
        /** Subjects of the PR's commits, newest last. */
        subjects: readonly string[];
        /** `infra` reds already taken in a row on this PR. */
        infraStrikes?: number;
    } = { lane: null, subjects: [] }
): LandOutcome {
    if (status === 0) return { action: "merged" };
    if (status === SATURATED_EXIT)
        return {
            action: "requeue",
            reason: "infra (exit 77) — the dependency install failed; land gated nothing",
        };
    if (status === null)
        return { action: "requeue", reason: "land was killed by a signal" };
    const cls = classifyRed({
        lane: red.lane,
        subjects: red.subjects,
        output,
    });
    if (cls.kind === "regenerable")
        return { action: "fixup", fixes: cls.fixes };
    if (cls.kind === "infra") {
        const strikes = (red.infraStrikes ?? 0) + 1;
        if (strikes >= INFRA_MAX_STRIKES)
            return {
                action: "failed",
                excerpt: landExcerpt(output),
                cause: `infra ${strikes} times running (${cls.reason}) — not an outage any more`,
            };
        return {
            action: "requeue",
            reason: `infra — ${cls.reason}`,
            backoffS: INFRA_BACKOFF_S,
        };
    }
    return {
        action: "failed",
        excerpt: landExcerpt(output),
        cause: cls.reason,
    };
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
    /** `classifyRed`'s reason — why this red is `needs-pass` and not a
     *  fixup or a re-queue (issue #5955). */
    cause?: string;
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
        ...(input.cause === undefined
            ? []
            : [`Class: \`needs-pass\` — ${input.cause}.`, ""]),
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

/**
 * Whether `land:ready` hands the PR to the Mergify queue (issue #5952, the
 * owner's decision of 2026-10-18), else to the runner. The queue admits only
 * a PR whose `trusted-author` status is green — `pr-gate`'s own decision,
 * read whole (`trustedAuthorStatus`): a PR it refuses, labelled
 * `merge:manual`, would have no merger. A repair of a PR the runner failed
 * goes to the queue too (issue #5986): the queue count needs every merge.
 */
export function handsToQueue(input: { trustedAuthor: GateState }): boolean {
    return input.trustedAuthor === "success";
}

/**
 * The PR body with a bare `Closes #<issue>` appended when GitHub does not
 * already link the PR as closing the issue its branch names, else null. The
 * base is the default branch, so GitHub closes a linked issue at merge
 * whoever merges — the Mergify queue has no land-runner to close it, and an
 * open issue whose claim `housekeeping` releases would be picked again
 * (issue #5952). `closing` is GitHub's own `closingIssuesReferences`, never a
 * parse of the body (a negated "does not close #N" still closes it).
 */
export function bodyWithClosingRef(
    body: string,
    issue: number,
    closing: readonly number[]
): string | null {
    if (closing.includes(issue)) return null;
    return `${body.replace(/\s+$/, "")}\n\nCloses #${issue}\n`;
}

/** `gh` argv for each label move — one place, so tests pin them. */
export const labelArgs = {
    /** `manual` (`!handsToQueue`): the owner merges the PR, so it carries
     *  `merge:manual`; a queue PR loses one it carried, so it never sits
     *  with no merger (issue #5952). */
    ready: (pr: number, opts: { manual: boolean }): string[] => [
        "pr",
        "edit",
        String(pr),
        "--add-label",
        READY_LABEL,
        ...(opts.manual ? ["--add-label", MANUAL_LABEL] : []),
        "--remove-label",
        FAILED_LABEL,
        ...(opts.manual ? [] : ["--remove-label", MANUAL_LABEL]),
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

/**
 * What the runner's code is, read as `git rev-parse HEAD:<path>` in the
 * primary checkout it runs from (issue #5941). The process never reloads its
 * modules: one started 2026-10-15 ran without the queue skip (issue #5642)
 * and the RED hold until a manual restart on 2026-10-18 — it touched a
 * queue-landed PR and failed five healthy PRs under RED. The `scripts`
 * tree covers the entry, every `scripts/lib` module it imports and the
 * top-level scripts it imports (`land.ts`) in one id; the
 * config is read once at start. A change to an unrelated script costs a
 * restart between ticks (launchd's 60 s throttle), never a landing.
 */
export const RUNNER_SOURCE_PATHS: readonly string[] = [
    "scripts",
    "tolaria.config.json",
];

/** The exit that asks launchd for a restart: non-zero, so
 *  `KeepAlive.SuccessfulExit = false` respawns the runner (75 = EX_TEMPFAIL). */
export const RESTART_EXIT = 75;

/** The launchd job label of `scripts/runner-units/com.tolaria.land-runner.plist`. */
export const LAUNCHD_LABEL = "com.tolaria.land-runner";

/**
 * Whether launchd runs THIS process as the runner's job — it sets
 * `XPC_SERVICE_NAME` to the job label. Only then does `RESTART_EXIT` come
 * back as a restart; a detached start by hand (`nohup`) has no supervisor,
 * and an exit there would stop the queue instead.
 */
export function launchdSupervised(env: NodeJS.ProcessEnv): boolean {
    return env.XPC_SERVICE_NAME === LAUNCHD_LABEL;
}

/**
 * What a check of the runner's sources, at the top of a loop iteration,
 * asks for: `same` (carry on — also when there was no startup reading to
 * compare against), `unreadable` (git failed now — no evidence, and
 * restarting on it would loop on a broken checkout), `restart` (they moved
 * and launchd will bring the runner back: exit `RESTART_EXIT`) or `warn`
 * (they moved under an unsupervised runner: say so, keep landing).
 */
export type SourceCheck = "same" | "unreadable" | "restart" | "warn";

export function checkSources(
    started: string | null,
    now: string | null,
    supervised: boolean
): SourceCheck {
    if (started === null) return "same";
    if (now === null) return "unreadable";
    if (started === now) return "same";
    return supervised ? "restart" : "warn";
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
/** A `check:lane` receipt row for a red step: `✗ tsc[all]   76.8s`. */
const FAILED_STEP = /^✗\s+(\S+)/;
/** A line of the lane's PLAN header (`lane:`, `run:`, `skip:` and the
 *  indented rows under `skip:`), or a `$ cmd` echo: they say what the lane
 *  WILL do, so their prose ("cannot drift", "fail") is never a cause — PR
 *  #5932's notice quoted a skip reason (issue #6000). */
const PLAN_HEAD = /^(lane|run|skip):\s/;
/** Progress noise a cause is never read from: a passing vitest row, a
 *  vitest section rule (`⎯⎯ Failed Tests 1 ⎯⎯`). */
const NOT_A_CAUSE = /^(✓|⎯)/;

/** The excerpt's non-empty lines, each flagged when it belongs to the plan. */
function excerptLines(excerpt: string): { text: string; plan: boolean }[] {
    const out: { text: string; plan: boolean }[] = [];
    let inPlan = false;
    for (const raw of excerpt.replace(ANSI, "").split("\n")) {
        const text = raw.trim();
        if (text === "" || text === "…") continue;
        if (PLAN_HEAD.test(text)) inPlan = true;
        else if (!/^\s/.test(raw)) inPlan = false;
        out.push({ text, plan: inPlan || text.startsWith("$ ") });
    }
    return out;
}

/**
 * The one line naming why a `land` went red. A `land: refusing` line wins
 * (nothing ran). Else the lane receipt's `✗ <step>` row, joined to the
 * first error-looking line printed before it (the failing step's own
 * output, plan lines excluded) — issue #6000. Else the first error-looking
 * line, else the last non-empty line. Same cause on two PRs yields the same
 * string, which is what `describeLandFailures` coalesces on.
 */
export function failureReason(excerpt: string): string {
    const lines = excerptLines(excerpt);
    const refusal = lines.find((l) => l.text.startsWith("land: refusing"));
    if (refusal !== undefined) return refusal.text.slice(0, 160);
    const failedAt = lines.findIndex((l) => FAILED_STEP.test(l.text));
    if (failedAt >= 0) {
        const step = `✗ ${FAILED_STEP.exec(lines[failedAt].text)![1]}`;
        const cause = lines
            .slice(0, failedAt)
            .find(
                (l) =>
                    !l.plan &&
                    !NOT_A_CAUSE.test(l.text) &&
                    ERROR_LINE.test(l.text)
            );
        return (cause ? `${step} — ${cause.text}` : step).slice(0, 160);
    }
    const prose = lines.filter((l) => !l.plan);
    const line =
        prose.find((l) => ERROR_LINE.test(l.text)) ?? lines.at(-1) ?? null;
    return (line?.text ?? "no output").slice(0, 160);
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

/**
 * The wait between two ticks. It always yields to the event loop once, even
 * straight after a landing: a tick blocks on `spawnSync`, so a back-to-back
 * loop with no `await` never lets a SIGTERM/SIGINT handler run — on
 * 2026-10-18 a stop went unserved through two landings (issue #5950). The
 * yield serves a pending signal between two landings, never during one.
 * A quiet queue then waits `intervalS`, cut short by a stop.
 */
export async function betweenTicks(
    busy: boolean,
    intervalS: number,
    isStopping: () => boolean,
    sleep: (ms: number) => Promise<unknown>
): Promise<void> {
    await sleep(0);
    if (busy) return;
    for (let s = 0; s < intervalS && !isStopping(); s++) await sleep(1000);
}
