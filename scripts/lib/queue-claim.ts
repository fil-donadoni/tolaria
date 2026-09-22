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
// The lock is the gate's MECHANISM (atomic `mkdir`, an owner stamp, a reclaim
// of a dead holder) in its OWN directory beside the gate's, never the gate's
// heavy mutex itself: a claim is a few `gh` round trips, and queueing it
// behind a ten-minute health gate would be exactly the wait the light tier
// exists to avoid.

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
    /** Claims `capCensus` kept OUT of `live` because the liveness classifier
     *  proved them recoverable (issue #4384) — named in the refusal so it
     *  points at the branches to resume. Not part of the decision: they are
     *  already absent from `live`. */
    recoverable?: number[];
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
    return capRefusal(
        input.live,
        input.cap,
        input.noCap,
        input.recoverable ?? []
    );
}

// ── The stale-claim rule, shared with the planner ───────────────────────────

/** The shape both verbs read off `gh issue list --json number,updatedAt`. */
export interface ClaimedIssue {
    number: number;
    updatedAt: string;
}

/**
 * The live set the cap counts: every open `in-progress` issue, minus the ones
 * the journal says this machine released, minus the STALE ones (no open PR
 * and untouched for longer than `staleClaimHours` — `isStaleClaim`, the
 * planner's own rule, shared). A claim the planner would call stale is work
 * nobody is doing; counting it here would let three abandoned labels refuse
 * every claim with no session running.
 *
 * This set is what the cap's CENSUS then splits (`capCensus`, issue #4384):
 * the stale rule here is about the ISSUE's silence, the census is about the
 * owning PROCESS, and a claim whose pass is provably dead with committed work
 * on its branch keeps its label without holding a slot.
 *
 * The set is a SUPERSET of the planner's `activeClaims`, deliberately: the
 * planner reads only its `ready-for-agent` snapshot and skips a `prd` row,
 * while a live session is a live session whether or not its issue still
 * carries `ready-for-agent` (a hand-picked `/next-issue N`, a slice filed
 * without the label). So the verb can refuse where the planner admitted —
 * never the reverse, which is the safe direction for a cap.
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
export type ClaimLockVerdict = "wait" | "reclaim-dead" | "reclaim-orphan";

/**
 * Pure: whether a held lock is still someone's.
 *
 * A LIVE holder is never reclaimed, however long it has held: a `gh` call has
 * no timeout, a rate-limited round trip can legitimately take a while, and a
 * waiter that deleted a live holder's lock would put two processes inside the
 * locked body at once — the exact state the lock exists to forbid. A live
 * holder that is genuinely hung is the WAITER's bounded wait to report, by
 * pid, not this verdict's to steal from.
 *
 * The holder's pid gone is an orphan (a crashed verb) and is reclaimed at
 * once. An owner file that cannot be read is a lock mid-write — `mkdir` done,
 * stamp not yet written — and is waited on for `staleMs` measured from the
 * DIRECTORY's own age; past that it is a stamp that never came (the process
 * died between the two calls) and is reclaimed too. Without that clause a
 * crash in that one window would wedge every later claim until a human
 * removed the directory by hand.
 */
export function claimLockVerdict(
    owner: ClaimLockOwner | null,
    now: number,
    staleMs: number,
    alive: boolean,
    /** Epoch ms the lock directory was created, when the owner is unreadable. */
    dirCreatedAt: number | null = null
): ClaimLockVerdict {
    if (owner === null) {
        if (dirCreatedAt !== null && now - dirCreatedAt > staleMs)
            return "reclaim-orphan";
        return "wait";
    }
    if (!alive) return "reclaim-dead";
    return "wait";
}

/**
 * Pure: whether the process about to release the lock is the one holding it.
 * A holder that ran long — a slow `gh` — must not, on its way out, remove a
 * lock that a later reclaim handed to someone else: it releases ONLY a lock
 * stamped with its own pid. An unreadable stamp is left alone for the same
 * reason.
 */
export function ownsClaimLock(
    owner: ClaimLockOwner | null,
    pid: number
): boolean {
    return owner !== null && owner.pid === pid;
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
 * The row `queue:claim` appends to `.claude/telemetry/claims.jsonl`: every
 * field `claim-ledger.sh` writes, with the same meaning — `claim-sweep.sh`
 * releases by `session`, `loop:doctor` reads `owner` for liveness, the
 * dashboard joins on `plan` — plus `via`, which names the writer. The hook is a
 * PreToolUse observer of Bash TOOL calls and a `gh` invocation inside a bun
 * script is invisible to it. Every reader keeps working; `via` is the one
 * field a reader may use to tell the two writers apart.
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
