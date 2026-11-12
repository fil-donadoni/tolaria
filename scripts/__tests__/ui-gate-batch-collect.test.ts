import { describe, it, expect } from "vitest";
import {
    ciExit,
    heldMarker,
    owedFrom,
    planCollect,
    summaryRows,
} from "../ui-gate/batch-collect.ts";

// Issue #9122: the collector's per-PR decision after one batch walk.
describe("planCollect", () => {
    it("lands the clean PRs, fails only the red one with its cells", () => {
        const actions = planCollect({
            clean: [10, 12],
            red: new Map([[11, ["board@desktop: stranded 2"]]]),
            dropped: [],
            unproven: [],
        });
        expect(
            actions.filter((a) => a.kind === "land").map((a) => a.pr)
        ).toEqual([10, 12]);
        const fail = actions.find((a) => a.kind === "fail");
        expect(fail?.pr).toBe(11);
        expect(fail && "comment" in fail && fail.comment).toContain(
            "board@desktop: stranded 2"
        );
    });

    it("holds DROPPED and UNPROVEN PRs with a comment saying why", () => {
        const actions = planCollect({
            clean: [],
            red: new Map(),
            dropped: [
                { pr: 20, reason: "its head conflicts with the batch so far" },
            ],
            unproven: [21],
        });
        expect(actions.map((a) => [a.kind, a.pr])).toEqual([
            ["hold", 20],
            ["hold", 21],
        ]);
        expect(actions[0]).toMatchObject({
            comment: expect.stringContaining("DROPPED"),
        });
        expect(actions[1]).toMatchObject({
            comment: expect.stringContaining("UNPROVEN"),
        });
    });
});

// Issue #9210: a DROPPED PR's comment says why the batch dropped it.
describe("planCollect — drop reasons (issue #9210)", () => {
    it("names each DROPPED PR's own reason", () => {
        const actions = planCollect({
            clean: [],
            red: new Map(),
            dropped: [
                {
                    pr: 40,
                    reason: "its scope is full (src/index.css is a stylesheet); it cannot ride a SCOPED walk",
                },
                {
                    pr: 41,
                    reason: "its head conflicts with the batch so far; walk it alone or in another batch",
                },
                {
                    pr: 42,
                    reason: "CLOSED, base main (a batch merges open PRs against staging)",
                },
            ],
            unproven: [],
        });
        expect(actions.map((a) => a.kind === "hold" && a.comment)).toEqual([
            expect.stringContaining("src/index.css is a stylesheet"),
            expect.stringContaining("conflicts with the batch"),
            expect.stringContaining("CLOSED, base main"),
        ]);
    });
});

// Issue #9264: the scheduled collector — which PRs a tick owes, and what an
// infra exit does to the workflow.
describe("owedFrom — a held head is not re-walked (issue #9264)", () => {
    it("skips a PR held at its current head, keeps one pushed since", () => {
        expect(
            owedFrom([
                {
                    number: 52,
                    headRefOid: "bbb",
                    comments: [{ body: `held\n\n${heldMarker("aaa")}` }],
                },
                {
                    number: 51,
                    headRefOid: "aaa",
                    comments: [{ body: `held\n\n${heldMarker("aaa")}` }],
                },
                { number: 50, headRefOid: "ccc", comments: [] },
            ])
        ).toEqual([50, 52]);
    });
});

describe("ciExit — INFRA never reds the workflow (issue #9264)", () => {
    it("turns an unsettled deployment-down, skew or 77 exit into 0", () => {
        expect([3, 4, 77].map((c) => ciExit(c, false))).toEqual([0, 0, 0]);
    });
    it("keeps a red batch, a usage error and any settled exit", () => {
        expect(ciExit(1, true)).toBe(1);
        expect(ciExit(2, false)).toBe(2);
        expect(ciExit(3, true)).toBe(3);
    });
});

describe("summaryRows — the run's per-PR record (issue #9264)", () => {
    it("names every PR with its batch verdict", () => {
        expect(
            summaryRows({
                clean: [60],
                red: new Map([[61, ["x"]]]),
                dropped: [{ pr: 62, reason: "conflict" }],
                unproven: [63],
            }).slice(2)
        ).toEqual([
            "| #60 | CLEAN |",
            "| #61 | RED |",
            "| #62 | DROPPED — conflict |",
            "| #63 | UNPROVEN |",
        ]);
    });
});
