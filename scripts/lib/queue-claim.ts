// `queue:claim` — the claim as ONE locked act (issue #4375, PRD #4373).
//
// `sessions.cap` (ADR 0136 §7, issue #3775) was enforced by a READ: `queue:plan`
// counted live `in-progress` claims and refused a plan at the cap, and the
// session typed the claim itself later (`gh issue edit N --add-label
// in-progress`, `/next-issue` §2). Nothing sat between the read and the write —
// `claim-ledger.sh` observes and never blocks, `deny-guard.sh` had no rule on
// the label — so the window was the whole §0→§2 of the skill, and the observed
// `4/3 live claims` (2026-09-22) was this design working as written: the
// refusal could only describe the overshoot afterwards.
//
// This module is the pure half of the verb: the decision, the lock verdict, the
// journal row. `scripts/queue-claim.ts` does the I/O — `gh`, the filesystem
// lock, `ps` — under the lock, in this order: take the lock, re-read the live
// claims, decide, write the label, write the journal row, release. Two
// sessions racing the verb serialise on the lock and the second one reads the
// first one's label.
//
// The lock is the gate's MECHANISM (atomic `mkdir`, an owner stamp, a stale
// reclaim) in its OWN directory beside the gate's, never the gate's heavy mutex
// itself: a claim is two `gh` calls, and queueing it behind a ten-minute health
// gate would be exactly the wait the light tier exists to avoid.

import { capRefusal, type Admission } from "./queue-plan";

// ── The decision ─────────────────────────────────────────────────────────────

export type ClaimDecision =
    | Admission
    | { admitted: false; refusal: "claimed"; message: string };

export interface ClaimInput {
    /** The issue the session wants. */
    issue: number;
    /** Live claims, already reconciled — the planner's own `liveClaims`
     *  minus the ones it calls stale, read UNDER the lock. */
    live: number[];
    /** `sessions.cap` from `tolaria.config.json`, never a literal. */
    cap: number;
    /** `--no-cap`: the announced escape from the cap refusal ONLY — it never
     *  lets a session claim an issue another session holds. */
    noCap: boolean;
}

/**
 * Whether this session may take `issue` now. The collision check comes FIRST
 * and is not escapable: `--no-cap` argues with the cap, not with another
 * session's live work. Then the planner's own cap rule, so the two verbs can
 * never disagree on what "at the cap" means.
 */
export function claimDecision(input: ClaimInput): ClaimDecision {
    if (input.live.includes(input.issue)) {
        return {
            admitted: false,
            refusal: "claimed",
            message:
                `issue #${input.issue} is already claimed by a live session — pick the next issue instead ` +
                `(\`/next-issue\` §2; a claim with no branch and no PR is released by \`loop:doctor\`, not by hand).`,
        };
    }
    return capRefusal(input.live, input.cap, input.noCap);
}

// ── The stale-claim rule, shared with the planner ───────────────────────────

/** The shape both verbs read off `gh issue list --json number,updatedAt`. */
export interface ClaimedIssue {
    number: number;
    updatedAt: string;
}

/**
 * The live set the cap counts, derived exactly as `planBatch` derives its
 * `activeClaims`: every `in-progress` issue, minus the ones the journal says
 * this machine released, minus the STALE ones (no open PR and untouched for
 * longer than `staleClaimHours`). A claim the planner would call stale is
 * work nobody is doing; counting it toward the cap here while the planner
 * ignores it would let the two verbs disagree — the planner admits the pick
 * and the claim refuses it.
 */
export function liveClaimSet(
    claimed: ClaimedIssue[],
    issuesWithOpenPr: number[],
    released: number[],
    nowIso: string,
    staleClaimHours: number,
    isStale: (
        issue: ClaimedIssue,
        issuesWithOpenPr: number[],
        nowIso: string,
        staleClaimHours: number
    ) => boolean
): number[] {
    const gone = new Set(released);
    return [
        ...new Set(
            claimed
                .filter((i) => !gone.has(i.number))
                .filter(
                    (i) =>
                        !isStale(i, issuesWithOpenPr, nowIso, staleClaimHours)
                )
                .map((i) => i.number)
        ),
    ].sort((a, b) => a - b);
}

// ── The lock ─────────────────────────────────────────────────────────────────

export interface ClaimLockOwner {
    pid: number;
    /** Epoch ms when the lock was taken. */
    ts: number;
    /** What the holder was doing — printed to a waiter. */
    label: string;
}

/** What a waiter does with a lock it could not take. */
export type ClaimLockVerdict = "wait" | "reclaim-dead" | "reclaim-stale";

/**
 * Pure: whether a held lock is still someone's. The holder's pid gone is an
 * orphan (a crashed verb); a live pid past `staleMs` is a hung one (a claim is
 * two `gh` calls — nothing legitimate holds this for half a minute). An
 * unreadable owner file is a lock mid-write or mid-release, and is WAITED on,
 * never reclaimed: reclaiming it would race the holder that is about to stamp
 * it.
 */
export function claimLockVerdict(
    owner: ClaimLockOwner | null,
    now: number,
    staleMs: number,
    alive: boolean
): ClaimLockVerdict {
    if (owner === null) return "wait";
    if (!alive) return "reclaim-dead";
    if (now - owner.ts > staleMs) return "reclaim-stale";
    return "wait";
}

// ── The journal row ──────────────────────────────────────────────────────────

/** The owning process, as `claim-ledger.sh` stamps it (issue #2627). */
export interface ClaimRowOwner {
    pid: number;
    startedAt: string;
}

export interface ClaimRow {
    ts: number;
    session: string;
    issue: number;
    event: "claim";
    plan: string | null;
    planMismatch: { claimed: number; planned: number[] } | null;
    owner: ClaimRowOwner | null;
    /** Which path wrote the row — the verb, or a hand claim the hook saw. */
    via: "queue:claim";
}

/**
 * The row `queue:claim` appends to `.claude/telemetry/claims.jsonl`. It is the
 * SAME shape `claim-ledger.sh` writes — `claim-sweep.sh` releases by
 * `session`, `loop:doctor` reads `owner` for liveness, the dashboard joins on
 * `plan` — because the hook is a PreToolUse observer of Bash TOOL calls and a
 * `gh` invocation inside a bun script is invisible to it. Every reader keeps
 * working; only the writer moved.
 *
 * `planned` is the admitted batch of the latest plan for this session, or
 * `null` when no plan preceded the claim (an interactive `/next-issue N` with
 * an explicit number, a hand run). A claim outside the plan is REPORTED in the
 * row, never blocked — the same contract the hook had.
 */
export function buildClaimRow(input: {
    now: number;
    session: string;
    issue: number;
    planId: string | null;
    planned: number[] | null;
    owner: ClaimRowOwner | null;
}): ClaimRow {
    const mismatch =
        input.planned !== null && !input.planned.includes(input.issue)
            ? { claimed: input.issue, planned: input.planned }
            : null;
    return {
        ts: input.now,
        session: input.session,
        issue: input.issue,
        event: "claim",
        plan: input.planId,
        planMismatch: mismatch,
        owner: input.owner,
        via: "queue:claim",
    };
}

/**
 * The latest plan file for `session` among the names in `.claude/telemetry/plans/`
 * — `<session>-<epoch-ms>.json`, so a lexicographic sort of one session's own
 * files is a chronological one (the same rule `claim-ledger.sh` applies).
 * `null` for an empty session id: `"unknown"` is what `planFilename` writes
 * for a non-Claude-Code run, and joining a hand run to some other hand run's
 * plan would be a false join.
 */
export function latestPlanFor(
    session: string,
    planFileNames: string[]
): string | null {
    if (session === "") return null;
    const own = planFileNames
        .filter((n) => n.startsWith(`${session}-`) && n.endsWith(".json"))
        .sort();
    return own.length === 0 ? null : own[own.length - 1];
}

// ── `ps` parsing, for the owner stamp ────────────────────────────────────────

/**
 * One `ps -o ppid=,comm= -p <pid>` line → the parent pid and the command's
 * basename, or `null` when the line is not that shape (no such process, or
 * a `ps` that printed a header anyway).
 */
export function parsePpidComm(
    line: string
): { ppid: number; comm: string } | null {
    const m = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (!m) return null;
    const comm = m[2].split("/").pop() ?? m[2];
    return { ppid: Number(m[1]), comm };
}
