// The week's workflow trends (issue #5651, PRD #5620, ADR 0156 Amendment I
// § The dashboard is simplified, not removed).
//
// `scripts/weekly-report.ts` gathers the facts — the PRs' label and comment
// timelines, the base's `health` statuses, the `afk-pass` records, the
// `queue-lane` JSON, issue counts, and each machine's `telemetry:budget` /
// `telemetry:latency` reading — and this module turns them into the sections
// of `.github/workflows/weekly-report.yml`'s job summary:
//
//   throughput        — PRs merged per hour, issues opened vs closed, the
//                       `ready-for-agent` drain forecast, the window by day
//   failed landings   — `land-failed` episodes by cause, Amendment I's
//                       taxonomy (§ Failed landings: what moves the number)
//   RED episodes      — time to green and the share closed without the
//                       owner, against the target (≥ 80 %, p90 < 6 h)
//   flaky tests       — the queue's one re-run, health's fresh run, the
//                       flaky-test issues filed
//   cost per issue    — the passes' JSON (by model, by area), and each
//                       machine's budget reading
//   latency           — the pass, the queue (`ready-to-land` → merged), and
//                       each machine's `/next-ticket` session wall clock
//
// PURE — no clock, no network, no files: the cockpit (`scripts/cockpit.ts`)
// renders the same trends, and the tests run it on recorded responses.

import type { PassRecord } from "./afk-dispatch";
import { decodeStatus } from "./health-verdict-store";
import { escalationTitle } from "./health-ladder";
import { FAILED_LABEL, READY_LABEL } from "./land-labels";
import type { LaneFlake } from "./health-retry";
import { classifyLane } from "../pr-fixup";
import { classifyModel, weightedTokens } from "./usage-window";
import {
    LANDING_CAUSES,
    LANDING_CAUSE_LABEL,
    type LandingCause,
} from "./landing-causes";

export { LANDING_CAUSES, LANDING_CAUSE_LABEL, type LandingCause };

// ─────────────────────────────────────────────────────────────────────────
// The facts
// ─────────────────────────────────────────────────────────────────────────

/** The report's window: ISO instants, `from` inclusive, `to` exclusive. */
export interface TrendWindow {
    from: string;
    to: string;
}

/** A PR timeline item, as the search query in `weekly-report.ts` asks. */
export type TimelineItem =
    | {
          __typename: "LabeledEvent" | "UnlabeledEvent";
          createdAt: string;
          label: { name: string };
      }
    | { __typename: "IssueComment"; createdAt: string; body: string }
    /** A new head: a pushed commit, or a force push (a rebase). */
    | { __typename: "PullRequestCommit"; commit: { committedDate: string } }
    | { __typename: "HeadRefForcePushedEvent"; createdAt: string };

export interface PrTimeline {
    number: number;
    mergedAt: string | null;
    timelineItems: { nodes: TimelineItem[] };
}

/** One commit of the base's history and its `health` status. */
export interface HistoryNode {
    oid: string;
    committedDate: string;
    status: {
        context: {
            state: string;
            description: string | null;
            createdAt: string | null;
        } | null;
    } | null;
}

/** What one `queue-lane` run's `lane.json` says. */
export type LaneVerdict =
    | "green"
    /** Every failed step has a `pr-fixup` row: a stale generated artefact. */
    | "regenerable"
    /** The lane wrote no JSON: it refused (a moved tree) or was killed. */
    | "refused"
    | "red"
    /** No `lane.json` artifact on the run. */
    | "unknown";

/** What the queue's one re-run cured (`check:lane --retry-flaky`). */
export type QueueFlake = Pick<LaneFlake, "files" | "cause">;

export interface QueueRun {
    /** The PR the draft checked (`Merge of #N`), or `null`. */
    pr: number | null;
    conclusion: string | null;
    updatedAt: string;
    lane: LaneVerdict;
    flakes: QueueFlake[];
}

/** One machine's `weekly-report machine` file. */
export interface MachineReading {
    host: string;
    /** `telemetry:budget --json`, or `null` with `errors.budget`. */
    budget: unknown;
    /** `telemetry:latency --json`, or `null` with `errors.latency`. */
    latency: unknown;
    errors: { budget?: string; latency?: string };
}

export interface TrendFacts {
    window: TrendWindow;
    /** PRs updated in the window, with their timelines. */
    prs: PrTimeline[];
    issuesOpened: number;
    issuesClosed: number;
    /** The base's history, newest first, from before the window starts. */
    history: HistoryNode[];
    /** Titles of the RED ladder's stop issues (`escalationTitle`). */
    escalations: string[];
    /** Titles of the flaky-test issues opened in the window. */
    flakyIssues: string[];
    queueRuns: QueueRun[];
    passes: PassRecord[];
    /** Finished `afk-pass` runs whose record could not be read. */
    passRecordsMissing: number;
    machines: MachineReading[];
    /** Open `ready-for-agent` issues when the facts were read; `null` when
     *  not read. */
    readyForAgent: number | null;
    /** Each passed issue's `area:*` label, the prefix cut; an issue without
     *  one is absent. */
    issueAreas: Record<number, string>;
}

// ─────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────

const ms = (iso: string) => Date.parse(iso);

function inWindow(iso: string | null, w: TrendWindow): boolean {
    if (iso === null) return false;
    const t = ms(iso);
    return t >= ms(w.from) && t < ms(w.to);
}

/** Nearest-rank percentile; `null` on no values. */
export function percentile(xs: readonly number[], p: number): number | null {
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export interface Spread {
    n: number;
    median: number | null;
    p90: number | null;
}

export function spread(xs: readonly number[]): Spread {
    return {
        n: xs.length,
        median: percentile(xs, 50),
        p90: percentile(xs, 90),
    };
}

const hoursBetween = (a: string, b: string) => (ms(b) - ms(a)) / 3_600_000;

// ─────────────────────────────────────────────────────────────────────────
// Throughput
// ─────────────────────────────────────────────────────────────────────────

export interface Throughput {
    merged: number;
    hours: number;
    prsPerHour: number;
    issuesOpened: number;
    issuesClosed: number;
}

export function throughput(f: TrendFacts): Throughput {
    const merged = f.prs.filter((p) => inWindow(p.mergedAt, f.window)).length;
    const hours = hoursBetween(f.window.from, f.window.to);
    return {
        merged,
        hours,
        prsPerHour: hours > 0 ? merged / hours : 0,
        issuesOpened: f.issuesOpened,
        issuesClosed: f.issuesClosed,
    };
}

export interface DrainForecast {
    /** Open `ready-for-agent` issues; `null` when not read. */
    ready: number | null;
    closedPerDay: number;
    /** Closed minus opened, per day. */
    netPerDay: number;
    /** Days to drain `ready` at the window's close rate, new issues
     *  excluded — ADR 0156's forecast; `null` with no count or no close. */
    days: number | null;
    /** Days at the net rate; `null` when the backlog is not shrinking. */
    netDays: number | null;
}

export function drainForecast(f: TrendFacts, tp: Throughput): DrainForecast {
    const days = tp.hours / 24;
    const closedPerDay = days > 0 ? tp.issuesClosed / days : 0;
    const netPerDay = days > 0 ? (tp.issuesClosed - tp.issuesOpened) / days : 0;
    const at = (rate: number) =>
        f.readyForAgent === null || rate <= 0 ? null : f.readyForAgent / rate;
    return {
        ready: f.readyForAgent,
        closedPerDay,
        netPerDay,
        days: at(closedPerDay),
        netDays: at(netPerDay),
    };
}

/** One UTC day of the window. */
export interface DayPoint {
    day: string;
    merged: number;
    failedLandings: number;
    passes: number;
    passUsd: number;
}

/** The window day by day (UTC), every day present, oldest first. */
export function dailySeries(
    f: TrendFacts,
    episodes: readonly LandingEpisode[]
): DayPoint[] {
    const days = new Map<string, DayPoint>();
    const last = new Date(ms(f.window.to) - 1).toISOString().slice(0, 10);
    for (
        let d = f.window.from.slice(0, 10);
        d <= last;
        d = new Date(ms(`${d}T00:00:00Z`) + 86_400_000)
            .toISOString()
            .slice(0, 10)
    )
        days.set(d, {
            day: d,
            merged: 0,
            failedLandings: 0,
            passes: 0,
            passUsd: 0,
        });
    const at = (iso: string) => days.get(iso.slice(0, 10));
    for (const p of f.prs)
        if (inWindow(p.mergedAt, f.window)) at(p.mergedAt!)!.merged++;
    for (const e of episodes) at(e.at)!.failedLandings++;
    for (const p of passesIn(f)) {
        const d = at(p.endedAt)!;
        d.passes++;
        d.passUsd += p.costUsd ?? 0;
    }
    return [...days.values()];
}

// ─────────────────────────────────────────────────────────────────────────
// Failed landings — Amendment I's taxonomy
// ─────────────────────────────────────────────────────────────────────────

/** A `land-failed` comment's cause, `"red-lane"` when only the queue-lane
 *  run can tell which red, or `null` for a comment that labels nothing. */
export function commentCause(body: string): LandingCause | null {
    const head = body.trimStart();
    if (head.startsWith("**pr-refresh: rebase onto")) return "rebase";
    const dequeued = /^\*\*merge queue: dequeued \(`([A-Za-z_-]+)`\)/.exec(
        head
    );
    if (dequeued)
        return /timeout/i.test(dequeued[1]) ? "environment" : "red-lane";
    // One of pr-check's refusal jobs, its advisory lane included: the PR.
    if (head.startsWith("**merge queue: a `land` refusal is red"))
        return "defect";
    if (head.startsWith("**land-runner: `land` exited")) {
        if (/the rebase stopped/.test(head)) return "rebase";
        if (
            /the health gate is RED and this PR is not a declared repair/.test(
                head
            )
        )
            return "red-base";
        if (/exited on a signal/.test(head)) return "environment";
        return "defect";
    }
    return null;
}

/** A label and its comment are posted by one act, seconds apart. */
const PAIR_MS = 2 * 60_000;
/** How far before the dequeue the draft's lane may have ended. */
const QUEUE_RUN_MS = 3 * 3_600_000;

export interface LandingEpisode {
    pr: number;
    at: string;
    cause: LandingCause;
}

const LANE_CAUSE: Readonly<Record<LaneVerdict, LandingCause>> = {
    regenerable: "stale-artefact",
    refused: "environment",
    red: "defect",
    // A green run cannot have dequeued it; no artifact tells nothing.
    green: "red-lane",
    unknown: "red-lane",
};

/** The red queue-lane run that dequeued `pr` at `at`: the latest failed
 *  run of its draft that ended in the hours before. */
function dequeuingRun(
    pr: number,
    at: string,
    runs: readonly QueueRun[]
): QueueRun | null {
    const t = ms(at);
    let best: QueueRun | null = null;
    for (const r of runs) {
        if (r.pr !== pr || r.conclusion !== "failure") continue;
        const end = ms(r.updatedAt);
        if (end > t + PAIR_MS || end < t - QUEUE_RUN_MS) continue;
        if (best === null || end > ms(best.updatedAt)) best = r;
    }
    return best;
}

/**
 * The `land-failed` episodes that opened in the window — one PR head
 * failing for one reason, however many attempts it took (the guide's § Where
 * the flow fails counts episodes, not attempts). Each label is charged to
 * the comment posted with it (the nearest marker comment within two
 * minutes, each used once); a queue dequeue is sub-classified by its draft's
 * `queue-lane` run. A label is the PR's previous episode again, not a new
 * one, when no head was pushed since that episode and either it carries no
 * comment of its own (Mergify's rule re-firing when the owner re-queues) or
 * its cause is the same (a re-queue that failed the same way).
 */
export function landingEpisodes(f: TrendFacts): LandingEpisode[] {
    const out: LandingEpisode[] = [];
    for (const pr of f.prs) {
        const items = pr.timelineItems.nodes;
        const comments = items
            .filter((i) => i.__typename === "IssueComment")
            .map((i) => ({
                at: ms(i.createdAt),
                cause: commentCause((i as { body: string }).body),
                used: false,
            }))
            .filter((c) => c.cause !== null);
        const pushes = items
            .map((i) =>
                i.__typename === "PullRequestCommit"
                    ? ms(i.commit.committedDate)
                    : i.__typename === "HeadRefForcePushedEvent"
                      ? ms(i.createdAt)
                      : null
            )
            .filter((t): t is number => t !== null);
        type Episode = { at: number; cause: LandingCause };
        let last: Episode | null = null;
        for (const it of items) {
            if (
                it.__typename !== "LabeledEvent" ||
                it.label.name !== FAILED_LABEL
            )
                continue;
            const t = ms(it.createdAt);
            let pick: (typeof comments)[number] | null = null;
            for (const c of comments) {
                if (c.used || Math.abs(c.at - t) > PAIR_MS) continue;
                if (pick === null || Math.abs(c.at - t) < Math.abs(pick.at - t))
                    pick = c;
            }
            if (pick !== null) pick.used = true;
            const cause: LandingCause =
                pick === null
                    ? "other"
                    : pick.cause === "red-lane"
                      ? LANE_CAUSE[
                            dequeuingRun(pr.number, it.createdAt, f.queueRuns)
                                ?.lane ?? "unknown"
                        ]
                      : pick.cause!;
            // Before the window too: the episode a repeat belongs to may
            // predate it.
            const prev = last as Episode | null;
            const sameHead =
                prev !== null && !pushes.some((p) => p > prev.at && p <= t);
            if (sameHead && (pick === null || cause === prev.cause)) continue;
            last = { at: t, cause };
            if (inWindow(it.createdAt, f.window))
                out.push({ pr: pr.number, at: it.createdAt, cause });
        }
    }
    return out.sort((a, b) => ms(a.at) - ms(b.at));
}

export interface LandingFailures {
    episodes: number;
    /** Merged PRs plus failed episodes: every landing attempt that ended. */
    attempts: number;
    /** `episodes / attempts`, or `null` with no attempt. */
    rate: number | null;
    byCause: Record<LandingCause, number>;
}

export function landingFailures(
    episodes: readonly LandingEpisode[],
    merged: number
): LandingFailures {
    const byCause = Object.fromEntries(
        LANDING_CAUSES.map((c) => [c, 0])
    ) as Record<LandingCause, number>;
    for (const e of episodes) byCause[e.cause]++;
    const attempts = merged + episodes.length;
    return {
        episodes: episodes.length,
        attempts,
        rate: attempts > 0 ? episodes.length / attempts : null,
        byCause,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// RED episodes
// ─────────────────────────────────────────────────────────────────────────

/** Amendment I § A RED base is repaired by a bounded ladder: the target. */
export const RED_TARGET = { ownerFreePct: 80, p90Hours: 6 } as const;

export interface RedEpisode {
    /** The RED shas of the episode, oldest first. */
    shas: string[];
    redAt: string;
    /** The GREEN that closed it, or `null` while it stands. */
    greenAt: string | null;
    /** To the GREEN, or to the window's end while it stands. */
    hours: number;
    /** No RED of it reached the ladder's stop rung (an owner's issue). */
    ownerFree: boolean;
}

/**
 * The RED episodes that opened in the window. Walks the base's statuses
 * oldest first: a RED opens an episode (later REDs and AMBERs join it), the
 * next GREEN closes it; INFRA decides nothing. A RED the flake check closed
 * as GREEN on its own sha left no RED behind (the status was overwritten) —
 * it counts under flaky tests, not here.
 */
export function redEpisodes(f: TrendFacts): RedEpisode[] {
    const stops = new Set(f.escalations);
    const verdicts = [...f.history]
        .filter((n) => n.status?.context)
        .sort((a, b) => ms(a.committedDate) - ms(b.committedDate))
        .map((n) => {
            const c = n.status!.context!;
            return decodeStatus({
                sha: n.oid,
                state: c.state,
                description: c.description,
                targetUrl: null,
                createdAt: c.createdAt ?? n.committedDate,
            });
        })
        // Nothing after the window's end: a past window reads as it stood.
        .filter(
            (v) =>
                v !== null &&
                v.status !== "infra" &&
                v.at !== undefined &&
                ms(v.at) < ms(f.window.to)
        );
    const out: RedEpisode[] = [];
    let open: { shas: string[]; redAt: string } | null = null;
    const close = (greenAt: string | null) => {
        if (open === null) return;
        if (inWindow(open.redAt, f.window))
            out.push({
                shas: open.shas,
                redAt: open.redAt,
                greenAt,
                hours: hoursBetween(open.redAt, greenAt ?? f.window.to),
                ownerFree: !open.shas.some((s) =>
                    stops.has(escalationTitle(s))
                ),
            });
        open = null;
    };
    for (const v of verdicts) {
        if (v === null || v.at === undefined) continue;
        if (v.status === "red") {
            if (open === null) open = { shas: [v.sha], redAt: v.at };
            else open.shas.push(v.sha);
        } else if (v.status === "green") close(v.at);
    }
    close(null);
    return out;
}

export interface RedSummary {
    episodes: number;
    standing: number;
    hours: Spread;
    /** Share closed without the owner, of all episodes; `null` with none. */
    ownerFreePct: number | null;
    meetsOwnerFree: boolean | null;
    meetsP90: boolean | null;
}

export function redSummary(eps: readonly RedEpisode[]): RedSummary {
    const hours = spread(eps.map((e) => e.hours));
    const free = eps.filter((e) => e.ownerFree && e.greenAt !== null).length;
    const ownerFreePct = eps.length ? (100 * free) / eps.length : null;
    return {
        episodes: eps.length,
        standing: eps.filter((e) => e.greenAt === null).length,
        hours,
        ownerFreePct,
        meetsOwnerFree:
            ownerFreePct === null
                ? null
                : ownerFreePct >= RED_TARGET.ownerFreePct,
        meetsP90: hours.p90 === null ? null : hours.p90 < RED_TARGET.p90Hours,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Flaky tests
// ─────────────────────────────────────────────────────────────────────────

export interface FlakyRow {
    subject: string;
    /** `queue-lane` (the one re-run) or `health` (the fresh run). */
    source: "queue-lane" | "health";
    count: number;
    causes: string[];
}

const HEALTH_FLAKE = /^flake: (.+) passed on a fresh run$/;

/** Flakes per subject: each file the queue's re-run cured, each health step
 *  a fresh run turned GREEN. Most frequent first. */
export function flakyRows(f: TrendFacts): FlakyRow[] {
    const rows = new Map<string, FlakyRow>();
    const bump = (
        source: FlakyRow["source"],
        subject: string,
        cause: string
    ) => {
        const key = `${source}\u0000${subject}`;
        const row = rows.get(key) ?? { subject, source, count: 0, causes: [] };
        row.count++;
        if (cause && !row.causes.includes(cause)) row.causes.push(cause);
        rows.set(key, row);
    };
    for (const r of f.queueRuns) {
        if (!inWindow(r.updatedAt, f.window)) continue;
        for (const fl of r.flakes)
            for (const file of fl.files) bump("queue-lane", file, fl.cause);
    }
    for (const n of f.history) {
        const c = n.status?.context;
        if (!c || !inWindow(c.createdAt ?? n.committedDate, f.window)) continue;
        const v = decodeStatus({
            sha: n.oid,
            state: c.state,
            description: c.description,
            targetUrl: null,
            createdAt: c.createdAt,
        });
        const m =
            v?.status === "green" ? HEALTH_FLAKE.exec(v.step ?? "") : null;
        if (m) bump("health", m[1], "");
    }
    return [...rows.values()].sort(
        (a, b) => b.count - a.count || a.subject.localeCompare(b.subject)
    );
}

// ─────────────────────────────────────────────────────────────────────────
// Cost and latency
// ─────────────────────────────────────────────────────────────────────────

export interface PassCost {
    passes: number;
    issues: number;
    totalUsd: number;
    /** Per issue, every pass of it summed. */
    perIssueUsd: Spread;
    /** Passes with no `total_cost_usd` (killed, or no JSON result). */
    unknownCost: number;
    recordsMissing: number;
}

const passesIn = (f: TrendFacts) =>
    f.passes.filter((p) => inWindow(p.endedAt, f.window));

export function passCost(f: TrendFacts): PassCost {
    const passes = passesIn(f);
    const byIssue = new Map<number, number>();
    let unknownCost = 0;
    for (const p of passes) {
        if (p.costUsd === null) unknownCost++;
        byIssue.set(p.issue, (byIssue.get(p.issue) ?? 0) + (p.costUsd ?? 0));
    }
    const perIssue = [...byIssue.values()];
    return {
        passes: passes.length,
        issues: byIssue.size,
        totalUsd: perIssue.reduce((a, b) => a + b, 0),
        perIssueUsd: spread(perIssue),
        unknownCost,
        recordsMissing: f.passRecordsMissing,
    };
}

/** The issues of one model or one area, and what each cost. */
export interface CostGroup {
    key: string;
    issues: number;
    passes: number;
    totalUsd: number;
    perIssueUsd: Spread;
}

/** An issue's model when its passes recorded no tokens. */
export const UNRECORDED_MODEL = "(unrecorded)";
/** An issue's area when it carries no `area:*` label. */
export const NO_AREA = "(none)";

interface IssueSpend {
    usd: number;
    passes: number;
    /** Weighted tokens per model tier (`usage-window`'s table, the one the
     *  pass record's tokens are kept for) — only to pick the issue's model. */
    byModel: Map<string, number>;
}

function issueSpend(f: TrendFacts): Map<number, IssueSpend> {
    const out = new Map<number, IssueSpend>();
    for (const p of passesIn(f)) {
        const s = out.get(p.issue) ?? {
            usd: 0,
            passes: 0,
            byModel: new Map<string, number>(),
        };
        s.usd += p.costUsd ?? 0;
        s.passes++;
        for (const [model, c] of Object.entries(p.models)) {
            const tier = classifyModel(model);
            const units = weightedTokens({ models: { [model]: c } });
            s.byModel.set(tier, (s.byModel.get(tier) ?? 0) + units);
        }
        out.set(p.issue, s);
    }
    return out;
}

/** The model tier that drew most of an issue's weighted tokens. */
function issueModel(s: IssueSpend): string {
    let best: [string, number] | null = null;
    for (const [m, units] of s.byModel)
        if (
            best === null ||
            units > best[1] ||
            (units === best[1] && m < best[0])
        )
            best = [m, units];
    return best === null ? UNRECORDED_MODEL : best[0];
}

function costGroups(
    f: TrendFacts,
    keyOf: (issue: number, s: IssueSpend) => string
): CostGroup[] {
    const groups = new Map<
        string,
        { issues: number; passes: number; usd: number[] }
    >();
    for (const [issue, s] of issueSpend(f)) {
        const key = keyOf(issue, s);
        const g = groups.get(key) ?? { issues: 0, passes: 0, usd: [] };
        g.issues++;
        g.passes += s.passes;
        g.usd.push(s.usd);
        groups.set(key, g);
    }
    return [...groups.entries()]
        .map(([key, g]) => ({
            key,
            issues: g.issues,
            passes: g.passes,
            totalUsd: g.usd.reduce((a, b) => a + b, 0),
            perIssueUsd: spread(g.usd),
        }))
        .sort((a, b) => b.totalUsd - a.totalUsd || a.key.localeCompare(b.key));
}

/** Cost per issue by the model tier that ran it (most weighted tokens). */
export function costByModel(f: TrendFacts): CostGroup[] {
    return costGroups(f, (_, s) => issueModel(s));
}

/** Cost per issue by the issue's `area:*` label. */
export function costByArea(f: TrendFacts): CostGroup[] {
    return costGroups(f, (issue) => f.issueAreas[issue] ?? NO_AREA);
}

export interface PassLatency {
    /** Minutes per pass. */
    minutes: Spread;
    byOutcome: Record<string, number>;
}

export function passLatency(f: TrendFacts): PassLatency {
    const passes = passesIn(f);
    const byOutcome: Record<string, number> = {};
    for (const p of passes)
        byOutcome[p.outcome] = (byOutcome[p.outcome] ?? 0) + 1;
    return { minutes: spread(passes.map((p) => p.durationS / 60)), byOutcome };
}

/** Hours from a merged PR's last `ready-to-land` to its merge. */
export function queueHours(f: TrendFacts): Spread {
    const hours: number[] = [];
    for (const pr of f.prs) {
        if (!inWindow(pr.mergedAt, f.window)) continue;
        const merged = ms(pr.mergedAt!);
        let ready: number | null = null;
        for (const it of pr.timelineItems.nodes) {
            if (
                it.__typename !== "LabeledEvent" ||
                it.label.name !== READY_LABEL
            )
                continue;
            const t = ms(it.createdAt);
            if (t <= merged && (ready === null || t > ready)) ready = t;
        }
        if (ready !== null) hours.push((merged - ready) / 3_600_000);
    }
    return spread(hours);
}

/** One machine's numbers, read off its two `--json` outputs. */
export interface MachineTrend {
    host: string;
    /** `/next-ticket` issues the budget attributed (`nextIssue`). */
    issues: number | null;
    issueUsd: Spread | null;
    /** Share of the weekly allowance per issue, percent; `null` without an
     *  allowance on that machine. */
    issueSharePct: Spread | null;
    /** `/next-ticket` sessions' wall clock, minutes. */
    sessions: number | null;
    sessionWallMin: { median: number; p90: number } | null;
    errors: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

export function machineTrend(m: MachineReading): MachineTrend {
    const errors = [m.errors.budget, m.errors.latency].filter(
        (e): e is string => typeof e === "string" && e !== ""
    );
    const out: MachineTrend = {
        host: m.host,
        issues: null,
        issueUsd: null,
        issueSharePct: null,
        sessions: null,
        sessionWallMin: null,
        errors,
    };
    if (isObj(m.budget) && Array.isArray(m.budget.issues)) {
        const issues = m.budget.issues.filter(
            (i): i is Record<string, unknown> =>
                isObj(i) && i.nextIssue === true
        );
        out.issues = issues.length;
        out.issueUsd = spread(
            issues.map((i) => num(i.usd)).filter((x): x is number => x !== null)
        );
        const shares = issues
            .map((i) => num(i.sharePct))
            .filter((x): x is number => x !== null);
        out.issueSharePct = shares.length ? spread(shares) : null;
    }
    if (isObj(m.latency) && Array.isArray(m.latency.cohorts)) {
        const c = m.latency.cohorts.find(
            (x): x is Record<string, unknown> =>
                isObj(x) && String(x.name).startsWith("/next-ticket")
        );
        if (c) {
            out.sessions = num(c.sessions);
            const wall = isObj(c.wall) ? c.wall : {};
            const median = num(wall.median);
            const p90 = num(wall.p90);
            if (median !== null && p90 !== null)
                out.sessionWallMin = { median: median / 60, p90: p90 / 60 };
        }
    }
    return out;
}

/** A machine file, or `null` when it is not one. */
export function parseMachineReading(text: string): MachineReading | null {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    if (!isObj(raw) || typeof raw.host !== "string") return null;
    const errors = isObj(raw.errors) ? raw.errors : {};
    return {
        host: raw.host,
        budget: raw.budget ?? null,
        latency: raw.latency ?? null,
        errors: {
            ...(typeof errors.budget === "string"
                ? { budget: errors.budget }
                : {}),
            ...(typeof errors.latency === "string"
                ? { latency: errors.latency }
                : {}),
        },
    };
}

/** What a queue-lane run's `lane.json` says: its verdict and its flakes.
 *  `null` text = no artifact on the run. */
export function laneRecord(text: string | null): {
    lane: LaneVerdict;
    flakes: QueueFlake[];
} {
    if (text === null) return { lane: "unknown", flakes: [] };
    let raw: unknown;
    try {
        raw = text.trim() === "" ? null : JSON.parse(text);
    } catch {
        raw = null;
    }
    // An empty or torn file: the lane refused before its JSON, or died.
    if (!isObj(raw)) return { lane: "refused", flakes: [] };
    const outcomes = Array.isArray(raw.outcomes) ? raw.outcomes : [];
    const flakes: QueueFlake[] = [];
    for (const o of outcomes) {
        if (!isObj(o) || !isObj(o.flake)) continue;
        const files = Array.isArray(o.flake.files)
            ? o.flake.files.filter((x): x is string => typeof x === "string")
            : [];
        flakes.push({
            files,
            cause: o.flake.cause === "timeout" ? "timeout" : "assertion",
        });
    }
    const lane: LaneVerdict =
        raw.ok !== false
            ? "green"
            : classifyLane(raw as Parameters<typeof classifyLane>[0]) !== null
              ? "regenerable"
              : "red";
    return { lane, flakes };
}

// ─────────────────────────────────────────────────────────────────────────
// The trends and the summary
// ─────────────────────────────────────────────────────────────────────────

export interface Trends {
    version: 2;
    window: TrendWindow;
    throughput: Throughput;
    drain: DrainForecast;
    daily: DayPoint[];
    landings: LandingFailures;
    landingEpisodes: LandingEpisode[];
    red: RedSummary;
    redEpisodes: RedEpisode[];
    flaky: FlakyRow[];
    flakyIssues: string[];
    cost: PassCost;
    costByModel: CostGroup[];
    costByArea: CostGroup[];
    pass: PassLatency;
    queueHours: Spread;
    machines: MachineTrend[];
}

export function weeklyTrends(f: TrendFacts): Trends {
    const tp = throughput(f);
    const episodes = landingEpisodes(f);
    const reds = redEpisodes(f);
    return {
        version: 2,
        window: f.window,
        throughput: tp,
        drain: drainForecast(f, tp),
        daily: dailySeries(f, episodes),
        landings: landingFailures(episodes, tp.merged),
        landingEpisodes: episodes,
        red: redSummary(reds),
        redEpisodes: reds,
        flaky: flakyRows(f),
        flakyIssues: [...f.flakyIssues].sort(),
        cost: passCost(f),
        costByModel: costByModel(f),
        costByArea: costByArea(f),
        pass: passLatency(f),
        queueHours: queueHours(f),
        machines: [...f.machines]
            .map(machineTrend)
            .sort((a, b) => a.host.localeCompare(b.host)),
    };
}

const fx = (n: number | null, digits = 1) =>
    n === null ? "n/a" : n.toFixed(digits);
const pct = (n: number | null) => (n === null ? "n/a" : `${n.toFixed(0)} %`);
const usd = (n: number | null) => (n === null ? "n/a" : `$${n.toFixed(2)}`);
const mark = (ok: boolean | null) => (ok === null ? "—" : ok ? "✅" : "❌");
const spreadCell = (s: Spread | null, fmt: (n: number | null) => string) =>
    s === null || s.n === 0 ? "n/a" : `${fmt(s.median)} / ${fmt(s.p90)}`;

function costTable(by: string, groups: readonly CostGroup[]): string[] {
    if (groups.length === 0) return [];
    return [
        "",
        `| ${by} | issues | passes | total | per issue, median / p90 |`,
        "| --- | --- | --- | --- | --- |",
        ...groups.map(
            (g) =>
                `| ${g.key} | ${g.issues} | ${g.passes} | ${usd(g.totalUsd)} | ${spreadCell(g.perIssueUsd, usd)} |`
        ),
    ];
}

/** The job summary: numbers, PR and issue numbers, test file names — never
 *  a host name (hosts read `machine 1`, `machine 2`), never Claude output. */
export function summaryMarkdown(t: Trends): string {
    const day = (iso: string) => iso.slice(0, 10);
    const L: string[] = [
        `## Weekly workflow report — ${day(t.window.from)} → ${day(t.window.to)}`,
        "",
        "### Throughput",
        "",
        `- PRs merged: ${t.throughput.merged} (${fx(t.throughput.prsPerHour, 2)} per hour over ${fx(t.throughput.hours, 0)} h)`,
        `- issues: ${t.throughput.issuesClosed} closed vs ${t.throughput.issuesOpened} opened (net ${t.throughput.issuesClosed - t.throughput.issuesOpened >= 0 ? "+" : ""}${t.throughput.issuesClosed - t.throughput.issuesOpened})`,
        `- drain forecast: ${t.drain.ready ?? "n/a"} \`ready-for-agent\` — ${fx(t.drain.days)} days at ${fx(t.drain.closedPerDay)} closed a day, new ones excluded; ${t.drain.netDays === null ? "not shrinking net of new ones" : `${fx(t.drain.netDays)} days net of new ones`}`,
        "",
        "### Failed landings by cause",
        "",
        `${t.landings.episodes} episodes over ${t.landings.attempts} landing attempts — ${t.landings.rate === null ? "n/a" : pct(100 * t.landings.rate)} failed (Amendment I expects 5–10 %).`,
        "",
        "| cause | episodes |",
        "| --- | --- |",
        ...LANDING_CAUSES.map(
            (c) => `| ${LANDING_CAUSE_LABEL[c]} | ${t.landings.byCause[c]} |`
        ),
        "",
        "### RED episodes and time to green",
        "",
        `- episodes: ${t.red.episodes}${t.red.standing ? ` (${t.red.standing} still RED)` : ""}`,
        `- closed without the owner: ${pct(t.red.ownerFreePct)} — target ≥ ${RED_TARGET.ownerFreePct} % ${mark(t.red.meetsOwnerFree)}`,
        `- hours to green, median / p90: ${spreadCell(t.red.hours, (n) => fx(n))} — target p90 < ${RED_TARGET.p90Hours} h ${mark(t.red.meetsP90)}`,
        ...(t.redEpisodes.length
            ? [
                  "",
                  "| RED at | first sha | hours | owner |",
                  "| --- | --- | --- | --- |",
                  ...t.redEpisodes.map(
                      (e) =>
                          `| ${e.redAt} | \`${e.shas[0].slice(0, 8)}\` | ${fx(e.hours)}${e.greenAt === null ? " (standing)" : ""} | ${e.ownerFree ? "no" : "yes"} |`
                  ),
              ]
            : []),
        "",
        "### Flaky tests",
        "",
        ...(t.flaky.length
            ? [
                  "| subject | caught by | times | cause |",
                  "| --- | --- | --- | --- |",
                  ...t.flaky.map(
                      (r) =>
                          `| \`${r.subject}\` | ${r.source} | ${r.count} | ${r.causes.join(", ") || "—"} |`
                  ),
              ]
            : ["none recorded"]),
        ...(t.flakyIssues.length
            ? ["", "Filed:", "", ...t.flakyIssues.map((i) => `- ${i}`)]
            : []),
        "",
        "### Cost per issue",
        "",
        `- passes: ${t.cost.passes} over ${t.cost.issues} issues, ${usd(t.cost.totalUsd)} in all`,
        `- per issue, median / p90: ${spreadCell(t.cost.perIssueUsd, usd)}`,
        ...(t.cost.unknownCost
            ? [`- passes with no cost: ${t.cost.unknownCost}`]
            : []),
        ...(t.cost.recordsMissing
            ? [`- finished passes with no record: ${t.cost.recordsMissing}`]
            : []),
        ...costTable("model", t.costByModel),
        ...costTable("area", t.costByArea),
        "",
        "### Pass and queue latency",
        "",
        `- pass, minutes, median / p90: ${spreadCell(t.pass.minutes, (n) => fx(n, 0))}`,
        ...(Object.keys(t.pass.byOutcome).length
            ? [
                  `- outcomes: ${Object.entries(t.pass.byOutcome)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([o, n]) => `\`${o}\` ${n}`)
                      .join(", ")}`,
              ]
            : []),
        `- queue, \`${READY_LABEL}\` → merged, hours, median / p90: ${spreadCell(t.queueHours, (n) => fx(n))} (${t.queueHours.n} PRs)`,
        "",
        "### Machines (`telemetry:budget`, `telemetry:latency`)",
        "",
        ...(t.machines.length
            ? [
                  "| machine | `/next-ticket` issues | $ per issue, median / p90 | allowance share per issue, median / p90 | sessions | session minutes, median / p90 |",
                  "| --- | --- | --- | --- | --- | --- |",
                  ...t.machines.map(
                      (m, i) =>
                          `| machine ${i + 1} | ${m.issues ?? "n/a"} | ${spreadCell(m.issueUsd, usd)} | ${spreadCell(m.issueSharePct, (n) => (n === null ? "n/a" : `${n.toFixed(2)} %`))} | ${m.sessions ?? "n/a"} | ${m.sessionWallMin === null ? "n/a" : `${fx(m.sessionWallMin.median, 0)} / ${fx(m.sessionWallMin.p90, 0)}`} |`
                  ),
                  "",
                  ...t.machines.flatMap((m, i) =>
                      m.errors.map((e) => `- machine ${i + 1}: ${e}`)
                  ),
              ]
            : ["no machine reading"]),
        "",
    ];
    return L.join("\n");
}
