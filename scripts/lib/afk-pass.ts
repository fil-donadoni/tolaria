// The AFK pass job's decisions (issue #5650, PRD #5620, ADR 0156 Amendment
// I § The pass is dispatched, not just triggered).
//
// `.github/workflows/afk-pass.yml` runs ONE `/next-ticket` pass as a job on a
// `pass` runner, dispatched by `afk-dispatch.yml` with the issue, its model
// tier, whether it resumes a dead pass, and the host it is pinned to.
// `scripts/afk-pass.ts` launches the session and gathers what it left; this
// module turns those facts into:
//
//   * the `claude` command line — the tier, a fresh session id, the prompt;
//   * the USAGE LIMIT — a rate-limit API error in the session's transcripts,
//     and when the limit resets (the dispatcher holds until then);
//   * the OUTCOME — handed off, closed, aborted, usage limit, timeout, error,
//     no hand-off — and whether it fails the job (the failure streak counts
//     failed runs; a usage limit exits 0, ADR 0156 Amendment I);
//   * the WIP push — a pass that stopped short leaves its work on `origin`,
//     where the next dispatch resumes it;
//   * the `PassRecord` and the job summary — numbers only, never Claude
//     output (§ Public logs).
//
// PURE — no clock, no network, no git, no files.

import { sumWindow, type Categories, type UsageRecord } from "./usage-window";
import { ISSUE_BRANCH, type OpenPr, type PassRecord } from "./afk-dispatch";
import { CLAIM_LABEL, PR_OPEN_LABEL } from "./claim-labels";
import { READY_LABEL } from "./land-labels";

// ─────────────────────────────────────────────────────────────────────────
// Inputs and the command line
// ─────────────────────────────────────────────────────────────────────────

export interface PassInputs {
    issue: number;
    /** The `model:*` tier the dispatcher chose: `sonnet`, `opus`, `fable`. */
    model: string;
    resume: boolean;
}

/** The process environment, or a test's hand-built one. */
type Env = Readonly<Record<string, string | undefined>>;

/** A tier is one lower-case word: it becomes `claude --model <tier>`. */
const MODEL = /^[a-z][a-z0-9.-]*$/;

/** The workflow's inputs, validated — a malformed dispatch fails before any
 *  session starts. */
export function parsePassInputs(env: Env): PassInputs {
    const raw = (env.AFK_ISSUE ?? "").trim();
    if (!/^[1-9]\d*$/.test(raw))
        throw new Error(`issue input is not an issue number: "${raw}"`);
    const model = (env.AFK_MODEL ?? "").trim();
    if (!MODEL.test(model))
        throw new Error(`model input is not a tier: "${model}"`);
    return {
        issue: Number(raw),
        model,
        resume: (env.AFK_RESUME ?? "").trim() === "true",
    };
}

/** `/next-ticket N`, or `/next-ticket N --resume` for a dead pass's work. */
export function passPrompt(p: PassInputs): string {
    return `/next-ticket ${p.issue}${p.resume ? " --resume" : ""}`;
}

/** The pass's `claude` arguments: the tier, the session id the transcripts
 *  are read back by, print mode with the JSON result (its cost), then the
 *  owner's permission mode. */
export function passClaudeArgs(
    p: PassInputs,
    sessionId: string,
    extra: readonly string[]
): string[] {
    return [
        "--model",
        p.model,
        "--session-id",
        sessionId,
        "-p",
        passPrompt(p),
        "--output-format",
        "json",
        ...extra,
    ];
}

/**
 * The session's extra `claude` arguments — its permission mode — from the
 * repository variable `AFK_PASS_CLAUDE_ARGS`. The permission mode is the
 * OWNER's call, never a baked-in default (the loop's own rule):
 * unset, the job refuses before any session starts,
 * rather than run one that blocks on its first permission prompt.
 */
export function passPermissionArgs(raw: string | undefined): string[] {
    const args = (raw ?? "").split(/\s+/).filter(Boolean);
    if (args.length === 0)
        throw new Error(
            "no permission mode: set the repository variable AFK_PASS_CLAUDE_ARGS (the owner's call, never a default)"
        );
    return args;
}

/** The loop's run id for a job: `TOLARIA_LOOP_RUN_ID`, which the
 *  session-origin hook records beside the session. */
export function passRunId(env: Env): string {
    return `gh-${env.GITHUB_RUN_ID ?? "local"}-${env.GITHUB_RUN_ATTEMPT ?? "0"}`;
}

/** The pass's own bound, minutes: the job's `timeout-minutes` kills the
 *  record with the pass, so the pass is ended first. Anything above
 *  `ceiling` (the workflow's margin) or not a positive number reads as the
 *  default. */
export const DEFAULT_PASS_TIMEOUT_MIN = 180;
export const MAX_PASS_TIMEOUT_MIN = 190;

export function passTimeoutMin(raw: string | undefined): number {
    const n = Number((raw ?? "").trim());
    return raw !== undefined &&
        raw.trim() !== "" &&
        Number.isFinite(n) &&
        n > 0 &&
        n <= MAX_PASS_TIMEOUT_MIN
        ? n
        : DEFAULT_PASS_TIMEOUT_MIN;
}

// ─────────────────────────────────────────────────────────────────────────
// What the session left: tokens, cost, the usage limit
// ─────────────────────────────────────────────────────────────────────────

/** Tokens per model over the session's transcripts, the main one and its
 *  subagents' — the same lines the dispatcher's local reading sums. */
export function passTokens(
    records: readonly UsageRecord[]
): Record<string, Categories> {
    return sumWindow(records, -Infinity).models;
}

/** `total_cost_usd` of the `--output-format json` result, or `null` (the
 *  session was killed, or the result is not JSON). */
export function resultCost(stdout: string): number | null {
    const text = stdout.trim();
    if (!text) return null;
    // The result is the last JSON object printed.
    const lines = text.split("\n").filter((l) => l.trim().startsWith("{"));
    for (const candidate of [text, ...lines.reverse()]) {
        try {
            const r = JSON.parse(candidate) as Record<string, unknown>;
            const c = r?.total_cost_usd;
            if (typeof c === "number" && Number.isFinite(c)) return c;
        } catch {
            // not this one
        }
    }
    return null;
}

/** A usage limit with no reset time on it (a model that needs credits):
 *  the dispatcher holds this long, then a pass finds out again. */
export const UNKNOWN_RESET_HOLD_MS = 60 * 60_000;

/** The usage-limit fact of a session: the API refused it for a rate limit
 *  (`error: "rate_limit"` on an API error message, CLI 2.1.2xx), and the
 *  latest reset it named (`quotaLimits.resetsAt` or
 *  `apiErrorParams.rate_limit_info.resetsAt`, epoch seconds). */
export interface UsageLimitHit {
    /** Epoch ms of the latest reset named, or `null` when none was. */
    resetsAtMs: number | null;
}

const resetSeconds = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/** One transcript line's usage-limit fact, or `null`. Never throws. */
export function usageLimitLine(line: string): UsageLimitHit | null {
    const t = line.trim();
    // Cheap prefilter: a transcript runs to hundreds of MB.
    if (!t || !t.includes('"rate_limit"')) return null;
    let rec: Record<string, unknown>;
    try {
        rec = JSON.parse(t) as Record<string, unknown>;
    } catch {
        return null;
    }
    if (rec?.error !== "rate_limit" || rec.isApiErrorMessage !== true)
        return null;
    const quota = rec.quotaLimits as Record<string, unknown> | undefined;
    const params = rec.apiErrorParams as
        | { rate_limit_info?: Record<string, unknown> }
        | undefined;
    const s =
        resetSeconds(quota?.resetsAt) ??
        resetSeconds(params?.rate_limit_info?.resetsAt);
    return { resetsAtMs: s === null ? null : s * 1000 };
}

/**
 * When the usage limit a session hit resets, as ISO, or `null` when it hit
 * none. The latest reset named wins; a hit with no reset holds
 * `UNKNOWN_RESET_HOLD_MS` past `endedMs`. A reset already past at the end of
 * the pass is no hold — the next pass is free to start.
 */
export function usageLimitResetIso(
    hits: readonly UsageLimitHit[],
    endedMs: number
): string | null {
    if (hits.length === 0) return null;
    let best = -Infinity;
    for (const h of hits) {
        const at = h.resetsAtMs ?? endedMs + UNKNOWN_RESET_HOLD_MS;
        if (at > best) best = at;
    }
    return best > endedMs ? new Date(best).toISOString() : null;
}

// ─────────────────────────────────────────────────────────────────────────
// The outcome
// ─────────────────────────────────────────────────────────────────────────

export type PassOutcome =
    /** The PR is labelled `ready-to-land`: the queue has it. */
    | "handed-off"
    /** The issue is closed (already fixed, a duplicate, merged meanwhile). */
    | "closed"
    /** The pass released its claim (`abort.md`): prerequisite wired, or owner
     *  work handed back. */
    | "aborted"
    /** The subscription's usage limit stopped the pass: held, then resumed. */
    | "usage-limit"
    /** The pass ran past its bound and was ended. */
    | "timeout"
    /** `claude` exited non-zero for any other reason. */
    | "error"
    /** `claude` exited 0 and left neither a hand-off nor a release. */
    | "no-hand-off";

export interface OutcomeFacts {
    exitCode: number | null;
    timedOut: boolean;
    usageLimited: boolean;
    /** The issue's PR after the pass, or `null`. */
    pr: OpenPr | null;
    issueClosed: boolean;
    /** The issue's labels after the pass. */
    labels: readonly string[];
}

/**
 * The pass's outcome. The queue holding the PR wins over everything (a limit
 * hit while reporting does not undo a hand-off); then a closed issue; then
 * the usage limit (it explains a timeout or an error); then a released claim
 * — neither `in-progress` nor `pr-open` left; then how `claude` ended.
 */
export function passOutcome(f: OutcomeFacts): PassOutcome {
    if (f.pr !== null && f.pr.labels.includes(READY_LABEL)) return "handed-off";
    if (f.issueClosed) return "closed";
    if (f.usageLimited) return "usage-limit";
    const claimed =
        f.labels.includes(CLAIM_LABEL) || f.labels.includes(PR_OPEN_LABEL);
    if (!claimed) return "aborted";
    if (f.timedOut) return "timeout";
    if (f.exitCode !== 0) return "error";
    return "no-hand-off";
}

/** Why `claude` could not be started, as `ENOENT: spawn claude`, or `null`
 *  when the spawn itself worked (a timeout is the pass running past its
 *  bound, not a failure to start). Issue #6217: a PATH without `claude` left
 *  only `claude exited ?` in the log. */
export function spawnStartFailure(
    error: (Error & { code?: string }) | undefined
): string | null {
    if (error === undefined || error.code === "ETIMEDOUT") return null;
    return `${error.code ?? "ERROR"}: ${error.message}`;
}

/** The `gh` arguments that release a claim as ONE act — label and assignee
 *  together, as `deny-guard` § 6b requires. */
export function releaseClaimArgs(issue: number): string[] {
    return [
        "issue",
        "edit",
        String(issue),
        "--remove-label",
        CLAIM_LABEL,
        "--remove-assignee",
        "@me",
    ];
}

/** `claude` never started: the pass did no work, so it prints why, releases
 *  its own claim, and reports `true` (the caller records `setup-failed`,
 *  which still counts toward the failure streak). A release that fails is
 *  said, not thrown: the dispatcher's doctor releases what remains. */
export function handleStartFailure(
    issue: number,
    error: (Error & { code?: string }) | undefined,
    deps: { say: (line: string) => void; gh: (args: string[]) => void }
): boolean {
    const why = spawnStartFailure(error);
    if (why === null) return false;
    deps.say(`claude could not be started — ${why}`);
    try {
        deps.gh(releaseClaimArgs(issue));
        deps.say(`released the claim on issue #${issue}`);
    } catch (e) {
        deps.say(
            `the claim on issue #${issue} could not be released: ${String(e).split("\n")[0]}`
        );
    }
    return true;
}

/** Outcomes that end the job green. A usage limit is no failure (the
 *  dispatcher holds until the reset); an abort is the skill's own verdict. */
const GREEN: ReadonlySet<PassOutcome> = new Set([
    "handed-off",
    "closed",
    "aborted",
    "usage-limit",
]);

export function outcomeExitCode(o: PassOutcome): 0 | 1 {
    return GREEN.has(o) ? 0 : 1;
}

/** The open PR of `issue`'s branch (`feat/` or `fix/issue-N`), or `null`. */
export function issuePr(issue: number, prs: readonly OpenPr[]): OpenPr | null {
    return (
        prs.find((pr) => {
            const m = ISSUE_BRANCH.exec(pr.headRefName);
            return m !== null && Number(m[1]) === issue;
        }) ?? null
    );
}

// ─────────────────────────────────────────────────────────────────────────
// The WIP push
// ─────────────────────────────────────────────────────────────────────────

/** Outcomes the next dispatch resumes: their work must be on `origin`. */
const RESUMED: ReadonlySet<PassOutcome> = new Set([
    "usage-limit",
    "timeout",
    "error",
    "no-hand-off",
]);

export interface WipFacts {
    outcome: PassOutcome;
    issue: number;
    /** The checked-out branch, or `HEAD` when detached. */
    branch: string;
    /** Uncommitted changes, untracked files included. */
    dirty: boolean;
    /** Commits not on `origin/<branch>` (no upstream = all of them). */
    unpushed: boolean;
}

export type WipAction =
    | { kind: "none"; why: string }
    | { kind: "push"; commit: boolean; branch: string };

/**
 * What the job does with the pass's tree before it is removed. Only for an
 * outcome the next dispatch resumes, and only on the issue's OWN branch — a
 * detached HEAD (the pass never branched) or any other branch is left alone,
 * so nothing here can push the base. Uncommitted work is committed first as
 * a `wip:` commit (the branch is squashed on merge).
 */
export function wipAction(f: WipFacts): WipAction {
    if (!RESUMED.has(f.outcome))
        return { kind: "none", why: `outcome ${f.outcome}` };
    const m = ISSUE_BRANCH.exec(f.branch);
    if (m === null || Number(m[1]) !== f.issue)
        return { kind: "none", why: "not on the issue's branch" };
    if (!f.dirty && !f.unpushed)
        return { kind: "none", why: "everything is on origin" };
    return { kind: "push", commit: f.dirty, branch: f.branch };
}

export function wipCommitMessage(outcome: PassOutcome, issue: number): string {
    return `wip(afk-pass): stopped on ${outcome} — the next dispatch resumes it (issue #${issue})`;
}

// ─────────────────────────────────────────────────────────────────────────
// The record and the summary
// ─────────────────────────────────────────────────────────────────────────

export interface RecordInput {
    issue: number;
    pr: number | null;
    outcome: PassOutcome | "setup-failed";
    host: string;
    startedMs: number;
    endedMs: number;
    models: Record<string, Categories>;
    costUsd: number | null;
    usageLimitResetAt: string | null;
}

export function passRecord(r: RecordInput): PassRecord {
    return {
        version: 1,
        issue: r.issue,
        pr: r.pr,
        outcome: r.outcome,
        host: r.host,
        startedAt: new Date(r.startedMs).toISOString(),
        endedAt: new Date(r.endedMs).toISOString(),
        durationS: Math.max(0, Math.round((r.endedMs - r.startedMs) / 1000)),
        models: r.models,
        costUsd: r.costUsd,
        usageLimitResetAt: r.usageLimitResetAt,
    };
}

/** The job summary: numbers and ids only — no host name, no Claude output. */
export function summaryLines(rec: PassRecord): string[] {
    const tokens = Object.entries(rec.models).map(
        ([model, c]) =>
            `| ${model} | ${c.input} | ${c.output} | ${c.cacheCreation} | ${c.cacheRead} |`
    );
    return [
        "### afk-pass",
        "",
        `- issue: #${rec.issue}`,
        `- PR: ${rec.pr === null ? "none" : `#${rec.pr}`}`,
        `- outcome: \`${rec.outcome}\``,
        `- duration: ${Math.round(rec.durationS / 60)} min`,
        `- cost: ${rec.costUsd === null ? "unknown" : `$${rec.costUsd.toFixed(2)}`}`,
        ...(rec.usageLimitResetAt
            ? [`- usage limit: resets ${rec.usageLimitResetAt}`]
            : []),
        "",
        ...(tokens.length
            ? [
                  "| model | input | output | cache write | cache read |",
                  "| --- | --- | --- | --- | --- |",
                  ...tokens,
              ]
            : ["no tokens read"]),
        "",
    ];
}
