/**
 * The RED ladder's last rungs (issue #5646, ADR 0156 Amendment I § A RED
 * base is repaired by a bounded ladder): fix forward, revert the culprit,
 * stop. The first rungs — the flake check and the bisect — are
 * `lib/health-bisect.ts`'s; their mark on the evidence (`LADDER_MARK`) is
 * what admits a RED here.
 *
 * ADR 0158 § 3 (amends ADR 0156 rungs 4–5): a named culprit is reverted
 * FIRST; fix-forward is the reopened issue's ordinary pass, under no RED.
 *
 *   4. **Revert** — the bisect named a culprit: a revert PR of its commit,
 *      queued as a repair; the culprit's issue reopens with the evidence
 *      for a fresh pass that lands the culprit again WITH the fix.
 *   5. **Fix forward** — only what a revert cannot handle: the revert does
 *      not apply (a later PR depends on the culprit), or the bisect named
 *      no single culprit. The headless fixer (`health:fix --headless`), at
 *      most `MAX_FIX_ATTEMPTS` attempts per RED episode, each bounded by
 *      `FIX_ATTEMPT_TIMEOUT_MS`.
 *   6. **Stop** — a revert that cannot land, a RED that outlives its
 *      revert, fixer attempts used up: one `ready-for-human` issue, one
 *      failed run (the email), the queue held by the RED itself.
 *
 * Every decision is a pure function of facts read from the pivot (verdicts,
 * evidence, fix-attempt records), the base tip and the revert PR's state;
 * `scripts/health-fix.ts ladder` and `scripts/health-revert.ts` are the I/O.
 */
import { LADDER_MARK } from "./health-bisect";
import type { FixAttempt } from "./health-fix-attempts";
import { RUNNER_ROLES } from "./github-runner";
import { revertRestoresLine } from "./ui-scope";

/** Fixer attempts per RED episode (ADR 0156 Amendment I, rung 4). */
export const MAX_FIX_ATTEMPTS = 2;
/** One fixer attempt's bound: past it the session is killed and reads
 *  `stuck` (issue #5589's `HEADLESS_TIMEOUT_MS`). */
export const FIX_ATTEMPT_TIMEOUT_MS = 3 * 60 * 60 * 1000;
/** An `attempting` record older than this was killed with its job (the
 *  attempt's bound plus the job's own slack) and counts as a stuck one. */
export const ATTEMPT_STALE_MS = FIX_ATTEMPT_TIMEOUT_MS + 30 * 60 * 1000;
/** Tries of the revert rung that failed for a reason other than the revert
 *  itself (an API error, a push refused) before the ladder stops. */
export const MAX_REVERT_TRIES = 3;
/** The prefix of a revert record's note for such a failure: retried. */
export const TRANSIENT_NOTE = "transient: ";
/** A repair recorded `landed` that has not moved the tip after this long
 *  (its PR dequeued, or the verdict wrong) counts as a used attempt. */
export const LANDED_WAIT_MS = 8 * 60 * 60 * 1000;
/** A revert PR still in the queue after this long — held by a check it
 *  cannot pass — stops the ladder. */
export const REVERT_QUEUE_MAX_MS = 12 * 60 * 60 * 1000;
/** A repair another session declared on the pivot with a PR still open and
 *  older than this no longer holds the ladder back (issue #6554): the ladder
 *  resumes at the rung it would otherwise take. */
export const FOREIGN_REPAIR_MAX_MS = 12 * 60 * 60 * 1000;
/** Ladder runs one chain of `Next rung` dispatches may make (fix 1, fix 2,
 *  the revert's tries, the stop, and slack): a rung that fails before it
 *  records anything can never re-dispatch forever. */
export const MAX_HOPS = 8;
/** `health-revert.ts`'s exit when it could not record its rung: nothing
 *  changed on the pivot, so the ladder must not re-dispatch the same rung. */
export const REVERT_UNRECORDED = 4;
/** The label the stop rung's issue carries — owner work. */
export const ESCALATION_LABEL = "ready-for-human";

/** The commit the bisect named, from its evidence line. */
export interface Culprit {
    /** The commit's sha as the line prints it (12 hex characters). */
    sha: string;
    /** The PR a squash subject names, or null for a direct commit. */
    pr: number | null;
}

const CULPRIT_LINE = new RegExp(
    `^${LADDER_MARK.replace(/[*]/g, "\\*")}(?:PR #(\\d+)|a direct commit) · \`([0-9a-f]{7,40})\``
);

/** The culprit an evidence body names (`culpritLine`'s named form), or
 *  null — no ladder ran, or it named none. */
export function parseCulprit(evidence: string | null): Culprit | null {
    for (const line of (evidence ?? "").split("\n")) {
        const m = CULPRIT_LINE.exec(line);
        if (m) return { sha: m[2], pr: m[1] ? Number(m[1]) : null };
    }
    return null;
}

/** One RED of the episode: every RED on the base's first-parent history
 *  since the last GREEN, with what was tried on it. */
export interface EpisodeRed {
    sha: string;
    attempt: FixAttempt | null;
    culprit: Culprit | null;
}

/** The revert PR's live state, read from GitHub. */
export interface RevertPr {
    number: number;
    state: "open" | "merged" | "closed";
    /** The queue dequeued it (`land-failed`). */
    landFailed: boolean;
}

/** A repair declared on the pivot by a session other than the ladder's own
 *  attempt (`health:fix repair-issue` run by hand, issue #6554), with the
 *  PR that closes it. */
export interface ForeignRepair {
    issue: number;
    /** The newest PR closing `issue`, or null when none was opened. */
    pr: (RevertPr & { createdAt: number | null }) | null;
}

export type Rung =
    /** No RED stands: nothing to do. */
    | { kind: "none"; why: string }
    /** Something is in flight or not decided yet: the next run decides. */
    | { kind: "wait"; why: string }
    /** The ladder already stopped on this RED: held, quietly (one email). */
    | { kind: "hold"; why: string }
    | { kind: "fix"; attempt: number; why: string }
    | { kind: "revert"; culprit: Culprit; attempt: number; why: string }
    | { kind: "stop"; why: string };

export interface LadderFacts {
    /** The standing RED's sha (`lineageBlocks`), or null when none stands. */
    red: string | null;
    /** The lineage is `second-red`: an AMBER (a proved repair) stands
     *  between this RED and the last GREEN. */
    secondRed: boolean;
    /** The base branch's tip. */
    tip: string;
    /** The standing RED's evidence carries the ladder's mark. */
    laddered: boolean;
    /** The REDs since the last GREEN, NEWEST first; [0] is the standing one. */
    episode: readonly EpisodeRed[];
    /** The PR of the episode's revert record, when it names one. */
    revertPr: RevertPr | null;
    /** Repairs declared on the pivot by someone other than the ladder. */
    foreignRepairs: readonly ForeignRepair[];
    /** An open escalation issue for the standing RED, by number. */
    escalated: number | null;
    /** A read the decision rests on failed. */
    error?: string;
    now: number;
}

const short = (sha: string) => sha.slice(0, 8);

const rungOf = (a: FixAttempt) => a.rung ?? "fix";

function olderThan(a: FixAttempt, ms: number, now: number): boolean {
    const at = a.at ? Date.parse(a.at) : NaN;
    return !Number.isFinite(at) || now - at > ms;
}

const stale = (a: FixAttempt, now: number) =>
    olderThan(a, ATTEMPT_STALE_MS, now);

/** The culprit to revert: the standing RED's, else the newest one of the
 *  episode a bisect named. */
function episodeCulprit(episode: readonly EpisodeRed[]): Culprit | null {
    for (const r of episode) if (r.culprit) return r.culprit;
    return null;
}

/** The declared foreign repair that holds the ladder back: its PR is open
 *  (in the queue, not `land-failed`) and younger than the bound. Closed
 *  unmerged, `land-failed`, merged (the tip then moved: `red !== tip`) or
 *  past the bound releases the ladder. */
export function inFlightForeignRepair(
    repairs: readonly ForeignRepair[],
    now: number
): { issue: number; pr: number } | null {
    for (const r of repairs) {
        const pr = r.pr;
        if (pr === null || pr.state !== "open" || pr.landFailed) continue;
        if (pr.createdAt !== null && now - pr.createdAt > FOREIGN_REPAIR_MAX_MS)
            continue;
        return { issue: r.issue, pr: pr.number };
    }
    return null;
}

/** The open PRs a stuck attempt may withdraw: only those closing a repair
 *  issue the attempt ITSELF recorded (issue #6554), never another session's. */
export function ownRepairPrs(
    prs: readonly { number: number; closes: readonly number[] }[],
    ownIssues: readonly number[]
): number[] {
    return prs
        .filter((pr) => pr.closes.some((n) => ownIssues.includes(n)))
        .map((pr) => pr.number);
}

/** Revert the culprit, or stop: no culprit to revert, or the revert was
 *  already tried and did not apply (`revertSpent`). */
function revertOrStop(
    facts: LadderFacts,
    why: string,
    revertSpent: boolean
): Rung {
    const culprit = episodeCulprit(facts.episode);
    if (culprit === null)
        return {
            kind: "stop",
            why: `${why}, and the bisect named no culprit to revert — the failure cannot be isolated`,
        };
    if (revertSpent)
        return {
            kind: "stop",
            why: `${why}, and the revert of the culprit does not apply`,
        };
    return { kind: "revert", culprit, attempt: 1, why };
}

/**
 * The next rung for the standing RED. Order matters:
 *
 *  - an unreadable fact waits — an outage must never file an escalation;
 *  - an escalated RED holds before anything else is read into it;
 *  - a tip health has not gated (a repair just merged) waits for its verdict;
 *  - a RED whose flake check and bisect have not run waits for them;
 *  - the revert, once tried, decides alone: in the queue → wait; landed and
 *    still RED, or unable to land → stop; a revert that does not apply
 *    (conflict) falls through to the fixer (ADR 0158 § 3);
 *  - a repair another session declared, its PR open → wait for it;
 *  - a repair that landed and left a RED (a second RED) → revert;
 *  - a named culprit → revert it FIRST (ADR 0158 § 3);
 *  - no culprit, or the revert did not apply: fixer attempts left → the next
 *    one; none → stop.
 */
export function ladderRung(facts: LadderFacts): Rung {
    if (facts.error)
        return {
            kind: "wait",
            why: `a fact could not be read — ${facts.error}`,
        };
    const { red } = facts;
    if (red === null) return { kind: "none", why: "no RED stands" };
    if (facts.escalated !== null)
        return {
            kind: "hold",
            why: `the ladder stopped on ${short(red)} — issue #${facts.escalated} is the owner's`,
        };
    // The stop's own marker, written before its issue: a stop whose issue
    // could not be filed emailed once and holds — never a second email.
    if (facts.episode.some((r) => r.attempt?.rung === "stop"))
        return {
            kind: "hold",
            why: `the ladder already stopped on this RED episode`,
        };
    if (red !== facts.tip)
        return {
            kind: "wait",
            why: `the base tip ${short(facts.tip)} has no verdict yet — health gates it`,
        };
    if (!facts.laddered)
        return {
            kind: "wait",
            why: `the flake check and the bisect have not run on ${short(red)}`,
        };

    const records = facts.episode
        .map((r) => r.attempt)
        .filter((a): a is FixAttempt => a !== null);

    const revert = records.find((a) => rungOf(a) === "revert");
    // A revert that does not apply (a later PR depends on the culprit) is
    // spent: the fixer takes the RED (ADR 0158 § 3), the revert never again.
    let revertSpent = false;
    if (revert !== undefined) {
        const tries = revert.attempt ?? 1;
        const transient =
            revert.outcome === "stuck" &&
            revert.note?.startsWith(TRANSIENT_NOTE);
        if (transient && tries < MAX_REVERT_TRIES) {
            const culprit = episodeCulprit(facts.episode);
            if (culprit !== null)
                return {
                    kind: "revert",
                    culprit,
                    attempt: tries + 1,
                    why: `revert try ${tries} failed (${revert.note?.slice(TRANSIENT_NOTE.length)}) — try ${tries + 1} of ${MAX_REVERT_TRIES}`,
                };
        }
        if (transient)
            return {
                kind: "stop",
                why: `the revert could not be made — ${revert.note}`,
            };
        if (revert.outcome === "stuck") revertSpent = true;
        else {
            const pr = facts.revertPr;
            if (pr === null)
                return stale(revert, facts.now)
                    ? {
                          kind: "stop",
                          why: "a revert started and never opened its PR",
                      }
                    : { kind: "wait", why: "a revert is being made" };
            if (pr.state === "merged")
                return {
                    kind: "stop",
                    why: `the RED stands after the revert PR #${pr.number} landed — the failure cannot be isolated`,
                };
            if (pr.state === "closed" || pr.landFailed)
                return {
                    kind: "stop",
                    why: `the revert PR #${pr.number} cannot land (${pr.state === "closed" ? "closed unmerged" : "land-failed"})`,
                };
            if (olderThan(revert, REVERT_QUEUE_MAX_MS, facts.now))
                return {
                    kind: "stop",
                    why: `the revert PR #${pr.number} has waited in the queue past ${REVERT_QUEUE_MAX_MS / 3_600_000} h — something holds it`,
                };
            return {
                kind: "wait",
                why: `the revert PR #${pr.number} is in the queue`,
            };
        }
    }

    // A repair an interactive session declared, its PR in flight: the ladder
    // spawns no fixer and reverts nothing beside it (issue #6554).
    const foreign = inFlightForeignRepair(facts.foreignRepairs, facts.now);
    if (foreign !== null)
        return {
            kind: "wait",
            why: `PR #${foreign.pr} (issue #${foreign.issue}) is a repair declared for ${short(red)} outside the ladder — it is in flight`,
        };

    const fixes = records.filter((a) => rungOf(a) === "fix");
    const running = fixes.find(
        (a) => a.outcome === "attempting" && !stale(a, facts.now)
    );
    if (running !== undefined)
        return {
            kind: "wait",
            why: `fixer attempt ${running.attempt ?? 1} is running${running.machine ? ` on ${running.machine}` : ""}`,
        };
    const landed = fixes.find(
        (a) =>
            a.outcome === "landed" &&
            // A `landed` that never moved the tip is a used attempt.
            (a.sha !== red || !olderThan(a, LANDED_WAIT_MS, facts.now))
    );
    if (landed !== undefined && landed.sha !== red)
        return revertOrStop(
            facts,
            `a second RED follows the repair${landed.pr ? ` PR #${landed.pr}` : ""}`,
            revertSpent
        );
    if (landed !== undefined)
        return {
            kind: "wait",
            why: `a repair${landed.pr ? ` (PR #${landed.pr})` : ""} landed against ${short(red)}${landed.classGuard ? ` (its class guard is the owner's: issue #${landed.classGuard})` : ""} — health confirms on its tip`,
        };
    if (facts.secondRed)
        return revertOrStop(
            facts,
            "a second RED follows a proved repair",
            revertSpent
        );

    // Rung 4 (ADR 0158 § 3): a named culprit is reverted FIRST; its issue
    // reopens and the fix-forward is that issue's ordinary pass. The fixer
    // below is only for what a revert cannot handle — the revert does not
    // apply (`revertSpent`) or the bisect named no single culprit.
    const culprit = episodeCulprit(facts.episode);
    if (culprit !== null && !revertSpent)
        return {
            kind: "revert",
            culprit,
            attempt: 1,
            why: `revert the culprit of ${short(red)} first — its issue's fresh pass lands it again with the fix`,
        };

    const used = fixes.reduce((n, a) => Math.max(n, a.attempt ?? 1), 0);
    if (used < MAX_FIX_ATTEMPTS)
        return {
            kind: "fix",
            attempt: used + 1,
            why:
                used === 0
                    ? `fix forward ${short(red)}${revertSpent ? " — the revert of the culprit does not apply" : " — the bisect named no culprit"}`
                    : `fixer attempt ${used} was stuck — attempt ${used + 1} of ${MAX_FIX_ATTEMPTS}`,
        };
    return {
        kind: "stop",
        why: `both fixer attempts on ${short(red)} were stuck${culprit === null ? ", and the bisect named no culprit to revert — the failure cannot be isolated" : ", and the revert of the culprit does not apply"}`,
    };
}

/**
 * The RED episode on the base's first-parent history: from the standing RED
 * (`ancestors[0]`) back to the last GREEN, every RED with its attempt record
 * and culprit, NEWEST first. AMBER and INFRA verdicts and commits with none
 * are passed over — an AMBER is a proved repair inside the same episode
 * (`lineageOf`'s second RED). Pure: the stores are the caller's readers.
 */
export function walkEpisode(
    ancestors: readonly string[],
    read: {
        status: (sha: string) => string | null;
        attempt: (sha: string) => FixAttempt | null;
        evidence: (sha: string) => string | null;
    }
): { episode: EpisodeRed[]; standingEvidence: string | null } {
    const episode: EpisodeRed[] = [];
    let standingEvidence: string | null = null;
    for (const [i, sha] of ancestors.entries()) {
        const status = read.status(sha);
        if (status === "green") break;
        if (status !== "red") continue;
        const body = read.evidence(sha);
        if (i === 0) standingEvidence = body;
        episode.push({
            sha,
            attempt: read.attempt(sha),
            culprit: parseCulprit(body),
        });
    }
    return { episode, standingEvidence };
}

/** The episode's revert record, when one was made. */
export function revertRecordOf(
    episode: readonly EpisodeRed[]
): FixAttempt | null {
    for (const r of episode) if (r.attempt?.rung === "revert") return r.attempt;
    return null;
}

/** May a ladder run dispatch the next one? `hop` is its own place in the
 *  chain (0 for a run `health` dispatched). */
export function mayRedispatch(hop: number): boolean {
    return Number.isInteger(hop) && hop >= 0 && hop + 1 < MAX_HOPS;
}

/** The host of a runner named `<host>-<role>-<n>` (`runnerSpecs`), or null. */
export function hostOfRunnerName(name: string | undefined): string | null {
    const m = new RegExp(`^(.+)-(?:${RUNNER_ROLES.join("|")})-\\d+$`).exec(
        name ?? ""
    );
    return m ? m[1] : null;
}

/** The stop rung's issue title: one per RED sha, its dedup key. */
export function escalationTitle(redSha: string): string {
    return `RED ladder stopped @ ${short(redSha)}`;
}

export function escalationBody(input: {
    red: string;
    why: string;
    evidence: string | null;
    runUrl?: string;
}): string {
    return [
        "## What happened",
        "",
        `The RED ladder (ADR 0156 Amendment I) stopped on the base tip \`${input.red}\`: ${input.why}.`,
        "The RED stands, so the queue admits only a declared repair and no new pass starts.",
        "",
        "## Evidence",
        "",
        input.evidence ??
            "_none published — `bun run health:status --evidence`_",
        "",
        "## What to do",
        "",
        "Repair by hand (`bun run health:fix` from a terminal), or revert the culprit yourself. Close this issue once health reads GREEN.",
        ...(input.runUrl ? ["", `Run: ${input.runUrl}`] : []),
        "",
        "## Band",
        "",
        "P0 — base tip RED",
    ].join("\n");
}

/** The branch a revert is pushed on: its repair issue's, so a `land-failed`
 *  revert is a repair pick like any pass's PR (`queue:plan`, `wt:new
 *  --resume` read `fix/issue-N`; issue #6071). */
export function revertBranch(repairIssue: number): string {
    return `fix/issue-${repairIssue}`;
}

export function revertIssueTitle(culprit: Culprit, subject: string): string {
    return `Revert ${culprit.pr !== null ? `PR #${culprit.pr}` : culprit.sha}: ${subject}`;
}

export function revertIssueBody(input: {
    red: string;
    culprit: Culprit;
    why: string;
    evidence: string | null;
}): string {
    const who =
        input.culprit.pr !== null
            ? `PR #${input.culprit.pr} (\`${input.culprit.sha}\`)`
            : `the direct commit \`${input.culprit.sha}\``;
    return [
        "## What to build",
        "",
        `Revert ${who}, the culprit the bisect named for the RED at \`${input.red}\`: ${input.why}. The RED ladder's first rung once a culprit is named (ADR 0158 § 3, amending ADR 0156 rungs 4–5).`,
        "",
        "## Acceptance criteria",
        "",
        "- [ ] The revert lands through the queue as the declared repair of the RED",
        "- [ ] Health reads GREEN on its tip",
        "",
        "## Evidence",
        "",
        input.evidence ?? "_none published_",
        "",
        "## Band",
        "",
        "P0 — base tip RED",
    ].join("\n");
}

export function revertPrBody(input: {
    issue: number;
    red: string;
    culprit: Culprit;
    /** The reverted commit's full sha: what `land` checks the tree against. */
    revertedSha: string;
    culpritIssues: readonly number[];
}): string {
    const who =
        input.culprit.pr !== null
            ? `PR #${input.culprit.pr}`
            : `\`${input.culprit.sha}\``;
    return [
        `Reverts ${who}, the commit the RED ladder's bisect named for the RED at \`${input.red.slice(0, 12)}\` (ADR 0158 § 3, amending ADR 0156 rungs 4–5).`,
        "",
        `Closes #${input.issue}`,
        "",
        input.culpritIssues.length > 0
            ? `Reopened for a fresh pass: ${input.culpritIssues.map((n) => `issue #${n}`).join(", ")}.`
            : "No issue closed by the culprit to reopen.",
        "",
        // Verified by `land`, never a bare claim (issue #6071): the base has
        // moved since the last GREEN, and batch health never walks.
        revertRestoresLine(input.revertedSha),
        "",
        "## Preset scenario",
        "",
        "None owed — a revert adds no card or gameplay feature.",
    ].join("\n");
}

/** The comment the culprit's reopened issue gets. */
export function reopenComment(input: {
    red: string;
    culprit: Culprit;
    revertPr: number;
    evidence: string | null;
}): string {
    return [
        `Reopened by the RED ladder: ${input.culprit.pr !== null ? `PR #${input.culprit.pr}` : `\`${input.culprit.sha}\``} turned the base RED at \`${input.red.slice(0, 12)}\`, and PR #${input.revertPr} reverts it. A fresh pass lands this issue again WITH the fix, against the evidence below (ADR 0158 § 3).`,
        "",
        input.evidence ?? "_no evidence published_",
    ].join("\n");
}
