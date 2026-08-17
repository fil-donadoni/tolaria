import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
    RECEIPT_VERSION,
    parseReceipt,
    readReceipts,
    type ReviewReceipt,
} from "../lib/receipt";

/**
 * Issue #2285: `reviewer-brief.md` told the reviewer subagent the SHAPE of a
 * verdict receipt in prose and let it hand-author the JSON. 4/4 review
 * receipts in the batch that surfaced this were malformed (missing
 * `version`, or `findings` as objects instead of strings) while 4/4
 * implement/fixup receipts — governed by a brief that names `writeReceipt` —
 * were valid. A prose field-list is not a validator; a callable entry point
 * is. `scripts/write-review-receipt.ts` is that entry point: it is the only
 * thing `reviewer-brief.md` now tells a reviewer to run, and this suite
 * proves the entry point itself enforces the contract rather than just
 * describing it.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "scripts", "write-review-receipt.ts");

let tmp: string;
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-review-receipt-"));
});

function run(args: string[]) {
    return spawnSync("bun", [CLI, ...args], {
        cwd: tmp,
        encoding: "utf8",
    });
}

describe("write-review-receipt CLI produces what parseReceipt accepts", () => {
    it("writes a valid approve receipt with no findings required", () => {
        const result = run([
            "--batch",
            "batch-1",
            "--issue",
            "2285",
            "--pr",
            "9001",
            "--outcome",
            "approve",
        ]);
        expect(result.status, result.stderr).toBe(0);

        const { receipts, errors } = readReceipts(tmp, "batch-1");
        expect(errors).toEqual([]);
        expect(receipts).toHaveLength(1);
        const receipt = receipts[0] as ReviewReceipt;
        expect(receipt.version).toBe(RECEIPT_VERSION);
        expect(receipt.role).toBe("review");
        expect(receipt.outcome).toBe("approve");
        expect(receipt.issue).toBe(2285);
        expect(receipt.pr).toBe(9001);
        expect(receipt.findings).toEqual([]);
    });

    it("writes a valid blocking receipt, findings always as plain strings", () => {
        const result = run([
            "--batch",
            "batch-1",
            "--issue",
            "2285",
            "--pr",
            "9001",
            "--outcome",
            "blocking",
            "--finding",
            "convex/gre/search.ts:709 (medium) — eternalize is never chosen by search.",
            "--finding",
            "second finding, one prose line",
        ]);
        expect(result.status, result.stderr).toBe(0);

        const { receipts, errors } = readReceipts(tmp, "batch-1");
        expect(errors).toEqual([]);
        const receipt = receipts[0] as ReviewReceipt;
        expect(receipt.outcome).toBe("blocking");
        expect(receipt.findings).toEqual([
            "convex/gre/search.ts:709 (medium) — eternalize is never chosen by search.",
            "second finding, one prose line",
        ]);
        // Every element is a plain string — the CLI has no argument shape that
        // could produce `{ id, severity, ... }` objects.
        for (const f of receipt.findings) expect(typeof f).toBe("string");
    });

    it("refuses a blocking verdict with no findings — the contract, not loosened", () => {
        const result = run([
            "--batch",
            "batch-1",
            "--issue",
            "2285",
            "--pr",
            "9001",
            "--outcome",
            "blocking",
        ]);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(
            /blocking verdict must list at least one finding/
        );
        // Nothing was written — a rejected call must not leave a half-formed
        // receipt for readReceipts to trip over later.
        const { receipts } = readReceipts(tmp, "batch-1");
        expect(receipts).toEqual([]);
    });

    it("rejects an unknown outcome before ever calling writeReceipt", () => {
        const result = run([
            "--batch",
            "batch-1",
            "--issue",
            "2285",
            "--pr",
            "9001",
            "--outcome",
            "approved", // typo, not the enum value
        ]);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/--outcome must be/);
    });

    it("writes a second round beside the first instead of colliding with it", () => {
        expect(
            run([
                "--batch",
                "batch-1",
                "--issue",
                "2285",
                "--pr",
                "9001",
                "--outcome",
                "blocking",
                "--finding",
                "first pass finding",
            ]).status
        ).toBe(0);

        const roundTwo = run([
            "--batch",
            "batch-1",
            "--issue",
            "2285",
            "--pr",
            "9001",
            "--outcome",
            "approve",
            "--round",
            "2",
        ]);
        expect(roundTwo.status, roundTwo.stderr).toBe(0);

        const { receipts, errors } = readReceipts(tmp, "batch-1");
        expect(errors).toEqual([]);
        expect(receipts).toHaveLength(2);
        const round1 = receipts.find(
            (r) =>
                r.role === "review" && (r as ReviewReceipt).round === undefined
        ) as ReviewReceipt;
        const round2 = receipts.find(
            (r) => r.role === "review" && (r as ReviewReceipt).round === 2
        ) as ReviewReceipt;
        expect(round1.outcome).toBe("blocking");
        expect(round2.outcome).toBe("approve");
        expect(
            fs.existsSync(
                path.join(tmp, ".claude/receipts/batch-1/2285-review.json")
            )
        ).toBe(true);
        expect(
            fs.existsSync(
                path.join(tmp, ".claude/receipts/batch-1/2285-review-2.json")
            )
        ).toBe(true);
    });

    it("refuses to overwrite an existing round — the append-only guarantee holds", () => {
        expect(
            run([
                "--batch",
                "batch-1",
                "--issue",
                "2285",
                "--pr",
                "9001",
                "--outcome",
                "approve",
            ]).status
        ).toBe(0);
        const again = run([
            "--batch",
            "batch-1",
            "--issue",
            "2285",
            "--pr",
            "9001",
            "--outcome",
            "approve",
        ]);
        expect(again.status).not.toBe(0);
        expect(again.stderr).toMatch(/refusing to overwrite/);
    });
});

describe("the two malformed shapes issue #2285 reported are still rejected by hand", () => {
    // These pin the exact two failure modes from the issue's evidence table
    // (`1965-review.json` / `1994-review.json` et al.) as a regression: even
    // if someone bypasses the CLI and hand-writes JSON again, the underlying
    // contract must still catch it.
    it("rejects a receipt missing version", () => {
        expect(() =>
            parseReceipt({
                role: "review",
                issue: 1965,
                outcome: "blocking",
                pr: 1,
                findings: ["something"],
            })
        ).toThrowError(/version/);
    });

    it("rejects findings written as rich objects instead of strings", () => {
        expect(() =>
            parseReceipt({
                version: RECEIPT_VERSION,
                role: "review",
                issue: 1994,
                outcome: "blocking",
                pr: 1,
                findings: [
                    {
                        id: "f1",
                        severity: "medium",
                        category: "bug",
                        file: "x.ts",
                        title: "t",
                        detail: "d",
                        action: "a",
                    },
                ],
            })
        ).toThrowError(/expected a non-empty string/);
    });
});
