/**
 * The stalled-repair alert (issue #7142): a RED that has stood past a bound
 * with none of its declared repairs merged tells the owner, once per state.
 *
 * Under a RED every landing waits on the repair, yet a repair held by
 * `base-health`, dequeued, or waiting for an offline `lane` runner stalled
 * silently until someone read `health:status` (2026-10-27: PR #7136 ready at
 * 06:52Z, merged 09:31Z, no notice). `bun run repair:watch` runs on a
 * schedule on a host that is NOT the `lane` runner's, reads the standing RED
 * and its declared repairs (the `health-fix` pivot), each repair's PR and the
 * `lane` runners, and asks `repairWatchDecision` what to do.
 *
 * Dedupe is `notifyOnce`'s: the notice KEY carries only what makes a stall
 * news — the RED sha, each repair's PR and queue state, whether the `lane`
 * runners are offline — never the age, nor `busy` / `unknown` (a runner
 * flapping between jobs, or one failed API read, must not re-send). A GREEN or AMBER base clears the marker.
 *
 * Every decision here is pure; `scripts/repair-watch.ts` is the I/O.
 */
import { FAILED_LABEL, HELD_LABEL, READY_LABEL } from "./land-labels";
import { MERGIFY_QUEUED_LABEL } from "./pr-gate";
import type { LineageKind } from "./health-verdict-store";

/** The `repairWatch` block of `tolaria.config.json`, read by this module
 *  ONLY. */
export interface RepairWatchConfig {
    /** Minutes a RED may stand with no declared repair merged before the
     *  owner is told. */
    stallMinutes: number;
}

/** Half an hour: a repair's lane on the MacBook is minutes, the queue's
 *  re-gate sweep is 15 — past 30 the repair is stalled, not slow. */
export const DEFAULT_STALL_MINUTES = 30;

export function parseRepairWatchConfig(raw: unknown): RepairWatchConfig {
    const v = (raw as { repairWatch?: { stallMinutes?: unknown } } | null)
        ?.repairWatch?.stallMinutes;
    return {
        stallMinutes:
            typeof v === "number" && Number.isFinite(v) && v > 0
                ? v
                : DEFAULT_STALL_MINUTES,
    };
}

/** A repair issue's PR, as `gh pr view` reads it. */
export interface RepairPr {
    number: number;
    /** `OPEN` / `CLOSED` / `MERGED`. */
    state: string;
    labels: string[];
}

export interface DeclaredRepair {
    issue: number;
    /** The PR that closes the issue; null when none is linked. */
    pr: RepairPr | null;
}

/** A row of `gh api repos/<slug>/actions/runners`. */
export interface LaneRunnerRow {
    name: string;
    /** `online` / `offline`. */
    status: string;
    busy: boolean;
    labels: string[];
}

export type QueueState =
    | "merged"
    | "queued"
    | "held"
    | "dequeued"
    | "land-failed"
    | "not handed off"
    | "closed"
    | "no PR";

/** Where a repair's PR stands in the merge queue, off its labels. `held`
 *  (`queue:held`) wins over `queued`: pr-gate labels a PR held before the
 *  RED dequeues it. A `ready-to-land` PR without Mergify's `queued` label is
 *  out of the queue — dequeued. Pure. */
export function queueState(pr: RepairPr | null): QueueState {
    if (pr === null) return "no PR";
    if (pr.state === "MERGED") return "merged";
    if (pr.state !== "OPEN") return "closed";
    const has = (l: string) => pr.labels.includes(l);
    if (has(FAILED_LABEL)) return "land-failed";
    if (has(HELD_LABEL)) return "held";
    if (has(MERGIFY_QUEUED_LABEL)) return "queued";
    if (has(READY_LABEL)) return "dequeued";
    return "not handed off";
}

export type LaneState = "online" | "busy" | "offline" | "unknown";

/** The `lane` runners' state: `online` when one is idle, `busy` when every
 *  online one runs a job, `offline` when none is online (or none is
 *  registered), `unknown` when the API could not be read. Pure. */
export function laneState(rows: readonly LaneRunnerRow[] | null): LaneState {
    if (rows === null) return "unknown";
    const online = rows.filter(
        (r) => r.labels.includes("lane") && r.status === "online"
    );
    if (online.length === 0) return "offline";
    return online.some((r) => !r.busy) ? "online" : "busy";
}

export interface RepairWatchInput {
    lineage: LineageKind;
    /** The standing RED's sha and write time (ISO); null outside a RED. */
    redSha: string | null;
    redAt: string | null;
    now: number;
    config: RepairWatchConfig;
    repairs: readonly DeclaredRepair[];
    lane: LaneState;
}

export type RepairWatchDecision =
    /** GREEN / AMBER: nothing stands, the next stall is news. */
    | { action: "clear"; reason: string }
    /** Nothing to say now; the marker stays. */
    | { action: "none"; reason: string }
    | { action: "notify"; key: string; message: string };

function ageLine(ms: number): string {
    const min = Math.floor(ms / 60_000);
    return min < 60
        ? `${min} min`
        : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** What the watch does this tick. Pure. */
export function repairWatchDecision(i: RepairWatchInput): RepairWatchDecision {
    if (i.lineage === "green" || i.lineage === "amber")
        return { action: "clear", reason: `base is ${i.lineage}` };
    if (i.lineage !== "red" && i.lineage !== "second-red")
        return { action: "none", reason: `no RED readable (${i.lineage})` };
    if (i.redSha === null) return { action: "none", reason: "RED with no sha" };
    const redAt = i.redAt === null ? NaN : Date.parse(i.redAt);
    if (!Number.isFinite(redAt))
        return { action: "none", reason: "RED carries no time" };
    const age = i.now - redAt;
    if (age < i.config.stallMinutes * 60_000)
        return {
            action: "none",
            reason: `RED ${i.redSha.slice(0, 8)} stands ${ageLine(age)}, under the ${i.config.stallMinutes} min bound`,
        };
    const rows = i.repairs.map((r) => ({ ...r, state: queueState(r.pr) }));
    const merged = rows.find((r) => r.state === "merged");
    if (merged)
        return {
            action: "none",
            reason: `repair issue #${merged.issue} merged (PR #${merged.pr!.number}); health settles the RED`,
        };
    const sha = i.redSha.slice(0, 8);
    const lines = [
        `RED ${sha} stands ${ageLine(age)} (bound ${i.config.stallMinutes} min), no declared repair merged.`,
    ];
    if (rows.length === 0)
        lines.push(
            "No declared repair at all: nothing will clear this RED (`bun run health:fix repair-issue <N>`)."
        );
    for (const r of rows)
        lines.push(
            `repair issue #${r.issue}: ${r.pr ? `PR #${r.pr.number}` : "no PR"} — ${r.state}`
        );
    lines.push(`lane runner: ${i.lane}`);
    // Only "the lane is offline" is news: a runner between jobs (`busy` /
    // `online`) or one unreadable runners call (`unknown`) must not re-send.
    const laneKey = i.lane === "offline" ? "offline" : "up";
    const key = JSON.stringify({
        sha: i.redSha,
        repairs: rows.map((r) => [r.issue, r.pr?.number ?? null, r.state]),
        lane: laneKey,
    });
    return { action: "notify", key, message: lines.join("\n") };
}
