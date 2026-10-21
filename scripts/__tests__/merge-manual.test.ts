import { describe, expect, it } from "vitest";
import {
    latestAdvisoryLane,
    manualMergeVerdict,
    type CheckRunView,
    type ManualMergeInput,
} from "../lib/merge-manual";

// Issue #6238: PR #6218 (a `merge:manual` PR) was rebased onto a new guard
// and merged by hand 80 s later, its advisory lane still running; the lane
// went red on that guard and the base tip went RED. The manual merge is
// admitted only on a green lane over the up-to-date head.

const HEAD = "5758b50b79706e45df368a5eed4f7954b8d64f80";
const lane = (over: Partial<CheckRunView> = {}): CheckRunView => ({
    id: 1,
    name: "check:lane (advisory)",
    headSha: HEAD,
    status: "completed",
    conclusion: "success",
    ...over,
});
const input = (over: Partial<ManualMergeInput> = {}): ManualMergeInput => ({
    state: "OPEN",
    labels: ["ready-to-land", "merge:manual"],
    headSha: HEAD,
    behindBy: 0,
    checkRuns: [lane()],
    ...over,
});

describe("merge-manual — manualMergeVerdict", () => {
    it("admits a labelled, up-to-date PR whose lane is green on its head", () => {
        expect(manualMergeVerdict(input())).toEqual({ kind: "merge" });
    });

    it("refuses while the lane is still running (the PR #6218 shape)", () => {
        const v = manualMergeVerdict(
            input({
                checkRuns: [lane({ status: "in_progress", conclusion: null })],
            })
        );
        expect(v).toMatchObject({
            kind: "refuse",
            reason: /still in_progress/,
        });
    });

    it("refuses a red lane", () => {
        const v = manualMergeVerdict(
            input({ checkRuns: [lane({ conclusion: "failure" })] })
        );
        expect(v.kind).toBe("refuse");
    });

    it("refuses with no lane run on the head — a green run on an older head does not count", () => {
        const v = manualMergeVerdict(
            input({ checkRuns: [lane({ headSha: "0".repeat(40) })] })
        );
        expect(v.kind).toBe("refuse");
    });

    it("refuses a head the base has moved past, even with a green lane", () => {
        expect(manualMergeVerdict(input({ behindBy: 1 })).kind).toBe("refuse");
    });

    it("refuses a queue PR (no merge:manual label)", () => {
        expect(
            manualMergeVerdict(input({ labels: ["ready-to-land"] })).kind
        ).toBe("refuse");
    });

    it("refuses a PR that is not open", () => {
        expect(manualMergeVerdict(input({ state: "MERGED" })).kind).toBe(
            "refuse"
        );
    });
});

describe("merge-manual — latestAdvisoryLane", () => {
    it("a re-run supersedes the earlier run on the same head", () => {
        const runs = [
            lane({ id: 7, conclusion: "failure" }),
            lane({ id: 9, conclusion: "success" }),
            lane({ id: 8, conclusion: "failure" }),
            lane({ id: 99, name: "scenario" }),
        ];
        expect(latestAdvisoryLane(runs, HEAD)?.id).toBe(9);
        expect(manualMergeVerdict(input({ checkRuns: runs })).kind).toBe(
            "merge"
        );
        const redRerun = [
            lane({ id: 7 }),
            lane({ id: 8, conclusion: "failure" }),
        ];
        expect(manualMergeVerdict(input({ checkRuns: redRerun })).kind).toBe(
            "refuse"
        );
    });
});
