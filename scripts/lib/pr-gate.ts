/**
 * The two gates the merge queue requires (ADR 0156 §3, §8; issue #5637),
 * posted by `.github/workflows/pr-gate.yml` as commit statuses on a PR's
 * head, from the BASE's code. Pure — `scripts/pr-gate.ts` is the I/O.
 *
 *  - `trusted-author` — green when the PR's author is in `TRUSTED_AUTHORS`;
 *    red when the PR touches `.github/` or `.mergify.yml` (never queueable,
 *    the owner merges those by hand, so no pass loosens its own gates).
 *    Mergify's own queue PRs are exempt: the gates were the queued PRs'
 *    entry conditions.
 *  - `base-health` — the RED rule the land-runner applies (issue #4964):
 *    green unless a RED (or second RED) stands on the base's lineage, and
 *    under a RED green only for a PR closing a declared repair issue.
 *    `healthAdmission` is that rule, and `planTick` reads it too. Mergify's
 *    queue PRs are exempt on the same ground (issue #5978): Mergify re-checks
 *    `queue_conditions` on its draft while a PR is queued, and a draft that
 *    fails one dequeues the PR for good — no GREEN requeues it.
 *
 * A RED is a hold, not a PR's red (issue #6110): `.mergify.yml` leaves a PR
 * whose `base-health` is red `ready-to-land` when the queue dequeues it, and
 * `needsRequeue` is the GREEN that puts it back.
 */
import { closingIssueRefs, redLandGate } from "./red-land-gate";
import { FAILED_LABEL, HELD_LABEL, READY_LABEL } from "./land-labels";
import {
    DESCRIPTION_MAX,
    lineageBlocks,
    type Lineage,
    type LineageKind,
} from "./health-verdict-store";

export const TRUSTED_AUTHOR_CONTEXT = "trusted-author";
export const BASE_HEALTH_CONTEXT = "base-health";

/** Paths a queued PR may never touch: the gates themselves — workflows and
 *  both places Mergify reads its configuration from. */
const PROTECTED_PREFIXES = [".github/", ".mergify/"];
const PROTECTED_FILE = ".mergify.yml";

/** The account Mergify opens its queue PRs as, and their branch prefix. */
export const MERGIFY_LOGIN = "mergify[bot]";
export const MERGIFY_QUEUE_BRANCH = "mergify/merge-queue/";

/** `pending` holds the queue without blaming the PR: the gate could not
 *  read what it decides on, and the next sweep decides again. */
export type GateState = "success" | "failure" | "pending";

/** One commit status, as `POST /repos/{repo}/statuses/{sha}` takes it. */
export interface GateStatus {
    context: string;
    state: GateState;
    description: string;
}

/** A PR as the gate reads it — the REST `pull_request` object's fields. */
export interface GatePr {
    number: number;
    author: string;
    body: string;
    headSha: string;
    headRef: string;
    /** `owner/name` of the head repository; differs from base on a fork. */
    headRepo: string;
    baseRepo: string;
    /** Every path the PR touches — a rename contributes both its names. */
    files: readonly string[];
    /** The PR's own count of changed files; `files` may be shorter (the
     *  REST list stops at 3000) — then the list proves nothing. */
    changedFiles?: number;
}

/** The REST `pull_request` fields the gate reads (event payload or
 *  `GET /repos/{repo}/pulls`). `head.repo` is null once a fork is deleted. */
export interface RestPr {
    number: number;
    user: { login: string };
    body: string | null;
    head: { sha: string; ref: string; repo: { full_name: string } | null };
    base: { repo: { full_name: string } };
    labels?: { name: string }[];
    changed_files?: number;
}

export function gatePrOf(raw: RestPr, files: readonly string[]): GatePr {
    return {
        number: raw.number,
        author: raw.user.login,
        body: raw.body ?? "",
        headSha: raw.head.sha,
        headRef: raw.head.ref,
        headRepo: raw.head.repo?.full_name ?? "",
        baseRepo: raw.base.repo.full_name,
        files,
        changedFiles: raw.changed_files,
    };
}

/** The PRs a re-dispatch re-gates: the open ones labelled `ready-to-land`
 *  — what the queue would admit once both statuses are green. */
export function queuedPrs(open: readonly RestPr[]): RestPr[] {
    return open.filter((p) =>
        (p.labels ?? []).some((l) => l.name === READY_LABEL)
    );
}

/** Mergify's own label on a PR it holds in the queue. */
export const MERGIFY_QUEUED_LABEL = "queued";

/** The comment that puts a dequeued PR back in the merge queue. */
export const REQUEUE_COMMENT = "@mergifyio requeue";

/**
 * Whether a re-gate must requeue a PR (issue #6110). A RED dequeues the PRs
 * in the queue, and Mergify never requeues a PR whose conditions stopped
 * holding (issue #5978), so the GREEN does it: the PR was held (`prior`
 * `base-health` red or pending), is released now (`next` green), would enter
 * the queue (`ready-to-land`, no `land-failed`, `trusted-author` green) and
 * is not in it already (`queued`, Mergify's label). Keyed on the held→green
 * edge, so the 15-minute sweep never repeats the comment on a PR that
 * simply waits its turn.
 */
export function needsRequeue(input: {
    labels: readonly string[];
    prior: GateState | undefined;
    next: GateState;
    trustedAuthor: GateState;
}): boolean {
    const { labels } = input;
    return (
        input.next === "success" &&
        (input.prior === "failure" || input.prior === "pending") &&
        input.trustedAuthor === "success" &&
        labels.includes(READY_LABEL) &&
        !labels.includes(FAILED_LABEL) &&
        !labels.includes(MERGIFY_QUEUED_LABEL)
    );
}

/**
 * What a re-gate does with a `queue:held` PR once the base is off RED (issue
 * #6957). Keyed on the label, never on a `base-health` transition: a PR whose
 * status was already green when the RED cleared never transitions, and its
 * stale label made `pr-refresh` rebase it on every base push.
 *
 * Two steps, because Mergify's dequeue reason is sticky (issue #6163): with
 * the label gone and the reason still `checks-failed`, `.mergify.yml`'s "a PR
 * the queue rejects is a repair pick" labels the PR `land-failed`. So:
 *  - `requeue` — the PR would enter the queue and no `@mergifyio requeue`
 *    was posted since its last dequeue: post one, KEEP the label;
 *  - `release` — the PR is `queued` again (the hold is over), or a requeue
 *    was already posted and did not take, or the PR cannot enter the queue:
 *    remove the label and let the repair-pick rules judge it;
 *  - `none` — not held, the lineage still blocks or cannot be read, or this
 *    PR's own `base-health` is not green.
 */
export type HeldAction = "none" | "requeue" | "release";

export function heldPrAction(input: {
    labels: readonly string[];
    lineage: { kind: LineageKind; error?: string };
    baseHealth: GateState | undefined;
    trustedAuthor: GateState | undefined;
    /** Read only when the answer matters: it costs a comments call. */
    requeuedSinceDequeue: () => boolean;
}): HeldAction {
    const { labels } = input;
    if (!labels.includes(HELD_LABEL)) return "none";
    if (input.lineage.error || lineageBlocks(input.lineage.kind)) return "none";
    if (input.baseHealth !== "success") return "none";
    if (labels.includes(MERGIFY_QUEUED_LABEL)) return "release";
    const enters =
        input.trustedAuthor === "success" &&
        labels.includes(READY_LABEL) &&
        !labels.includes(FAILED_LABEL);
    return enters && !input.requeuedSinceDequeue() ? "requeue" : "release";
}

/** `TRUSTED_AUTHORS` as the repository variable holds it: logins separated
 *  by commas or whitespace, `@` optional. Lowercased (logins are not case
 *  sensitive); an unset variable trusts nobody. */
export function parseTrustedAuthors(raw: string | undefined): string[] {
    return (raw ?? "")
        .split(/[\s,]+/)
        .map((s) => s.replace(/^@/, "").trim().toLowerCase())
        .filter(Boolean);
}

/** A queue PR Mergify opened in this repository (never a fork's lookalike). */
export function isMergifyQueuePr(
    pr: Pick<GatePr, "author" | "headRef" | "headRepo" | "baseRepo">
): boolean {
    return (
        pr.author.toLowerCase() === MERGIFY_LOGIN &&
        pr.headRef.startsWith(MERGIFY_QUEUE_BRANCH) &&
        pr.headRepo.toLowerCase() === pr.baseRepo.toLowerCase()
    );
}

/** `gh api --paginate` path and jq for every path a PR touches — a rename
 *  contributes its old name too (`previous_filename`). One query, read by
 *  `pr-gate` and by `land:ready`'s hand-off (issue #5952). */
export function prFilesApiPath(repo: string, pr: number): string {
    return `repos/${repo}/pulls/${pr}/files?per_page=100`;
}
export const PR_FILES_JQ =
    ".[] | (.filename, (.previous_filename // empty)) | tojson";

/** The touched paths that keep a PR out of the queue, sorted. */
export function protectedPaths(files: readonly string[]): string[] {
    return [
        ...new Set(
            files.filter(
                (f) =>
                    PROTECTED_PREFIXES.some((p) => f.startsWith(p)) ||
                    f === PROTECTED_FILE
            )
        ),
    ].sort();
}

/** A description cut to GitHub's 140 characters, never mid-way silently. */
export function clipDescription(s: string): string {
    return s.length <= DESCRIPTION_MAX
        ? s
        : `${s.slice(0, DESCRIPTION_MAX - 1)}…`;
}

export function trustedAuthorStatus(
    pr: GatePr,
    trusted: readonly string[]
): GateStatus {
    const status = (state: GateState, description: string): GateStatus => ({
        context: TRUSTED_AUTHOR_CONTEXT,
        state,
        description: clipDescription(description),
    });
    if (isMergifyQueuePr(pr))
        return status(
            "success",
            "Mergify queue PR — the gates were its queued PRs' entry conditions"
        );
    if (!trusted.includes(pr.author.toLowerCase()))
        return status(
            "failure",
            `@${pr.author} is not in TRUSTED_AUTHORS — the owner reviews and merges it`
        );
    if (pr.changedFiles !== undefined && pr.changedFiles > pr.files.length)
        return status(
            "failure",
            `file list truncated (${pr.files.length} of ${pr.changedFiles}) — cannot prove .github/ untouched; the owner merges it by hand`
        );
    const touched = protectedPaths(pr.files);
    if (touched.length > 0) {
        const more = touched.length > 1 ? ` (+${touched.length - 1} more)` : "";
        // A path may hold control characters (a forged workflow command).
        const first = [...touched[0]]
            .map((c) => (c.charCodeAt(0) < 0x20 || c === "\x7f" ? "?" : c))
            .join("");
        return status(
            "failure",
            `touches ${first}${more} — never queueable, the owner merges it by hand`
        );
    }
    return status("success", `@${pr.author} is a trusted author`);
}

/** What the RED rule says about one PR. */
export type HealthAdmission =
    | { admit: true; repairOf: number | null }
    | { admit: false };

/**
 * The land-runner's RED rule, extracted (issue #5637): off RED every PR is
 * admitted; under RED (`lineageBlocks`) only a PR closing one of the
 * standing RED's declared repair issues — `redLandGate` with neither
 * `--repair` nor `--red-ok`, which no queued PR can pass.
 */
export function healthAdmission(input: {
    red: boolean;
    prBody: string;
    repairIssues: readonly number[];
}): HealthAdmission {
    const gate = redLandGate({
        ...input,
        repairFlag: false,
        redOkFlag: false,
    });
    if (gate.kind !== "proceed") return { admit: false };
    if (gate.landing !== "repair") return { admit: true, repairOf: null };
    const closed = closingIssueRefs(input.prBody).find((n) =>
        input.repairIssues.includes(n)
    );
    return { admit: true, repairOf: closed ?? null };
}

const short = (sha: string | undefined) => (sha ?? "?").slice(0, 8);

/**
 * `base-health` for one PR. `lineage` is `readVerdictLineage`'s total
 * reading. An unreadable store is `pending`, never a green: the land-runner
 * re-reads every tick, but a status stands until the next event, so a green
 * posted through a 502 would admit a PR onto a RED base for hours. The
 * scheduled sweep decides again. `repairIssues` is only consulted under RED.
 *
 * A Mergify queue PR (`isMergifyQueuePr`) is always green, so the RED hold
 * acts at entry, on the PR's own head (issue #5978): Mergify judges a queued
 * PR's conditions on its draft and requeues none it dequeued, and the
 * draft's body is Mergify's, so judging it would dequeue a declared repair
 * too.
 */
export function baseHealthStatus(input: {
    lineage: Lineage & { error?: string };
    pr: Pick<GatePr, "author" | "body" | "headRef" | "headRepo" | "baseRepo">;
    repairIssues: readonly number[];
}): GateStatus {
    const { lineage } = input;
    const status = (state: GateState, description: string): GateStatus => ({
        context: BASE_HEALTH_CONTEXT,
        state,
        description: clipDescription(description),
    });
    if (isMergifyQueuePr(input.pr))
        return status(
            "success",
            "Mergify queue PR — the gates were its queued PRs' entry conditions"
        );
    const red = lineageBlocks(lineage.kind);
    const admission = healthAdmission({
        red,
        prBody: input.pr.body,
        repairIssues: input.repairIssues,
    });
    const where = `@ ${short(lineage.verdict?.sha)}`;
    if (!red) {
        if (lineage.error)
            return status(
                "pending",
                "health verdict unreadable — held until a sweep reads it"
            );
        if (lineage.kind === "none")
            return status("success", "no health verdict on the base yet");
        return status(
            "success",
            `health ${lineage.kind.toUpperCase()} ${where} — no RED stands`
        );
    }
    const kind = lineage.kind === "second-red" ? "second RED" : "RED";
    if (admission.admit)
        return status(
            "success",
            `health ${kind} ${where} — a declared repair: closes issue #${admission.repairOf}`
        );
    const known =
        input.repairIssues.length === 0
            ? "no repair issue declared"
            : `repairs: ${input.repairIssues.map((n) => `#${n}`).join(", ")}`;
    return status(
        "failure",
        `health ${kind} ${where} — not a declared repair (${known}); held until GREEN/AMBER`
    );
}
