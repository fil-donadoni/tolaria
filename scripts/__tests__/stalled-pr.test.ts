import { describe, it, expect } from "vitest";
import {
    DEFAULT_STALLED_PR_HOURS,
    inFlightSet,
    parseStalledPrHours,
    stalledPrLine,
    stalledPrsOf,
    type IssueDetail,
    type OpenPrFact,
    type PlanConfig,
    type QueueIssue,
    type QueuePort,
} from "../lib/queue-plan";
import { pick, type PickerInput } from "../lib/picker";

/**
 * A stalled PR warns instead of occupying files (issue #8258). Open, not in
 * the queue, head unmoved past the threshold, no live pass: all three.
 */

const NOW = "2026-11-05T12:00:00Z";
const hoursAgo = (h: number) =>
    new Date(Date.parse(NOW) - h * 3_600_000).toISOString();

const CONFIG: PlanConfig = {
    batchCap: 4,
    staleClaimHours: 24,
    defaultImplModel: "sonnet",
    stalledPrHours: 6,
    now: NOW,
};

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
    "- `scripts/pr.ts`",
    "",
].join("\n");

const port: QueuePort = {
    issuesWithOpenPr: [],
    priority: {},
    issueDetail: (): IssueDetail => ({
        state: "OPEN",
        stateReason: null,
        labels: ["enhancement", "ready-for-agent"],
        body: BODY,
    }),
    nativeBlockedBy: () => [],
};

const issue = (n: number, labels = ["ready-for-agent"]): QueueIssue => ({
    number: n,
    title: `issue ${n}`,
    labels: labels.map((name) => ({ name })),
    parent: null,
    assignees: [],
    updatedAt: NOW,
});

const fact = (over: Partial<OpenPrFact> = {}): OpenPrFact => ({
    number: 90,
    issue: 1,
    labels: [],
    files: ["scripts/pr.ts"],
    headCommittedAt: hoursAgo(10),
    ...over,
});

function run(over: Partial<PickerInput>) {
    return pick({
        issues: [issue(2)],
        config: CONFIG,
        port,
        trust: { owner: "o", trustedAuthors: [] },
        provenance: {
            1: { author: "o", readyBy: null },
            2: { author: "o", readyBy: null },
        },
        claims: [],
        prByIssue: { 1: 90 },
        prFiles: { 90: ["scripts/pr.ts"] },
        prFacts: [fact()],
        ...over,
    });
}

describe("stalled PR — occupies nothing (issue #8258)", () => {
    it("a candidate overlapping only a stalled PR is admitted, and the PR is named", () => {
        const got = run({});
        expect(got.plan.batch.map((b) => b.number)).toEqual([2]);
        expect(got.plan.stalledPrs).toEqual([
            { pr: 90, issue: 1, hoursStalled: 10, overlapping: [2] },
        ]);
    });

    it("a PR under the threshold still occupies its files", () => {
        const got = run({ prFacts: [fact({ headCommittedAt: hoursAgo(2) })] });
        expect(got.plan.batch).toEqual([]);
        expect(got.plan.deferred[0].reason).toBe(
            "target files overlap in-flight #1"
        );
        expect(got.plan.stalledPrs).toBeUndefined();
    });

    it.each(["ready-to-land", "land-failed"])(
        "a PR labelled %s still occupies its files",
        (label) => {
            const got = run({ prFacts: [fact({ labels: [label] })] });
            expect(got.plan.batch).toEqual([]);
            expect(got.plan.stalledPrs).toBeUndefined();
        }
    );

    it("a PR whose issue has a live pass still occupies its files", () => {
        const got = run({
            issues: [issue(1, ["ready-for-agent", "in-progress"]), issue(2)],
            claims: [{ issue: 1, state: "pr-open", pr: 90 }],
        });
        expect(got.plan.batch).toEqual([]);
        expect(got.plan.stalledPrs).toBeUndefined();
    });

    it("an unreadable head date reads as not stalled (fail closed)", () => {
        const got = run({ prFacts: [fact({ headCommittedAt: null })] });
        expect(got.plan.batch).toEqual([]);
        expect(
            stalledPrsOf(
                [fact({ headCommittedAt: "garbage" })],
                new Set(),
                NOW,
                6
            )
        ).toEqual([]);
    });

    it("no threshold, no rule", () => {
        const got = run({ config: { ...CONFIG, stalledPrHours: undefined } });
        expect(got.plan.batch).toEqual([]);
    });

    it("inFlightSet leaves a stalled PR's claim out", () => {
        const claims = [{ issue: 1, pr: 90 }];
        const files = { 90: ["scripts/pr.ts"] };
        expect(inFlightSet(claims, files, () => BODY)).toHaveLength(1);
        expect(
            inFlightSet(claims, files, () => BODY, {}, new Set([90]))
        ).toEqual([]);
    });
});

describe("stalled PR — threshold and text (issue #8258)", () => {
    it("reads queuePlan.stalledPrHours, else 6", () => {
        expect(parseStalledPrHours({ queuePlan: { stalledPrHours: 3 } })).toBe(
            3
        );
        expect(parseStalledPrHours({})).toBe(DEFAULT_STALLED_PR_HOURS);
        expect(DEFAULT_STALLED_PR_HOURS).toBe(6);
        expect(parseStalledPrHours({ queuePlan: { stalledPrHours: -1 } })).toBe(
            6
        );
        expect(parseStalledPrHours(null)).toBe(6);
    });

    it("the tolaria.config.json default is the documented 6", async () => {
        const doc = (await import("../../tolaria.config.json")).default;
        expect(parseStalledPrHours(doc)).toBe(6);
        expect(doc.queuePlan.stalledPrHours).toBe(6);
    });

    it("the line names PR, issue, hours and overlapping candidates", () => {
        expect(
            stalledPrLine({
                pr: 90,
                issue: 1,
                hoursStalled: 10,
                overlapping: [2, 3],
            })
        ).toBe(
            "stalled PR #90 (issue #1): head unmoved 10 h, occupies nothing — 2 candidate(s) overlap it (#2, #3)"
        );
    });
});
