// Picker — the `queue:plan` ordering and admission as a pure function a
// dispatcher can call (issue #5648, PRD #5620, ADR 0156 Amendment I).
//
// It is added BESIDE the old planner, which keeps working: the ordering, the
// blocked / owner-only / lint / `Target files` overlap / model-tier admission
// are `planBatch`'s, called unchanged — one authority, so the two cannot
// disagree on an order. Two additions live here and nowhere else:
//
//   * TRUST — only an issue opened by a trusted author, or labelled
//     `ready-for-agent` by the owner, may be picked. A dispatcher runs with
//     the repository's credentials; an issue body is instructions it hands to
//     an agent, so "who wrote it" is an admission fact, not a nicety.
//     Unknown provenance is untrusted (fail closed).
//   * RUN-BASED CLAIM LIVENESS — a claim label proves nothing by itself. A
//     claim with a live `afk-pass` workflow run is held; with no live run it
//     is a RESUME pick when its branch is pushed and an ORPHAN to release
//     otherwise. A claim the caller supplied no run facts for is held (fail
//     closed): releasing on missing evidence would double-run a live pass.
//
// PURE — no clock, no network, no git. The dispatcher gathers provenance and
// run facts (I/O) and hands them in.

import {
    planBatch,
    resumeItems,
    type BatchPlan,
    type PlanConfig,
    type QueueIssue,
    type QueuePort,
    type ResumeItem,
} from "./queue-plan";

/** Who opened an issue and who applied `ready-for-agent` — `null` = unknown. */
export interface IssueProvenance {
    author: string | null;
    readyBy: string | null;
}

export interface TrustPolicy {
    /** The repository owner: their `ready-for-agent` label always admits. */
    owner: string;
    /** Logins whose own issues are admitted without the owner's label. */
    trustedAuthors: readonly string[];
}

/** What the dispatcher saw for one claimed issue. */
export interface ClaimFacts {
    issue: number;
    /** A live `afk-pass` workflow run exists for this claim. */
    liveRun: boolean;
    /** The claim's branch exists on the remote. */
    branchPushed: boolean;
    /** Its open PR, when it has one. */
    pr: number | null;
}

export type ClaimFate = "live" | "resume" | "release";

export interface PickerInput {
    issues: QueueIssue[];
    config: PlanConfig;
    port: QueuePort;
    trust: TrustPolicy;
    provenance: Record<number, IssueProvenance>;
    claims: ClaimFacts[];
}

export interface PickResult {
    /** `planBatch`'s plan over the trusted, unclaimed issues. */
    plan: BatchPlan;
    /** Dead passes' pushed work, band-ordered; take `resume[0]` before `plan.batch[0]`. */
    resume: ResumeItem[];
    /** Orphan claims: label with no live run and no pushed branch. */
    release: number[];
    /** Claims a live run still holds. */
    live: number[];
    /** Skipped for provenance; never reached `planBatch`. */
    untrusted: number[];
}

export function isTrusted(
    provenance: IssueProvenance | undefined,
    policy: TrustPolicy
): boolean {
    if (!provenance) return false;
    if (provenance.readyBy !== null && provenance.readyBy === policy.owner)
        return true;
    if (provenance.author === null) return false;
    return (
        provenance.author === policy.owner ||
        policy.trustedAuthors.includes(provenance.author)
    );
}

export function claimFate(facts: ClaimFacts | undefined): ClaimFate {
    if (!facts || facts.liveRun) return "live";
    return facts.branchPushed ? "resume" : "release";
}

const isClaimed = (issue: QueueIssue): boolean =>
    issue.labels.some((l) => l.name === "in-progress");

export function pick(input: PickerInput): PickResult {
    const { issues, config, port, trust, provenance } = input;
    const facts = new Map(input.claims.map((c) => [c.issue, c]));

    const live: number[] = [];
    const release: number[] = [];
    const resumable: ClaimFacts[] = [];
    const untrusted: number[] = [];
    const competing: QueueIssue[] = [];

    for (const issue of issues) {
        const trusted = isTrusted(provenance[issue.number], trust);
        if (!isClaimed(issue)) {
            if (trusted) competing.push(issue);
            else untrusted.push(issue.number);
            continue;
        }
        const fate = claimFate(facts.get(issue.number));
        if (fate === "live") {
            live.push(issue.number);
            // Stays visible to `planBatch` so its `activeClaims` census holds.
            competing.push(issue);
        } else if (fate === "release") {
            release.push(issue.number);
        } else if (trusted) {
            resumable.push(facts.get(issue.number)!);
        } else {
            untrusted.push(issue.number);
        }
    }

    const plan = planBatch(competing, config, port);
    const resume = resumeItems(
        resumable.map((c) => ({
            issue: c.issue,
            verdict: { state: "stranded" as const },
            pr: c.pr,
        })),
        issues,
        config,
        (n) => port.issueDetail(n).body,
        port.priority
    );
    return { plan, resume, release, live, untrusted };
}
