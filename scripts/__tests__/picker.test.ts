import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    planBatch,
    type IssueDetail,
    type PlanConfig,
    type QueueIssue,
    type QueuePort,
} from "../lib/queue-plan";
import {
    claimFate,
    type JudgedClaim,
    isTrusted,
    pick,
    type IssueProvenance,
    type PickerInput,
    type TrustPolicy,
} from "../lib/picker";

/**
 * The picker (issue #5648) is `planBatch` plus two admission facts: who wrote
 * the issue, and whether a claim has a live workflow run. Order is NOT
 * re-derived — the first block pins that to the old planner on the recorded
 * queue; the rest pin the two additions.
 */

const LIVE_QUEUE = JSON.parse(
    fs.readFileSync(
        path.resolve(__dirname, "fixtures", "queue", "live-queue.json"),
        "utf8"
    )
) as QueueIssue[];

const CONFIG: PlanConfig = {
    batchCap: 4,
    staleClaimHours: 24,
    defaultImplModel: "sonnet",
    now: "2026-08-04T12:00:00Z",
};

const TRUST: TrustPolicy = { owner: "owner", trustedAuthors: ["maintainer"] };

const BODY = [
    "## What to build",
    "",
    "Some behaviour the loop needs, described at enough length that the body is a spec rather than a title repeated twice.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] the behaviour above works end to end",
    "- [ ] a test covers it and has been proven to fail",
    "",
    "## Target files",
    "",
].join("\n");

function port(files: Record<number, string> = {}): QueuePort {
    return {
        issuesWithOpenPr: [],
        priority: {},
        issueDetail(n: number): IssueDetail {
            return {
                state: "OPEN",
                stateReason: null,
                labels: ["enhancement", "ready-for-agent"],
                body: `${BODY}- \`${files[n] ?? `src/f${n}.ts`}\`\n`,
            };
        },
        nativeBlockedBy: () => [],
    };
}

function issue(n: number, labels: string[] = ["ready-for-agent"]): QueueIssue {
    return {
        number: n,
        title: `issue ${n}`,
        labels: labels.map((name) => ({ name })),
        parent: null,
        assignees: [],
        updatedAt: CONFIG.now,
    };
}

const byOwner: IssueProvenance = { author: "owner", readyBy: null };
const stranger: IssueProvenance = { author: "stranger", readyBy: null };

function input(over: Partial<PickerInput>): PickerInput {
    return {
        issues: [],
        config: CONFIG,
        port: port(),
        trust: TRUST,
        provenance: {},
        claims: [],
        ...over,
    };
}

describe("picker — order parity with queue:plan (issue #5648)", () => {
    it("returns the same plan as planBatch on the recorded queue", () => {
        const provenance = Object.fromEntries(
            LIVE_QUEUE.map((i) => [i.number, byOwner])
        );
        const p = port();
        const expected = planBatch(LIVE_QUEUE, CONFIG, p);
        const got = pick(input({ issues: LIVE_QUEUE, provenance, port: p }));
        expect(expected.batch.length).toBeGreaterThan(0);
        expect(got.plan).toEqual(expected);
        expect(got.untrusted).toEqual([]);
    });
});

describe("picker — trusted authors (issue #5648)", () => {
    it("trusts the owner, a trusted author, and the owner's ready label", () => {
        expect(isTrusted(byOwner, TRUST)).toBe(true);
        expect(isTrusted({ author: "maintainer", readyBy: null }, TRUST)).toBe(
            true
        );
        expect(isTrusted({ author: "stranger", readyBy: "owner" }, TRUST)).toBe(
            true
        );
    });

    it("distrusts a stranger, a stranger labelled by a stranger, and unknown provenance", () => {
        expect(isTrusted(stranger, TRUST)).toBe(false);
        expect(isTrusted({ author: "stranger", readyBy: "other" }, TRUST)).toBe(
            false
        );
        expect(isTrusted({ author: null, readyBy: null }, TRUST)).toBe(false);
        expect(isTrusted(undefined, TRUST)).toBe(false);
    });

    it("skips an untrusted author's issue and plans the rest", () => {
        const got = pick(
            input({
                issues: [issue(1), issue(2), issue(3)],
                provenance: {
                    1: stranger,
                    2: byOwner,
                    3: { author: "stranger", readyBy: "owner" },
                },
            })
        );
        expect(got.untrusted).toEqual([1]);
        expect(got.plan.batch.map((b) => b.number).sort()).toEqual([2, 3]);
    });
});

describe("picker — claim fate from the one verdict (issue #6223)", () => {
    it("maps every verdict state to a fate; a missing verdict holds the claim", () => {
        const fate = (state: JudgedClaim["state"]) =>
            claimFate({ issue: 1, state, pr: null });
        expect(fate("live")).toBe("live");
        expect(fate("suspect")).toBe("live");
        expect(fate("pr-open")).toBe("live");
        expect(fate("stranded")).toBe("resume");
        expect(fate("recoverable")).toBe("resume");
        expect(fate("orphan")).toBe("release");
        expect(claimFate(undefined)).toBe("live");
    });

    it("a stranded claim is a resume pick", () => {
        const got = pick(
            input({
                issues: [
                    issue(7, ["ready-for-agent", "in-progress"]),
                    issue(8),
                ],
                provenance: { 7: byOwner, 8: byOwner },
                claims: [{ issue: 7, state: "stranded", pr: 70 }],
            })
        );
        expect(got.resume.map((r) => [r.number, r.pr, r.state])).toEqual([
            [7, 70, "stranded"],
        ]);
        expect(got.release).toEqual([]);
        expect(got.plan.batch.map((b) => b.number)).toEqual([8]);
    });

    it("an orphan claim is released, not resumed", () => {
        const got = pick(
            input({
                issues: [issue(7, ["ready-for-agent", "in-progress"])],
                provenance: { 7: byOwner },
                claims: [{ issue: 7, state: "orphan", pr: null }],
            })
        );
        expect(got.release).toEqual([7]);
        expect(got.resume).toEqual([]);
    });

    it("a live claim is held, never resumed or released", () => {
        const got = pick(
            input({
                issues: [issue(7, ["ready-for-agent", "in-progress"])],
                provenance: { 7: byOwner },
                claims: [{ issue: 7, state: "live", pr: null }],
            })
        );
        expect(got.live).toEqual([7]);
        expect(got.resume).toEqual([]);
        expect(got.release).toEqual([]);
    });

    it("a live claim older than staleClaimHours is never in staleClaims", () => {
        const old = {
            ...issue(7, ["ready-for-agent", "in-progress"]),
            updatedAt: "2026-01-01T00:00:00Z",
        };
        const got = pick(
            input({
                issues: [old],
                provenance: { 7: byOwner },
                claims: [{ issue: 7, state: "live", pr: null }],
            })
        );
        expect(got.plan.staleClaims).toEqual([]);
        expect(got.plan.activeClaims).toEqual([7]);
    });

    it("duplicate verdicts merge toward held", () => {
        for (const order of [
            ["suspect", "orphan"],
            ["orphan", "suspect"],
        ] as const) {
            const got = pick(
                input({
                    issues: [issue(7, ["ready-for-agent", "in-progress"])],
                    provenance: { 7: byOwner },
                    claims: order.map((state) => ({
                        issue: 7,
                        state,
                        pr: null,
                    })),
                })
            );
            expect(got.live).toEqual([7]);
            expect(got.release).toEqual([]);
        }
    });
});

describe("planner — in-flight overlap (issue #6195)", () => {
    const deferredFor = (plan: ReturnType<typeof planBatch>, n: number) =>
        plan.deferred.find((d) => d.number === n);

    it("defers a candidate overlapping a live claim's files, admits a disjoint one", () => {
        const got = pick(
            input({
                issues: [
                    issue(1, ["ready-for-agent", "in-progress"]),
                    issue(2),
                    issue(3),
                ],
                port: port({
                    1: "scripts/a.ts",
                    2: "scripts/a.ts",
                    3: "scripts/b.ts",
                }),
                provenance: { 1: byOwner, 2: byOwner, 3: byOwner },
                claims: [
                    { issue: 1, liveRun: true, branchPushed: false, pr: null },
                ],
            })
        );
        expect(deferredFor(got.plan, 2)).toMatchObject({
            reason: "target files overlap in-flight #1",
            conflictsWith: 1,
        });
        expect(got.plan.batch.map((b) => b.number)).toEqual([3]);
    });

    it("an open PR occupies its changed files, not its declared Target files", () => {
        const base = {
            issues: [
                issue(1, ["ready-for-agent", "in-progress"]),
                issue(2),
                issue(3),
            ],
            port: port({
                1: "scripts/a.ts",
                2: "scripts/a.ts",
                3: "scripts/pr.ts",
            }),
            provenance: { 1: byOwner, 2: byOwner, 3: byOwner },
            claims: [{ issue: 1, liveRun: true, branchPushed: true, pr: 90 }],
            prFiles: { 90: ["scripts/pr.ts"] },
        };
        const got = pick(input(base));
        expect(got.plan.batch.map((b) => b.number)).toEqual([2]);
        expect(deferredFor(got.plan, 3)?.reason).toBe(
            "target files overlap in-flight #1"
        );
    });

    it("a released claim occupies nothing", () => {
        const got = pick(
            input({
                issues: [
                    issue(1, ["ready-for-agent", "in-progress"]),
                    issue(2),
                ],
                port: port({ 1: "scripts/a.ts", 2: "scripts/a.ts" }),
                provenance: { 1: byOwner, 2: byOwner },
                claims: [
                    { issue: 1, liveRun: false, branchPushed: false, pr: null },
                ],
            })
        );
        expect(got.release).toEqual([1]);
        expect(got.plan.batch.map((b) => b.number)).toEqual([2]);
    });

    it("an unknown-radius in-flight issue occupies nothing and is named", () => {
        const noFiles: QueuePort = {
            ...port(),
            issueDetail: (n) => ({
                state: "OPEN",
                stateReason: null,
                labels: ["enhancement", "ready-for-agent"],
                body:
                    n === 1
                        ? "no files section"
                        : `${BODY}- \`src/f${n}.ts\`\n`,
            }),
        };
        const got = pick(
            input({
                issues: [
                    issue(1, ["ready-for-agent", "in-progress"]),
                    issue(2),
                ],
                port: noFiles,
                provenance: { 1: byOwner, 2: byOwner },
                claims: [
                    { issue: 1, liveRun: true, branchPushed: false, pr: null },
                ],
            })
        );
        expect(got.plan.inFlightUnknown).toEqual([1]);
        expect(got.plan.batch.map((b) => b.number)).toEqual([2]);
    });

    it("a candidate is never deferred by its own in-flight entry", () => {
        const plan = planBatch(
            [issue(5)],
            { ...CONFIG, inFlight: [{ number: 5, files: ["scripts/a.ts"] }] },
            port({ 5: "scripts/a.ts" })
        );
        expect(plan.batch.map((b) => b.number)).toEqual([5]);
    });

    it("append-only paths in flight do not occupy", () => {
        const plan = planBatch(
            [issue(2)],
            {
                ...CONFIG,
                inFlight: [{ number: 1, files: ["convex/cards/index.ts"] }],
            },
            port({ 2: "convex/cards/index.ts" })
        );
        expect(plan.batch.map((b) => b.number)).toEqual([2]);
    });
});

describe("picker — in-flight edge cases (issue #6195)", () => {
    it("an unlabelled issue with an open PR occupies the PR's files", () => {
        const got = pick(
            input({
                issues: [issue(2)],
                port: port({ 1: "scripts/a.ts", 2: "scripts/pr.ts" }),
                provenance: { 2: byOwner },
                prByIssue: { 1: 90 },
                prFiles: { 90: ["scripts/pr.ts"] },
            })
        );
        expect(got.plan.batch).toEqual([]);
        expect(got.plan.deferred[0].reason).toBe(
            "target files overlap in-flight #1"
        );
    });

    it("a claimed issue with no claim facts occupies its declared files", () => {
        const got = pick(
            input({
                issues: [
                    issue(1, ["ready-for-agent", "in-progress"]),
                    issue(2),
                ],
                port: port({ 1: "scripts/a.ts", 2: "scripts/a.ts" }),
                provenance: { 1: byOwner, 2: byOwner },
            })
        );
        expect(got.plan.batch).toEqual([]);
    });
});
