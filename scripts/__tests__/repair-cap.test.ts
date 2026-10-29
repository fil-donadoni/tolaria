import { describe, it, expect } from "vitest";
import {
    REPAIR_ROUND_CAP,
    cappedRepairPrs,
    escalationComment,
    failureClasses,
    repairCapReached,
    repairsTried,
} from "../lib/repair-cap";
import { repairItems, type PlanConfig } from "../lib/queue-plan";

const CONFIG = {
    batchCap: 1,
    staleClaimHours: 24,
    defaultImplModel: "sonnet",
    now: "2026-10-26T00:00:00Z",
} as PlanConfig;

describe("repair cap — rounds (issue #6649)", () => {
    it("counts the repairs already tried: N failures = N - 1", () => {
        expect(repairsTried(0)).toBe(0);
        expect(repairsTried(1)).toBe(0);
        expect(repairsTried(4)).toBe(3);
    });

    it("caps on the failure that follows the third repair", () => {
        expect(REPAIR_ROUND_CAP).toBe(3);
        expect(repairCapReached(3)).toBe(false);
        expect(repairCapReached(4)).toBe(true);
    });

    it("names the failure classes seen, once each", () => {
        expect(
            failureClasses([
                "**merge queue: dequeued (`queue_rule_not_satisfied`)** — labelled `land-failed`.",
                "**merge queue: dequeued (`queue_rule_not_satisfied`)** — labelled `land-failed`.",
                "**land-runner** — labelled `land-failed`.\nClass: `needs-pass`",
                "unrelated chatter",
            ])
        ).toEqual(["needs-pass", "queue_rule_not_satisfied"]);
        expect(escalationComment({ failures: 4, classes: ["a"] })).toContain(
            "`a`"
        );
    });

    it("cappedRepairPrs caps past the third repair and never on an unreadable count", () => {
        const counts: Record<number, number | null> = { 1: 3, 2: 4, 3: null };
        expect([
            ...cappedRepairPrs(
                "o/r",
                [{ number: 1 }, { number: 2 }, { number: 3 }],
                (_s, pr) => counts[pr]
            ),
        ]).toEqual([[2, 4]]);
    });

    it("repairItems stops offering a capped PR", () => {
        const prs = [
            { number: 10, headRefName: "feat/issue-100" },
            { number: 11, headRefName: "feat/issue-101" },
        ];
        const detail = () => ({ labels: [], body: "" });
        expect(
            repairItems(prs, detail, CONFIG, new Set(), new Set([10])).map(
                (r) => r.pr
            )
        ).toEqual([11]);
        expect(repairItems(prs, detail, CONFIG).map((r) => r.pr)).toEqual([
            10, 11,
        ]);
    });
});
