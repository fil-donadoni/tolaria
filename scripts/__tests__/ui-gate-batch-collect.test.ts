import { describe, it, expect } from "vitest";
import {
    applyAction,
    ciExit,
    collectSummary,
    type CollectIo,
    type LandRefusal,
    heldMarker,
    owedFrom,
    partitionOwed,
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
            base: "b",
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
            base: "b",
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
            base: "b",
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
            owedFrom(
                [
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
                ],
                "base1"
            )
        ).toEqual([50, 52]);
    });

    it("retries a transient hold (conflict, fetch error, UNPROVEN) once the base moves", () => {
        const pr = {
            number: 70,
            headRefOid: "aaa",
            comments: [{ body: `held\n\n${heldMarker("aaa", "base1")}` }],
        };
        expect(owedFrom([pr], "base1")).toEqual([]);
        expect(owedFrom([pr], "base2")).toEqual([70]);
    });
});

// Issue #10059: a held PR is listed with its hold, never reported as absent.
describe("partitionOwed / collectSummary — a held PR is named (issue #10059)", () => {
    const fullDrop = {
        number: 9930,
        headRefOid: "fe5b48c542b8832653436e411e0041687bee3a7a",
        comments: [
            {
                body: `check:ui batch walk: #9930 was DROPPED — its scope is full (src/index.css is a stylesheet).\n\n${heldMarker("fe5b48c542b8832653436e411e0041687bee3a7a")}`,
            },
        ],
    };
    const conflict = {
        number: 71,
        headRefOid: "aaa",
        comments: [
            {
                body: `check:ui batch walk: #71 was DROPPED — its head conflicts.\n\n${heldMarker("aaa", "base1")}`,
            },
        ],
    };

    it("splits owed from held, with each hold's kind and reason", () => {
        expect(
            partitionOwed(
                [
                    fullDrop,
                    conflict,
                    { number: 50, headRefOid: "c", comments: [] },
                ],
                "base1"
            )
        ).toEqual({
            owed: [50],
            held: [
                {
                    pr: 71,
                    head: "aaa",
                    until: "base",
                    reason: "#71 was DROPPED — its head conflicts.",
                },
                {
                    pr: 9930,
                    head: fullDrop.headRefOid,
                    until: "push",
                    reason: "#9930 was DROPPED — its scope is full (src/index.css is a stylesheet).",
                },
            ],
        });
    });

    it("with every PR held, names them instead of 'no open ui-owed PR'", () => {
        const { owed, held } = partitionOwed([fullDrop], "base1");
        const lines = collectSummary(owed, held);
        expect(lines[0]).toBe(
            "collect: no PR owed — 1 ui-owed PR(s) held: #9930"
        );
        expect(lines[1]).toBe(
            "  · #9930 held at fe5b48c542b8 until a new push: #9930 was DROPPED — its scope is full (src/index.css is a stylesheet)."
        );
        expect(lines.join("\n")).not.toContain("no open ui-owed PR");
    });

    it("says 'no open ui-owed PR' only when none is listed", () => {
        expect(collectSummary([], [])).toEqual(["collect: no open ui-owed PR"]);
        expect(collectSummary([50, 52], [])).toEqual([
            "collect: 2 PR(s) owed: #50 #52",
        ]);
    });
});

describe("planCollect — which holds wait for a push (issue #9264)", () => {
    it("marks only a drop that is the head's own as intrinsic", () => {
        const actions = planCollect({
            clean: [],
            red: new Map(),
            dropped: [
                { pr: 80, reason: "its scope is full", intrinsic: true },
                { pr: 81, reason: "its head conflicts with the batch so far" },
            ],
            unproven: [82],
            base: "b",
        });
        expect(
            actions.map((a) => a.kind === "hold" && [a.pr, a.intrinsic])
        ).toEqual([
            [80, true],
            [81, false],
            [82, false],
        ]);
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
                base: "b",
            }).slice(2)
        ).toEqual([
            "| #60 | CLEAN |",
            "| #61 | RED |",
            "| #62 | DROPPED — conflict |",
            "| #63 | UNPROVEN |",
        ]);
    });
});

// Issue #10010: a CLEAN walk whose `land:ready` refuses must leave the PR a
// repair pick (`land-failed`), never unlabelled — no consumer reads that.
describe("applyAction — a refused hand-off is a repair pick (issue #10010)", () => {
    const run = (
        action: Parameters<typeof applyAction>[0],
        refusal: LandRefusal | null
    ) => {
        const calls: string[][] = [];
        const io: CollectIo = {
            gh: (args) => {
                calls.push(args);
                return "";
            },
            land: () => refusal,
        };
        applyAction(action, new Map(), "b", () => {}, io);
        const labels = calls
            .filter((c) => c[1] === "edit")
            .map((c) => c.slice(3).join(" "));
        const comments = calls
            .filter((c) => c[1] === "comment")
            .map((c) => c[4]);
        return { labels, comments };
    };

    it("labels a CLEAN PR whose land:ready refuses land-failed, ui-owed off, refusal commented", () => {
        const { labels, comments } = run(
            { kind: "land", pr: 9815 },
            {
                output: "✗ land tooling is stale: base changed scripts/**",
                infra: false,
            }
        );
        expect(labels).toEqual([
            "--remove-label ui-owed",
            "--add-label land-failed",
        ]);
        expect(comments).toHaveLength(1);
        expect(comments[0]).toContain("land tooling is stale");
        expect(comments[0]).not.toContain("INFRA");
    });

    it("labels a checkout / worktree:init failure land-failed, its comment naming INFRA", () => {
        const { labels, comments } = run(
            { kind: "land", pr: 90 },
            { output: "worktree:init failed", infra: true }
        );
        expect(labels).toEqual([
            "--remove-label ui-owed",
            "--add-label land-failed",
        ]);
        expect(comments[0]).toContain("INFRA: worktree:init failed");
    });

    it("adds no land-failed when land:ready hands the CLEAN PR off", () => {
        const { labels, comments } = run({ kind: "land", pr: 91 }, null);
        expect(labels).toEqual(["--remove-label ui-owed"]);
        expect(comments).toEqual([]);
    });

    it("keeps a RED walk's labelling: ui-owed off, land-failed on, red lines commented", () => {
        const { labels, comments } = run(
            {
                kind: "fail",
                pr: 92,
                comment: "check:ui batch walk: RED",
                partners: [],
            },
            null
        );
        expect(labels).toEqual([
            "--remove-label ui-owed",
            "--add-label land-failed",
        ]);
        expect(comments).toEqual(["check:ui batch walk: RED"]);
    });
});
