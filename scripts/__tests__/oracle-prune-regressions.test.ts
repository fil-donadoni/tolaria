import { describe, expect, it } from "vitest";
import { prunedLedgerText } from "../oracle-prune-regressions";
import { parseRegressionLedger } from "../lib/oracle-state-regressions";

// `oracle:prune-regressions` (issue #6061): the pure core — ledger text in,
// ledger text out. The commit/push path is `commitAndPushAllowlist`'s, proven
// by gaps-sync's own tests; `land.test.ts` pins the commit subject.

const TEXT = `${JSON.stringify(
    {
        note: "kept",
        acknowledged: [
            { oracleId: "id-a", name: "A", reason: "r", trackedBy: 1 },
            { oracleId: "id-b", name: "B", reason: "r", intended: true },
        ],
    },
    null,
    4
)}\n`;

describe("prunedLedgerText", () => {
    it("returns the input untouched when every entry still covers a regression", () => {
        const live = [
            { oracleId: "id-a", name: "A", to: "quarantine" as const },
            { oracleId: "id-b", name: "B", to: "absent" as const },
        ];
        expect(prunedLedgerText(TEXT, live)).toBe(TEXT);
    });

    it("drops the stale entries and keeps the note and the live ones", () => {
        const next = prunedLedgerText(TEXT, [
            { oracleId: "id-b", name: "B", to: "absent" },
        ]);
        expect(JSON.parse(next).note).toBe("kept");
        expect(
            parseRegressionLedger(next).acknowledged.map((a) => a.name)
        ).toEqual(["B"]);
    });

    it("empties the ledger after a landing (no regression vs base)", () => {
        expect(
            parseRegressionLedger(prunedLedgerText(TEXT, [])).acknowledged
        ).toEqual([]);
    });
});
