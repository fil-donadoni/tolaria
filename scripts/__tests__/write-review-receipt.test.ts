import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

describe("issue #2656: the receipt lands in the PRIMARY checkout, not cwd", () => {
    // Every fixture above runs the CLI with `cwd: tmp`, where `tmp` is a bare
    // `mkdtempSync` directory — NOT a git repo at all. `primaryCheckout()`
    // falls back to `resolve(cwd)` for a non-repo cwd exactly the same way the
    // old buggy `process.cwd()` did, so those tests pass identically before
    // and after the fix and prove nothing about the bug this issue reports.
    // This block builds the real shape: a primary checkout with `.git/`, and
    // a LINKED WORKTREE (`git worktree add`) — the actual layout every
    // implement/review subagent runs inside — then runs the CLI with its cwd
    // set to the linked worktree and asserts the receipt landed under the
    // PRIMARY's `.claude/receipts/`, never the worktree's own.
    let primary: string;
    let worktree: string;

    function gitq(args: string[], cwd: string) {
        const r = spawnSync("git", args, { cwd, encoding: "utf8" });
        if (r.status !== 0) {
            throw new Error(
                `git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`
            );
        }
        return r.stdout.trim();
    }

    beforeEach(() => {
        // realpathSync: on macOS `os.tmpdir()` is under a `/var` symlink to
        // `/private/var`, and `git rev-parse --git-common-dir` (inside
        // `primaryCheckout`) resolves through it — so comparing the raw
        // `mkdtempSync` path against the CLI's resolved output would fail on
        // a symlink difference that has nothing to do with this issue's bug.
        primary = fs.realpathSync(
            fs.mkdtempSync(
                path.join(os.tmpdir(), "tolaria-review-receipt-primary-")
            )
        );
        gitq(["init", "-q"], primary);
        gitq(["config", "user.email", "test@example.com"], primary);
        gitq(["config", "user.name", "Test"], primary);
        gitq(["commit", "--allow-empty", "-q", "-m", "init"], primary);

        worktree = path.join(
            fs.mkdtempSync(
                path.join(os.tmpdir(), "tolaria-review-receipt-wt-parent-")
            ),
            "linked"
        );
        gitq(
            ["worktree", "add", "-q", "-b", "linked-branch", worktree],
            primary
        );
    });

    afterEach(() => {
        // Best-effort — a leftover linked worktree under a stale primary is
        // harmless (both live under os.tmpdir()), but `git worktree remove`
        // keeps `git worktree list` honest for anyone poking at `primary`
        // interactively while debugging a failure.
        try {
            gitq(["worktree", "remove", "--force", worktree], primary);
        } catch {
            // fine — the OS reclaims tmpdir either way
        }
    });

    it("writes the receipt under the primary checkout's .claude/receipts, not the worktree's", () => {
        const result = spawnSync(
            "bun",
            [
                CLI,
                "--batch",
                "batch-wt",
                "--issue",
                "2656",
                "--pr",
                "9002",
                "--outcome",
                "approve",
            ],
            { cwd: worktree, encoding: "utf8" }
        );
        expect(result.status, result.stderr).toBe(0);

        const primaryReceipt = path.join(
            primary,
            ".claude/receipts/batch-wt/2656-review.json"
        );
        const worktreeReceipt = path.join(
            worktree,
            ".claude/receipts/batch-wt/2656-review.json"
        );
        expect(fs.existsSync(primaryReceipt)).toBe(true);
        expect(fs.existsSync(worktreeReceipt)).toBe(false);

        const { receipts, errors } = readReceipts(primary, "batch-wt");
        expect(errors).toEqual([]);
        expect(receipts).toHaveLength(1);
        const receipt = receipts[0] as ReviewReceipt;
        expect(receipt.issue).toBe(2656);
        expect(receipt.pr).toBe(9002);

        // The path the CLI itself printed must also point at the primary —
        // a caller that trusts the printed path (queue:train's callers do
        // not, but a human debugging by hand would) must not be misled either.
        expect(result.stdout.trim()).toBe(primaryReceipt);
    });
});
