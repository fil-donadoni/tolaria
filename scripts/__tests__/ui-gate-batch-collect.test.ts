import { describe, it, expect } from "vitest";
import { planCollect } from "../ui-gate/batch-collect.ts";

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
