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
//   * CLAIM FATE — a claim label proves nothing by itself. Its verdict is
//     `loop-doctor.ts`'s `classifyClaim`, the ONE authority (issue #6223),
//     over runs, journal owner, branches and PRs; here it only maps to what
//     the dispatcher does: hold, RESUME (a dead pass's work) or RELEASE (an
//     orphan). A claim the caller supplied no verdict for is held (fail
//     closed): releasing on missing evidence would double-run a live pass.
//
// PURE — no clock, no network, no git. The dispatcher gathers provenance and
// run facts (I/O) and hands them in.

import type { ClaimVerdictState } from "../loop-doctor";
import {
    inFlightSet,
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

/** One claimed issue with `classifyClaim`'s verdict on it. */
export interface JudgedClaim {
    issue: number;
    state: ClaimVerdictState;
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
    claims: JudgedClaim[];
    /** Changed files of each open PR, by PR number (issue #6195). */
    prFiles?: Record<number, string[]>;
    /** Open PR number by issue number (issue #6195). */
    prByIssue?: Record<number, number>;
}

export interface PickResult {
    /** `planBatch`'s plan over the trusted, unclaimed issues. */
    plan: BatchPlan;
    /** Dead passes' pushed work, band-ordered; take `resume[0]` before `plan.batch[0]`. */
    resume: ResumeItem[];
    /** Orphan claims: `classifyClaim` proved nothing will release them. */
    release: number[];
    /** Claims held: live, suspect, or queued for the land-runner. */
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

const FATE: Record<ClaimVerdictState, ClaimFate> = {
    live: "live",
    suspect: "live",
    "pr-open": "live",
    stranded: "resume",
    recoverable: "resume",
    orphan: "release",
};

/** Hold beats resume beats release: the order duplicate verdicts merge in. */
const FATE_RANK: Record<ClaimFate, number> = { live: 0, resume: 1, release: 2 };

export function claimFate(claim: JudgedClaim | undefined): ClaimFate {
    return claim ? FATE[claim.state] : "live";
}

const isClaimed = (issue: QueueIssue): boolean =>
    issue.labels.some((l) => l.name === "in-progress");

export function pick(input: PickerInput): PickResult {
    const { issues, config, port, trust, provenance } = input;
    // Duplicate verdicts merge toward "held": a later orphan row must never
    // turn a held claim into a release.
    const facts = new Map<number, JudgedClaim>();
    for (const c of input.claims) {
        const prev = facts.get(c.issue);
        const keep =
            prev && FATE_RANK[claimFate(prev)] <= FATE_RANK[claimFate(c)]
                ? prev
                : c;
        facts.set(c.issue, { ...keep, pr: prev?.pr ?? c.pr });
    }

    const live: number[] = [];
    const release: number[] = [];
    const resumable: JudgedClaim[] = [];
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

    // In-flight set (issue #6195): a live claim (a claimed issue with no
    // facts reads live, as above) and every issue whose PR is still open —
    // claimed or not. A release-fate claim without a PR and a resumable one
    // without a PR occupy nothing.
    const prByIssue = input.prByIssue ?? {};
    const occupying = new Set<number>(Object.keys(prByIssue).map(Number));
    for (const issue of issues)
        if (isClaimed(issue) && claimFate(facts.get(issue.number)) === "live")
            occupying.add(issue.number);
    for (const c of facts.values())
        if (claimFate(c) === "live") occupying.add(c.issue);
    const inFlight = inFlightSet(
        [...occupying].map((n) => ({
            issue: n,
            pr: prByIssue[n] ?? facts.get(n)?.pr ?? null,
        })),
        input.prFiles ?? {},
        (n) => port.issueDetail(n).body,
        config.inferredTargetFiles
    );
    const planned = planBatch(competing, { ...config, inFlight }, port);
    // The run is the liveness authority: `planBatch` judges a claim by issue
    // age and open PR, which would call a long-running live pass "stale".
    const liveSet = new Set(live);
    const plan: BatchPlan = {
        ...planned,
        staleClaims: planned.staleClaims.filter((n) => !liveSet.has(n)),
        activeClaims: [...new Set([...planned.activeClaims, ...live])].sort(
            (x, y) => x - y
        ),
        deferred: planned.deferred.map((d) =>
            liveSet.has(d.number) && d.reason.startsWith("stale claim")
                ? { ...d, reason: "claimed by another session" }
                : d
        ),
    };
    const resume = resumeItems(
        resumable.map((c) => ({
            issue: c.issue,
            verdict: { state: c.state },
            pr: c.pr,
        })),
        issues,
        config,
        (n) => port.issueDetail(n).body,
        port.priority
    );
    return { plan, resume, release, live, untrusted };
}
