// Issue #4928 — an issue filed while working another inherits its band.
import { describe, expect, it } from "vitest";
import { planInheritance, type InheritDeps } from "../issue-inherit-band";
import type { BoardPriority } from "../lib/board-priority";
import type { ParentEdge } from "../lib/origin-band";

function deps(
    board: Record<number, BoardPriority>,
    parents: Record<number, ParentEdge> = {}
): InheritDeps {
    return {
        readParent: (issue) => parents[issue] ?? null,
        readBoard: () => board,
        readOwn: (issue) => board[issue] ?? null,
    };
}

describe("issue:inherit-band (issue #4928)", () => {
    it("copies the worked issue's own band, P0 included", () => {
        expect(planInheritance(4896, 4917, deps({ 4896: "P0" }))).toEqual({
            kind: "write",
            band: "P0",
        });
    });

    it("copies the band the queue orders by: an open umbrella's governs", () => {
        const plan = planInheritance(
            10,
            11,
            deps({ 10: "P0", 1: "P1" }, { 10: { number: 1, state: "OPEN" } })
        );
        expect(plan).toEqual({ kind: "write", band: "P1" });
    });

    it("a CLOSED umbrella does not govern: the worked issue's own band", () => {
        const plan = planInheritance(
            10,
            11,
            deps({ 10: "P1", 1: "P0" }, { 10: { number: 1, state: "CLOSED" } })
        );
        expect(plan).toEqual({ kind: "write", band: "P1" });
    });

    it("refuses when the worked issue has no band", () => {
        const plan = planInheritance(10, 11, deps({}));
        expect(plan.kind).toBe("refuse");
    });

    it("never overwrites a band already set on the new issue", () => {
        const plan = planInheritance(10, 11, deps({ 10: "P0", 11: "P2" }));
        expect(plan).toMatchObject({ kind: "refuse" });
        expect((plan as { reason: string }).reason).toContain("P2");
    });

    it("refuses on an unreadable board instead of guessing", () => {
        const plan = planInheritance(10, 11, {
            ...deps({}),
            readBoard: () => {
                throw new Error("no read:project scope");
            },
        });
        expect(plan).toMatchObject({ kind: "refuse" });
    });

    it("refuses inheriting from itself", () => {
        expect(planInheritance(10, 10, deps({ 10: "P0" })).kind).toBe("refuse");
    });
});
