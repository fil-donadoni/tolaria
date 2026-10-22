// `queue:claim` — the claim as ONE locked act (issue #4375, PRD #4373).
//
// `sessions.cap` (ADR 0136 §7, issue #3775) was enforced by a READ: `queue:plan`
// counted live `in-progress` claims and refused a plan at the cap, and the
// session typed the claim itself later (`gh issue edit N --add-label
// in-progress`, `/next-ticket` §2). Nothing sat between the read and the write —
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

import { releaseEditArgs } from "./claim-labels";
import type { ClaimVerdictState } from "../loop-doctor";
import {
    capCensus,
    capRefusal,
    type Admission,
    type CapCensus,
    type MachineScope,
} from "./queue-plan";

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
    /** Same, for `stranded` claims (issue #4763). Not in `live` either — so
     *  the collision check below admits a pass RESUMING one. */
    stranded?: number[];
    /** `live` split by machine (`machineScope`, issue #5302): the CAP counts
     *  `scope.local`, the collision check still reads all of `live` — a
     *  foreign claim holds no slot here but is still somebody's work.
     *  Omitted = the cap counts `live` whole. */
    scope?: MachineScope;
    /** The set the COLLISION check reads, when wider than `live` (issue #5302
     *  review): live claims NOT reconciled against this machine's `released`
     *  rows, since a local release says nothing about the other machine's
     *  re-claim. Omitted = `live`. */
    collide?: number[];
}

/**
 * Whether this session may take `issue` now. The collision check comes FIRST
 * and is not escapable: `--no-cap` argues with the cap, not with another
 * session's live work. Then the planner's own cap rule, so the two verbs can
 * never disagree on what "at the cap" means.
 */
export function claimDecision(input: ClaimInput): ClaimDecision {
    if ((input.collide ?? input.live).includes(input.issue)) {
        return {
            admitted: false,
            refusal: "claimed",
            message:
                `issue #${input.issue} is already claimed by a live session — pick the next issue instead ` +
                `(\`/next-ticket\` §2; a claim with no branch and no PR is released by \`loop:doctor\`, not by hand).`,
        };
    }
    return capRefusal(
        input.scope?.local ?? input.live,
        input.cap,
        input.noCap,
        input.recoverable ?? [],
        input.stranded ?? [],
        input.scope
    );
}

// ── Who holds issue N — the hand-off's ownership check (issue #5996) ────────
//
// `queue:claim` is the only verb that reads the claim before work starts, and
// only `/next-ticket` calls it. A session that filed an issue and implemented
// it straight away never claimed it, so `wt:new` and `land:ready` ran over a
// claim another session held (issue #5986: two passes, one issue, found out at
// a rejected push). `claimOwnership` is the ONE definition of "live claim" and
// "owner" those two verbs share: the `in-progress` label is the claim (as for
// every reader), the journal's last `claim` row names the owning session.

/** Escape for `wt:new` / `land:ready` when the session knowingly works an
 *  issue it did not claim; logged like `TOLARIA_OVER_CAP=1`. */
export const UNCLAIMED_OK_ENV = "TOLARIA_UNCLAIMED_OK";

export type ClaimOwnership =
    | { ok: true }
    | { ok: false; reason: "no-claim" | "foreign-owner"; message: string };

/**
 * Pure: whether `session` holds the live claim on `issue`.
 *
 * - no `in-progress` label, or the journal's last row for the issue is a
 *   `released` one → no live claim;
 * - otherwise the owner is the session of the issue's last `claim` row (a
 *   `pr-open` row keeps the claim and the owner). Another session, no `claim`
 *   row on this machine (another machine's claim, or a hand-typed label), or
 *   an empty session on either side → never this session's.
 *
 * `ledgerText` is the raw `claims.jsonl`; torn lines are skipped, as in every
 * other reader.
 */
export function claimOwnership(input: {
    issue: number;
    session: string;
    hasClaimLabel: boolean;
    ledgerText: string;
    /** The verb refusing, named in the message. */
    verb: string;
}): ClaimOwnership {
    let lastEvent: unknown = null;
    let owner: string | null = null;
    for (const line of input.ledgerText.split("\n")) {
        if (line.trim() === "") continue;
        let row: { issue?: unknown; event?: unknown; session?: unknown };
        try {
            row = JSON.parse(line) as typeof row;
        } catch {
            continue;
        }
        if (row.issue !== input.issue) continue;
        lastEvent = row.event;
        if (row.event === "claim")
            owner = typeof row.session === "string" ? row.session : "";
    }
    const escape = `\`${UNCLAIMED_OK_ENV}=1 bun run ${input.verb}\` (announced, logged) accepts it anyway`;
    if (!input.hasClaimLabel || lastEvent === "released")
        return {
            ok: false,
            reason: "no-claim",
            message:
                `issue #${input.issue} has no live claim — run \`bun run queue:claim ${input.issue}\` first ` +
                `(\`wt:new ${input.issue} --resume\` after it, to take over a dead pass's branch); ${escape}.`,
        };
    if (input.session === "" || owner === null || owner !== input.session)
        return {
            ok: false,
            reason: "foreign-owner",
            message:
                `issue #${input.issue}'s live claim is not this session's — another pass is working it. ` +
                `Pick another issue, or take over a dead pass's claim with \`bun run queue:claim ${input.issue}\` ` +
                `then \`wt:new ${input.issue} --resume\`; ${escape}.`,
        };
    return { ok: true };
}

// ── The stale-claim rule, shared with the planner ───────────────────────────

/**
 * The two fields the STALE rule needs off `gh issue list`.
 *
 * Deliberately NOT `loop-doctor.ts`'s exported `ClaimedIssue`, and named apart
 * from it (issue #4384 review): that one carries `title` because the
 * classifier prints it, this one is the narrowest shape `isStaleClaim` reads.
 * Two same-named, differently-shaped exported types in files that now import
 * from each other compile fine under structural typing and are a foot-gun for
 * the next edit.
 */
export interface StaleRuleIssue {
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
 * carries `ready-for-agent` (a hand-picked `/next-ticket N`, a slice filed
 * without the label). So the verb can refuse where the planner admitted —
 * never the reverse, which is the safe direction for a cap.
 */
export function liveClaimSet(
    claimed: StaleRuleIssue[],
    issuesWithOpenPr: number[],
    released: number[],
    nowIso: string,
    staleClaimHours: number,
    isStale: (
        issue: StaleRuleIssue,
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

/**
 * The sets `claimDecision` reads, from ONE classification (issue #6354).
 *
 * The cap's census runs over the RECONCILED set (this machine's `released`
 * rows out); the collision check over every live label, local releases kept
 * (issue #5302 review). Classifying only the reconciled set left a claim
 * released here and since stranded elsewhere (re-labelled by another pass,
 * PR opened, owner dead) in neither `recoverable` nor `stranded`, so it
 * collided and a `--resume` pass could not take it over — while
 * `loop:doctor` listed it STRANDED. Both sets are now classified: a
 * `released` row clears the journal owner (`parseClaimOwners`), so such a
 * claim is `stranded` only on a positive death reading (`land-failed`, an
 * ended `afk-pass` run) and the other machine's live work stays `live`.
 */
export function claimSets<I extends StaleRuleIssue>(input: {
    claimed: I[];
    issuesWithOpenPr: number[];
    released: number[];
    nowIso: string;
    staleClaimHours: number;
    isStale: Parameters<typeof liveClaimSet>[5];
    /** `loop-doctor`'s `claimVerdicts`, bound — the ONE liveness classifier. */
    classify: (issues: I[]) => Map<number, ClaimVerdictState>;
}): CapCensus & { collide: number[] } {
    const set = (released: number[]) =>
        liveClaimSet(
            input.claimed,
            input.issuesWithOpenPr,
            released,
            input.nowIso,
            input.staleClaimHours,
            input.isStale
        );
    const candidates = set([]);
    const reconciled = set(input.released);
    const verdicts = input.classify(
        input.claimed.filter((i) => candidates.includes(i.number))
    );
    const all = capCensus(candidates, verdicts);
    // A claim proved dead (`recoverable`/`stranded`) stays out of the
    // collision set, so a pass RESUMING one is admitted.
    const dead = new Set([...all.recoverable, ...all.stranded]);
    return {
        ...capCensus(reconciled, verdicts),
        collide: candidates.filter((n) => !dead.has(n)),
    };
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
    /** The machine that wrote the row (issue #5302) — diagnostic only: the
     *  journal is per-machine, so `claimsHeldHere` never compares it. */
    host: string;
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
 * `null` when no plan preceded the claim (an interactive `/next-ticket N` with
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
    host: string;
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
        host: input.host,
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

// ── The release — `queue:claim`'s inverse (issue #4752) ─────────────────────
//
// An abort that typed `gh issue edit N --remove-label in-progress` by hand
// left the `@me` assignee `queue:claim` added and wrote no journal row, so the
// planner deferred the issue as "assigned — someone is working it" on every
// pass, forever. The release is ONE act, like the claim: label, assignee and
// row together. `land`, `claim-sweep.sh` and `loop:doctor --release` already
// remove both; this is the verb the abort path names.

/** The `gh` edit that undoes `queue:claim`'s lives in `claim-labels.ts`
 *  (issue #5562), so every release path removes the same labels. */
export { releaseEditArgs };

export interface ReleaseRow {
    ts: number;
    session: string;
    issue: number;
    /** `released`, the spelling every reader already folds (`releasedClaims`,
     *  `claim-sweep.sh`, `loop:doctor`'s `releaseRecord`). */
    event: "released";
    /** `land-runner` = released at merge (issue #5469). */
    by: "queue:release" | "land-runner";
}

export function buildReleaseRow(input: {
    now: number;
    session: string;
    issue: number;
    by?: ReleaseRow["by"];
}): ReleaseRow {
    return {
        ts: input.now,
        session: input.session,
        issue: input.issue,
        event: "released",
        by: input.by ?? "queue:release",
    };
}

/**
 * The `pr-open` row (issue #5469): the session pushed, labelled its PR
 * `ready-to-land` and handed off to the land-runner. The CLAIM stands — the
 * label stays, so no other pass takes the issue — but nothing on this machine
 * is working it: `claimsHeldHere` reads the row as not held (no cap slot) and
 * `releasedClaims` as not released (still a claim). The runner releases it at
 * merge; a `land-failed` PR is resumed by a new `claim` row.
 */
export interface PrOpenRow {
    ts: number;
    session: string;
    issue: number;
    event: "pr-open";
    pr: number;
    host: string;
    by: "land:ready";
}

export function buildPrOpenRow(input: {
    now: number;
    session: string;
    issue: number;
    pr: number;
    host: string;
}): PrOpenRow {
    return {
        ts: input.now,
        session: input.session,
        issue: input.issue,
        event: "pr-open",
        pr: input.pr,
        host: input.host,
        by: "land:ready",
    };
}

/**
 * The release, with its two effects injected: the `gh` edit first, then the
 * journal row — and the row ONLY when the edit succeeded, because a row that
 * says "released" over a label still on the issue subtracts a live claim from
 * the cap's census.
 */
export function performRelease(input: {
    issue: number;
    session: string;
    now: number;
    by?: ReleaseRow["by"];
    gh: (args: string[]) => void;
    appendRow: (row: ReleaseRow) => void;
}): ReleaseRow {
    input.gh(releaseEditArgs(input.issue));
    const row = buildReleaseRow(input);
    input.appendRow(row);
    return row;
}
