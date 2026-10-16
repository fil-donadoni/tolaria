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
 *    `healthAdmission` is that rule, and `planTick` reads it too.
 */
import { closingIssueRefs, redLandGate } from "./health-cadence";
import { READY_LABEL } from "./land-labels";
import {
    DESCRIPTION_MAX,
    lineageBlocks,
    type Lineage,
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
        const first = touched[0].replace(/[\x00-\x1f\x7f]/g, "?");
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
 */
export function baseHealthStatus(input: {
    lineage: Lineage & { error?: string };
    prBody: string;
    repairIssues: readonly number[];
}): GateStatus {
    const { lineage } = input;
    const status = (state: GateState, description: string): GateStatus => ({
        context: BASE_HEALTH_CONTEXT,
        state,
        description: clipDescription(description),
    });
    const red = lineageBlocks(lineage.kind);
    const admission = healthAdmission({
        red,
        prBody: input.prBody,
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
