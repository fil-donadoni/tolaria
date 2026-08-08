import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { computeTrainOrder, latestWorkReceipts } from "../lib/train-order";
import {
    parseReceipt,
    readReceipts,
    receiptDir,
    writeReceipt,
    RECEIPT_VERSION,
    type WorkReceipt,
} from "../lib/receipt";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Merge-train order from the receipt conflict graph (issue #2185, PRD #2180).
 *
 * Every fixture goes through `parseReceipt`, not a hand-built object literal.
 * The ordering function's whole input is the receipt contract, so a test that
 * fabricated receipts the validator would reject would be asserting order for
 * a batch that can never reach the train.
 */

function receipt(
    issue: number,
    targetFiles: string[],
    restructures?: string[]
): WorkReceipt {
    return parseReceipt({
        version: RECEIPT_VERSION,
        role: "implement",
        issue,
        outcome: "pr-open",
        pr: 9000 + issue,
        branch: `feat/issue-${issue}`,
        worktree: `/tmp/tolaria-${issue}`,
        targetFiles,
        ...(restructures ? { restructures } : {}),
        proofOfFailure: [],
    }) as WorkReceipt;
}

describe("a batch the conflict graph has nothing to say about", () => {
    it("preserves the incoming priority order for fully disjoint PRs", () => {
        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts"]),
            receipt(20, ["src/components/board/Hand.tsx"]),
            receipt(30, ["scripts/gate.ts"]),
        ]);
        expect(result.order).toEqual([10, 20, 30]);
        expect(result.edges).toEqual([]);
        expect(result.cycles).toEqual([]);
    });

    it("preserves priority when two PRs share a file but neither restructures it", () => {
        // Both merely edit `layers.ts`. The train re-gates every merge against
        // the real post-merge main, so an ordering constraint here would buy
        // nothing and serialise a batch that had no reason to be.
        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts"]),
            receipt(20, ["convex/gre/layers.ts"]),
        ]);
        expect(result.order).toEqual([10, 20]);
        expect(result.edges).toEqual([]);
    });

    it("ignores receipts with nothing to merge", () => {
        const wip = parseReceipt({
            version: RECEIPT_VERSION,
            role: "implement",
            issue: 20,
            outcome: "wip",
            branch: "feat/issue-20",
            worktree: "/tmp/tolaria-20",
            targetFiles: ["convex/gre/layers.ts"],
            proofOfFailure: [],
            reason: "still red",
        }) as WorkReceipt;

        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts"], ["convex/gre/layers.ts"]),
            wip,
        ]);
        // #20 is not in the train, so it neither merges nor constrains it.
        expect(result.order).toEqual([10]);
        expect(result.edges).toEqual([]);
    });
});

describe("one-way overlap — the restructuring PR lands first", () => {
    it("orders the restructurer ahead of the PR that merely touches the file", () => {
        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts"]),
            receipt(20, ["convex/gre/layers.ts"], ["convex/gre/layers.ts"]),
        ]);
        expect(result.order).toEqual([20, 10]);
        expect(result.edges).toEqual([
            { before: 20, after: 10, path: "convex/gre/layers.ts" },
        ]);
    });

    it("overrides incoming priority — the constraint outranks bugs-first", () => {
        // #10 is the higher-priority issue and still merges second. Priority
        // decides ties; it does not decide correctness.
        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts", "src/lib/card-utils.ts"]),
            receipt(20, ["convex/gre/layers.ts"], ["convex/gre/layers.ts"]),
        ]);
        expect(result.order).toEqual([20, 10]);
    });

    it("chains transitively across three PRs", () => {
        const result = computeTrainOrder([
            receipt(10, ["a.ts"]),
            receipt(20, ["a.ts", "b.ts"], ["a.ts"]),
            receipt(30, ["b.ts"], ["b.ts"]),
        ]);
        // 30 restructures b.ts (which 20 touches) → 30 before 20;
        // 20 restructures a.ts (which 10 touches) → 20 before 10.
        expect(result.order).toEqual([30, 20, 10]);
    });

    it("keeps priority among PRs the constraint does not relate", () => {
        const result = computeTrainOrder([
            receipt(10, ["a.ts"]),
            receipt(20, ["z.ts"]),
            receipt(30, ["a.ts"], ["a.ts"]),
        ]);
        // The ONLY constraint is 30 before 10. #20 conflicts with neither, so
        // it keeps its priority slot and merges first — the constraint pulls 30
        // ahead of 10, it does not pull 30 ahead of the whole batch.
        expect(result.order).toEqual([20, 30, 10]);
        expect(result.order.indexOf(30)).toBeLessThan(result.order.indexOf(10));
    });

    it("treats a directory restructure as covering the files under it", () => {
        const result = computeTrainOrder([
            receipt(10, ["src/components/board/Hand.tsx"]),
            receipt(
                20,
                ["src/components/board", "src/components/board/Hand.tsx"],
                ["src/components/board"]
            ),
        ]);
        expect(result.order).toEqual([20, 10]);
    });
});

describe("append-only registration points create no edges", () => {
    it("does not order two card PRs that both touch the card index", () => {
        const result = computeTrainOrder([
            receipt(10, [
                "convex/cards/sets/lea/red.ts",
                "convex/cards/index.ts",
            ]),
            receipt(
                20,
                ["convex/cards/sets/lea/blue.ts", "convex/cards/index.ts"],
                ["convex/cards/index.ts"]
            ),
        ]);
        // Even declared as restructured, a registration point is excluded: the
        // train absorbs its trivial rebase conflict by design, and an edge here
        // would serialise every batch that ships a card.
        expect(result.edges).toEqual([]);
        expect(result.order).toEqual([10, 20]);
    });

    it("still orders on a genuine shared file in the same batch", () => {
        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts", "convex/cards/index.ts"]),
            receipt(
                20,
                ["convex/gre/layers.ts", "convex/cards/index.ts"],
                ["convex/gre/layers.ts"]
            ),
        ]);
        expect(result.order).toEqual([20, 10]);
        expect(result.edges).toEqual([
            { before: 20, after: 10, path: "convex/gre/layers.ts" },
        ]);
    });

    it("honours an overridden append-only list", () => {
        const result = computeTrainOrder(
            [
                receipt(10, ["data/pick-ratings/vintage-cube.json"]),
                receipt(
                    20,
                    ["data/pick-ratings/vintage-cube.json"],
                    ["data/pick-ratings/vintage-cube.json"]
                ),
            ],
            { appendOnlyPaths: ["data/pick-ratings/vintage-cube.json"] }
        );
        expect(result.edges).toEqual([]);
    });
});

describe("a genuine cycle is reported, not broken", () => {
    it("reports two PRs that both restructure the same file", () => {
        const result = computeTrainOrder([
            receipt(10, ["convex/gre/layers.ts"], ["convex/gre/layers.ts"]),
            receipt(20, ["convex/gre/layers.ts"], ["convex/gre/layers.ts"]),
        ]);
        expect(result.cycles).toEqual([
            { issues: [10, 20], paths: ["convex/gre/layers.ts"] },
        ]);
        // Empty, not "best effort". A plausible order here would be a merge
        // sequence nobody chose and nobody could reconstruct afterwards.
        expect(result.order).toEqual([]);
    });

    it("reports a three-PR cycle no pairwise check can see", () => {
        const result = computeTrainOrder([
            receipt(10, ["a.ts", "c.ts"], ["a.ts"]),
            receipt(20, ["a.ts", "b.ts"], ["b.ts"]),
            receipt(30, ["b.ts", "c.ts"], ["c.ts"]),
        ]);
        // 10→20 (a.ts), 20→30 (b.ts), 30→10 (c.ts). Every pair is a clean
        // one-way overlap; only the traversal sees the loop.
        expect(result.cycles).toHaveLength(1);
        expect(result.cycles[0].issues).toEqual([10, 20, 30]);
        expect(result.cycles[0].paths).toEqual(["a.ts", "b.ts", "c.ts"]);
        expect(result.order).toEqual([]);
    });

    it("does not report a cycle for a diamond", () => {
        // 10 before 20 and 30; both before 40. Four PRs, four edges, no loop.
        const result = computeTrainOrder([
            receipt(10, ["a.ts", "b.ts"], ["a.ts", "b.ts"]),
            receipt(20, ["a.ts", "c.ts"], ["c.ts"]),
            receipt(30, ["b.ts", "d.ts"], ["d.ts"]),
            receipt(40, ["c.ts", "d.ts"]),
        ]);
        expect(result.cycles).toEqual([]);
        expect(result.order[0]).toBe(10);
        expect(result.order[3]).toBe(40);
        expect(result.order).toHaveLength(4);
    });
});

describe("the receipt contract carries the restructure claim", () => {
    it("rejects a restructured path that is not in the diff", () => {
        expect(() => receipt(10, ["a.ts"], ["b.ts"])).toThrow(
            /restructures: not a subset of targetFiles: b\.ts/
        );
    });

    it("accepts a receipt with no restructure claim at all", () => {
        expect(receipt(10, ["a.ts"]).restructures).toBeUndefined();
    });
});

describe("a fixup receipt supersedes the implement receipt it replaces", () => {
    const implement = (): WorkReceipt =>
        parseReceipt({
            version: RECEIPT_VERSION,
            role: "implement",
            issue: 10,
            outcome: "pr-open",
            pr: 101,
            branch: "feat/issue-10",
            worktree: "/tmp/wt-10",
            targetFiles: ["a.ts"],
            proofOfFailure: [],
        }) as WorkReceipt;
    const fixup = (): WorkReceipt =>
        parseReceipt({
            version: RECEIPT_VERSION,
            role: "fixup",
            issue: 10,
            outcome: "pr-open",
            pr: 101,
            branch: "feat/issue-10",
            worktree: "/tmp/wt-10",
            targetFiles: ["a.ts", "b.ts"],
            restructures: ["b.ts"],
            proofOfFailure: [],
        }) as WorkReceipt;

    // BOTH orders, because the on-disk read is alphabetical and `10-fixup.json`
    // happens to sort before `10-implement.json`. A test that only fed the
    // directory order would pass for a rule that does not exist.
    it("wins when it arrives second", () => {
        const [only] = latestWorkReceipts([implement(), fixup()]);
        expect(only.role).toBe("fixup");
        expect(only.targetFiles).toEqual(["a.ts", "b.ts"]);
    });

    it("wins when it arrives first", () => {
        const [only] = latestWorkReceipts([fixup(), implement()]);
        expect(only.role).toBe("fixup");
        expect(only.targetFiles).toEqual(["a.ts", "b.ts"]);
    });

    it("leaves an issue with only an implement receipt alone", () => {
        const [only] = latestWorkReceipts([implement()]);
        expect(only.role).toBe("implement");
    });
});

describe("among same-role receipts, the highest round wins — never iteration order", () => {
    const fixupRound = (round: number, targetFiles: string[]): WorkReceipt =>
        parseReceipt({
            version: RECEIPT_VERSION,
            role: "fixup",
            issue: 10,
            outcome: "pr-open",
            pr: 101,
            branch: "feat/issue-10",
            worktree: "/tmp/wt-10",
            targetFiles,
            proofOfFailure: [],
            ...(round > 1 ? { round } : {}),
        }) as WorkReceipt;

    it("round 2 supersedes round 1 regardless of array order", () => {
        const round1 = fixupRound(1, ["a.ts"]);
        const round2 = fixupRound(2, ["a.ts", "b.ts"]);

        // Fed in "wrong" order — round 2 first — to prove the selection is
        // NOT "whichever arrives last in this array" in disguise.
        const [only] = latestWorkReceipts([round2, round1]);
        expect(only.round).toBe(2);
        expect(only.targetFiles).toEqual(["a.ts", "b.ts"]);
    });

    it("round 1 does not supersede round 2 when it arrives second", () => {
        const round1 = fixupRound(1, ["a.ts"]);
        const round2 = fixupRound(2, ["a.ts", "b.ts"]);

        const [only] = latestWorkReceipts([round1, round2]);
        expect(only.round).toBe(2);
    });

    it("round 3 wins over round 2 and round 1 in any arrival order", () => {
        const round1 = fixupRound(1, ["a.ts"]);
        const round2 = fixupRound(2, ["a.ts", "b.ts"]);
        const round3 = fixupRound(3, ["a.ts", "b.ts", "c.ts"]);

        const [only] = latestWorkReceipts([round2, round3, round1]);
        expect(only.round).toBe(3);
        expect(only.targetFiles).toEqual(["a.ts", "b.ts", "c.ts"]);
    });
});

describe("the queue:train CLI joins receipts into a train plan", () => {
    it("reads a batch off disk and reports order, verdicts and scenarios", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-train-"));
        const batch = "sess-cli";

        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "implement",
            issue: 10,
            outcome: "pr-open",
            pr: 101,
            branch: "feat/issue-10",
            worktree: `${tmp}/wt-10`,
            targetFiles: ["convex/gre/layers.ts"],
            proofOfFailure: [],
            scenario: { label: "Bolt to the face", spec: { landCount: 3 } },
        });
        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "implement",
            issue: 20,
            outcome: "pr-open",
            pr: 102,
            branch: "feat/issue-20",
            worktree: `${tmp}/wt-20`,
            targetFiles: ["convex/gre/layers.ts"],
            restructures: ["convex/gre/layers.ts"],
            proofOfFailure: [],
        });
        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "review",
            issue: 20,
            outcome: "blocking",
            pr: 102,
            findings: ["layers.ts:88 — grant survives the source leaving"],
        });

        const result = spawnSync(
            "bun",
            [
                path.join(REPO_ROOT, "scripts", "train-order.ts"),
                "--batch",
                batch,
            ],
            { cwd: tmp, encoding: "utf8" }
        );
        expect(result.status, result.stderr).toBe(0);
        const plan = JSON.parse(result.stdout) as {
            order: number[];
            entries: Array<{
                issue: number;
                pr: number;
                verdict: string | null;
                findings: string[];
                scenario: { label: string } | null;
            }>;
            missing: number;
        };

        // #20 restructures the file #10 touches, so it merges first — even
        // though #10 came first in the batch.
        expect(plan.order).toEqual([20, 10]);
        const twenty = plan.entries.find((e) => e.issue === 20)!;
        expect(twenty.verdict).toBe("blocking");
        expect(twenty.findings).toHaveLength(1);
        // The scenario spec survives the process boundary — this is exactly
        // what an orchestrator dying between merge and registration loses
        // when the receipt lives only in a context window.
        expect(plan.entries.find((e) => e.issue === 10)!.scenario?.label).toBe(
            "Bolt to the face"
        );
        expect(plan.missing).toBe(0);
    });

    it("lets a fixup receipt supersede the implement receipt it replaces", () => {
        // The implement receipt describes the branch as it was when review
        // blocked it; the fixup receipt describes what will actually land. Both
        // sit in the directory forever, so preferring the wrong one orders the
        // train against a diff that no longer exists.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-train-"));
        const batch = "sess-fixup";
        const base = {
            version: RECEIPT_VERSION,
            issue: 10,
            outcome: "pr-open" as const,
            pr: 101,
            branch: "feat/issue-10",
            worktree: `${tmp}/wt-10`,
            proofOfFailure: [],
        };
        writeReceipt(tmp, batch, {
            ...base,
            role: "implement",
            targetFiles: ["a.ts"],
        });
        writeReceipt(tmp, batch, {
            ...base,
            role: "fixup",
            targetFiles: ["a.ts", "b.ts"],
            restructures: ["b.ts"],
        });
        writeReceipt(tmp, batch, {
            ...base,
            issue: 20,
            pr: 102,
            branch: "feat/issue-20",
            worktree: `${tmp}/wt-20`,
            role: "implement",
            targetFiles: ["b.ts"],
        });

        const result = spawnSync(
            "bun",
            [
                path.join(REPO_ROOT, "scripts", "train-order.ts"),
                "--batch",
                batch,
            ],
            { cwd: tmp, encoding: "utf8" }
        );
        expect(result.status, result.stderr).toBe(0);
        const plan = JSON.parse(result.stdout) as {
            order: number[];
            entries: Array<{ issue: number; targetFiles: string[] }>;
        };
        // Only the FIXUP receipt touches b.ts and restructures it. Reading the
        // implement receipt instead would produce [10, 20] on priority alone.
        expect(plan.entries.find((e) => e.issue === 10)!.targetFiles).toEqual([
            "a.ts",
            "b.ts",
        ]);
        expect(plan.order).toEqual([10, 20]);
        expect(plan.entries).toHaveLength(2);
    });

    it("counts a subagent that left no receipt", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-train-"));
        writeReceipt(tmp, "sess-gap", {
            version: RECEIPT_VERSION,
            role: "missing",
            outcome: "missing",
            session: "sess-gap",
            transcript: null,
        });
        const result = spawnSync(
            "bun",
            [
                path.join(REPO_ROOT, "scripts", "train-order.ts"),
                "--batch",
                "sess-gap",
            ],
            { cwd: tmp, encoding: "utf8" }
        );
        expect(result.status, result.stderr).toBe(0);
        const plan = JSON.parse(result.stdout) as {
            missing: number;
            order: number[];
        };
        expect(plan.missing).toBe(1);
        expect(plan.order).toEqual([]);
    });

    it("exits non-zero on a corrupt receipt instead of merging a short batch", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-train-"));
        const dir = path.join(tmp, ".claude", "receipts", "sess-bad");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "10-implement.json"), '{"version":99}');
        const result = spawnSync(
            "bun",
            [
                path.join(REPO_ROOT, "scripts", "train-order.ts"),
                "--batch",
                "sess-bad",
            ],
            { cwd: tmp, encoding: "utf8" }
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/receipt\.version/);
        const plan = JSON.parse(result.stdout) as {
            unreadable: Array<{ file: string; message: string }>;
        };
        expect(plan.unreadable).toHaveLength(1);
        expect(plan.unreadable[0].file).toMatch(/10-implement\.json$/);
        expect(plan.unreadable[0].message).toMatch(/receipt\.version/);
    });

    it("quarantines only the corrupt receipt's issue — every OTHER issue still gets an order", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-train-"));
        const batch = "sess-quarantine";
        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "implement",
            issue: 20,
            outcome: "pr-open",
            pr: 202,
            branch: "feat/issue-20",
            worktree: `${tmp}/wt-20`,
            targetFiles: ["convex/gre/layers.ts"],
            proofOfFailure: [],
        });
        const dir = receiptDir(tmp, batch);
        fs.writeFileSync(path.join(dir, "10-implement.json"), '{"version":99}');

        const result = spawnSync(
            "bun",
            [
                path.join(REPO_ROOT, "scripts", "train-order.ts"),
                "--batch",
                batch,
            ],
            { cwd: tmp, encoding: "utf8" }
        );
        // Non-zero — a pass cannot silently ship a short batch...
        expect(result.status).toBe(1);
        const plan = JSON.parse(result.stdout) as {
            order: number[];
            unreadable: Array<{ file: string; message: string }>;
        };
        // ...but #20's order is still reported — it is not the corrupt
        // receipt's issue, and quarantining the batch instead of the issue
        // is exactly the failure mode this behaviour replaces.
        expect(plan.order).toEqual([20]);
        expect(plan.unreadable).toHaveLength(1);
        expect(plan.unreadable[0].file).toMatch(/10-implement\.json$/);
    });
});

describe("a round-sequence gap quarantines the issue out of the plan entirely", () => {
    it("excludes the issue from order/entries even though its OWN work receipt parses fine", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-train-"));
        const batch = "sess-round-gap";
        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "implement",
            issue: 10,
            outcome: "pr-open",
            pr: 101,
            branch: "feat/issue-10",
            worktree: `${tmp}/wt-10`,
            targetFiles: ["a.ts"],
            proofOfFailure: [],
        });
        // Round 1 and round 3 both individually valid and correctly named —
        // round 2 is simply missing from disk. Neither file is corrupt, so
        // only the CROSS-file gap check can see this.
        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "review",
            issue: 10,
            outcome: "blocking",
            pr: 101,
            findings: ["round 1 finding"],
        });
        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "review",
            issue: 10,
            round: 3,
            outcome: "approve",
            pr: 101,
            findings: [],
        });
        // #20 is unrelated — sound, and must still get an order.
        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "implement",
            issue: 20,
            outcome: "pr-open",
            pr: 102,
            branch: "feat/issue-20",
            worktree: `${tmp}/wt-20`,
            targetFiles: ["b.ts"],
            proofOfFailure: [],
        });

        const result = spawnSync(
            "bun",
            [
                path.join(REPO_ROOT, "scripts", "train-order.ts"),
                "--batch",
                batch,
            ],
            { cwd: tmp, encoding: "utf8" }
        );
        expect(result.status).toBe(1);
        const plan = JSON.parse(result.stdout) as {
            order: number[];
            entries: Array<{ issue: number }>;
            unreadable: Array<{ file: string; message: string }>;
        };
        expect(plan.unreadable.some((u) => u.message.includes("gap"))).toBe(
            true
        );
        // #10 is quarantined — its own implement receipt parsed cleanly, but
        // the round-gap on its review makes the issue as a whole untrusted.
        expect(plan.order).not.toContain(10);
        expect(plan.entries.find((e) => e.issue === 10)).toBeUndefined();
        // #20 is untouched by #10's problem.
        expect(plan.order).toContain(20);
    });
});

describe("a round-2 review verdict supersedes the round-1 verdict it answers", () => {
    it("reports the round-2 approve, not the round-1 blocking it was written to answer", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-train-"));
        const batch = "sess-reverdict";
        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "implement",
            issue: 10,
            outcome: "pr-open",
            pr: 101,
            branch: "feat/issue-10",
            worktree: `${tmp}/wt-10`,
            targetFiles: ["a.ts"],
            proofOfFailure: [],
        });
        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "review",
            issue: 10,
            outcome: "blocking",
            pr: 101,
            findings: ["a.ts:1 — round 1 finding"],
        });
        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "review",
            issue: 10,
            round: 2,
            outcome: "approve",
            pr: 101,
            findings: [],
        });

        const result = spawnSync(
            "bun",
            [
                path.join(REPO_ROOT, "scripts", "train-order.ts"),
                "--batch",
                batch,
            ],
            { cwd: tmp, encoding: "utf8" }
        );
        expect(result.status, result.stderr).toBe(0);
        const plan = JSON.parse(result.stdout) as {
            entries: Array<{ issue: number; verdict: string | null }>;
        };
        // `12-review-2.json` sorts BEFORE `12-review.json` (alphabetical:
        // digit "-" sorts before ".") — a filename-order-based selection
        // would report the round-1 blocking verdict here. Selecting by
        // ROUND reports the round-2 approve that supersedes it.
        expect(plan.entries.find((e) => e.issue === 10)!.verdict).toBe(
            "approve"
        );
    });
});

describe("--dir reads an explicit receipt directory (the documented resume entry point)", () => {
    it("prints the same plan as --batch on the same batch", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-train-"));
        const batch = "sess-dir";
        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "implement",
            issue: 10,
            outcome: "pr-open",
            pr: 101,
            branch: "feat/issue-10",
            worktree: `${tmp}/wt-10`,
            targetFiles: ["a.ts"],
            proofOfFailure: [],
        });

        const runBatch = spawnSync(
            "bun",
            [
                path.join(REPO_ROOT, "scripts", "train-order.ts"),
                "--batch",
                batch,
            ],
            { cwd: tmp, encoding: "utf8" }
        );
        const runDir = spawnSync(
            "bun",
            [
                path.join(REPO_ROOT, "scripts", "train-order.ts"),
                "--dir",
                path.join(tmp, ".claude", "receipts", batch),
            ],
            { cwd: tmp, encoding: "utf8" }
        );
        expect(runBatch.status, runBatch.stderr).toBe(0);
        expect(runDir.status, runDir.stderr).toBe(0);
        expect(JSON.parse(runDir.stdout)).toEqual(JSON.parse(runBatch.stdout));
    });

    it("exits non-zero when the directory holds no receipts — the old bug printed an empty plan with exit 0", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-train-"));
        const emptyDir = path.join(tmp, ".claude", "receipts", "sess-empty");
        fs.mkdirSync(emptyDir, { recursive: true });

        const result = spawnSync(
            "bun",
            [
                path.join(REPO_ROOT, "scripts", "train-order.ts"),
                "--dir",
                emptyDir,
            ],
            { cwd: tmp, encoding: "utf8" }
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/holds no receipts/);
    });

    it("still reproduces the OLD bug's exact symptom if the RECEIPTS_ROOT-join path is used instead — regression guard for the fix itself", () => {
        // This pins the FAILURE MODE the fix removes: --dir given the
        // complete directory, run through the naive
        // readReceipts(dirname(dir), basename(dir)) join, resolves to
        // `.claude/receipts/.claude/receipts/<batch>` and finds nothing.
        // `train-order.ts` no longer does this (it calls
        // `readReceiptsFromDir` directly), so this test documents what would
        // happen if that regressed, by exercising the join directly against
        // the library rather than re-deriving it inline.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-train-"));
        const batch = "sess-dir-regress";
        writeReceipt(tmp, batch, {
            version: RECEIPT_VERSION,
            role: "implement",
            issue: 10,
            outcome: "pr-open",
            pr: 101,
            branch: "feat/issue-10",
            worktree: `${tmp}/wt-10`,
            targetFiles: ["a.ts"],
            proofOfFailure: [],
        });
        const dir = path.join(tmp, ".claude", "receipts", batch);
        const naiveResult = readReceipts(
            path.dirname(path.resolve(dir)),
            path.basename(dir)
        );
        expect(naiveResult.receipts).toEqual([]);
        expect(naiveResult.errors).toEqual([]);
    });
});
