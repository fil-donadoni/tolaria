import { describe, it, expect } from "vitest";
import {
    REPAIR_ROUND_CAP,
    cappedRepairPrs,
    cappedUiReceiptPrs,
    uiReceiptRounds,
    UI_RECEIPT_CLASS,
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

// PR #7510's comment timeline, 2026-10-30: 15 `check:ui` failure comments, one
// per walk, at 8 distinct heads. Each repair pass pushed a new head.
const PR_7510_HEADS = [
    "65476a56e",
    "65476a56e",
    "65476a56e",
    "287a2a0bd",
    "287a2a0bd",
    "354e7a7a5",
    "7bc543b42",
    "7bc543b42",
    "7bc543b42",
    "bb911ecf5",
    "bb911ecf5",
    "05ec79365",
    "5e10d4e66",
    "5e10d4e66",
    "712cf8556",
];
const failComment = (sha: string) =>
    `### check:ui — 7 failing cell(s) at ${sha}\n\nEach shot outlines the boxes that broke a Floor.`;
const PR_7510 = PR_7510_HEADS.map(failComment);

describe("repair cap — ui-receipt class (issue #7649)", () => {
    it("counts one round per failing head, not per comment", () => {
        expect(PR_7510).toHaveLength(15);
        expect(uiReceiptRounds(PR_7510)).toBe(8);
        expect(uiReceiptRounds(["unrelated", "### check:ui — all green"])).toBe(
            0
        );
    });

    it("names ui-receipt as a class beside the label-event classes", () => {
        expect(
            failureClasses([
                ...PR_7510.slice(0, 1),
                "**land-runner** — labelled `land-failed`.\nClass: `needs-pass`",
            ])
        ).toEqual(["needs-pass", UI_RECEIPT_CLASS]);
    });

    it("caps PR #7510 at round three, with no land-failed label event", () => {
        const list =
            (heads: string[], labels: string[] = []) =>
            () => [
                {
                    number: 7510,
                    labels: labels.map((name) => ({ name })),
                    comments: heads.map((h) => ({ body: failComment(h) })),
                },
            ];
        const two = ["65476a56e", "287a2a0bd"];
        expect([...cappedUiReceiptPrs("o/r", list(two))]).toEqual([]);
        expect([
            ...cappedUiReceiptPrs("o/r", list([...two, "354e7a7a5"])),
        ]).toEqual([[7510, 3]]);
        expect([...cappedUiReceiptPrs("o/r", list(PR_7510_HEADS))]).toEqual([
            [7510, 8],
        ]);
        // already handed to its human: not re-escalated
        expect([
            ...cappedUiReceiptPrs(
                "o/r",
                list(PR_7510_HEADS, ["ready-for-human"])
            ),
        ]).toEqual([]);
    });

    it("an unreadable list caps nothing", () => {
        expect([
            ...cappedUiReceiptPrs("o/r", () => {
                throw new Error("rate limit");
            }),
        ]).toEqual([]);
    });

    it("the escalation comment names the ui-receipt rounds", () => {
        const c = escalationComment({
            failures: 0,
            classes: [UI_RECEIPT_CLASS],
            uiRounds: 3,
        });
        expect(c).toContain("repair cap reached");
        expect(c).toContain("`ui-receipt`");
    });

    it("an unclassified land-failed failure still counts toward the cap", () => {
        expect(failureClasses(["labelled `land-failed`."])).toEqual([
            "unclassified",
        ]);
        expect(repairCapReached(4)).toBe(true);
    });
});
