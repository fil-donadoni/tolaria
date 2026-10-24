// Issue #6553: a base push that merges a declared repair of the standing RED
// is told apart from an ordinary push (health-early's `classify`).
import { describe, expect, it } from "vitest";
import {
    issuesClosedBy,
    mergesDeclaredRepair,
} from "../lib/health-repair-merge";

describe("mergesDeclaredRepair", () => {
    it("is true when a merged PR closes a declared repair issue", () => {
        expect(mergesDeclaredRepair([6540, 6541], [12, 6541])).toBe(true);
    });
    it("is false when no declared repair exists", () => {
        expect(mergesDeclaredRepair([], [6541])).toBe(false);
    });
    it("is false when the merged PRs close other issues", () => {
        expect(mergesDeclaredRepair([6540], [6000])).toBe(false);
    });
});

describe("issuesClosedBy", () => {
    it("collects the issues every PR of the commit closes", () => {
        process.env.GH_REPO = "o/r";
        const calls: string[][] = [];
        const run = (args: string[]) => {
            calls.push(args);
            if (args[0] === "api") return "7\n8\n";
            return args[2] === "7" ? "100\n" : "";
        };
        expect(issuesClosedBy("/tmp", "a".repeat(40), run)).toEqual([100]);
        expect(calls).toHaveLength(3);
    });
});
