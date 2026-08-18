import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
    RECEIPT_VERSION,
    ReceiptError,
    newestBatchDir,
    parseReceipt,
    readReceipts,
    receiptDir,
    receiptFilename,
    writeReceipt,
    type Receipt,
    type ReviewReceipt,
    type WorkReceipt,
} from "../lib/receipt";

/**
 * Subagent receipts as a durable, typed artifact (issue #2182, PRD #2180).
 *
 * **Asserted in BOTH directions, deliberately.** A rejection-only suite passes
 * for a validator that rejects everything — which would stop the loop dead
 * while looking exactly like a working guard. So every rejection case is paired
 * with a well-formed receipt that must round-trip, and the round-trip runs
 * through the real `writeReceipt` → disk → `readReceipts` path rather than
 * comparing an object with itself.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOK = path.join(REPO_ROOT, ".claude", "hooks", "receipt-guard.sh");

let tmp: string;
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-receipt-"));
});
afterAll(() => {
    // Each test gets its own dir; the OS reclaims them. Nothing to tear down
    // that a failed assertion would have left in an interesting state.
});

const workReceipt = (
    over: Partial<WorkReceipt> = {}
): Record<string, unknown> =>
    ({
        version: RECEIPT_VERSION,
        role: "implement",
        issue: 2182,
        outcome: "pr-open",
        pr: 2207,
        branch: "feat/issue-2182",
        worktree: "/Users/x/code/mtg/tolaria-2182",
        targetFiles: ["scripts/lib/receipt.ts"],
        proofOfFailure: [
            { broke: "deleted the version check", failed: "receipt.test.ts" },
        ],
        ...over,
    }) as Record<string, unknown>;

const reviewReceipt = (
    over: Partial<ReviewReceipt> = {}
): Record<string, unknown> =>
    ({
        version: RECEIPT_VERSION,
        role: "review",
        issue: 2182,
        outcome: "approve",
        pr: 2207,
        findings: [],
        ...over,
    }) as Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────

describe("the receipt contract accepts what the loop actually produces", () => {
    it("round-trips an implement receipt through disk", () => {
        writeReceipt(tmp, "sess-1", workReceipt());
        const [receipt] = readReceipts(tmp, "sess-1").receipts as WorkReceipt[];
        expect(receipt.role).toBe("implement");
        expect(receipt.issue).toBe(2182);
        expect(receipt.outcome).toBe("pr-open");
        expect(receipt.pr).toBe(2207);
        expect(receipt.targetFiles).toEqual(["scripts/lib/receipt.ts"]);
        expect(receipt.proofOfFailure[0].broke).toBe(
            "deleted the version check"
        );
        expect(receipt.ts).toBeGreaterThan(0);
    });

    it("round-trips every non-pr-open outcome with its reason", () => {
        for (const outcome of ["wip", "failed", "collision"] as const) {
            const parsed = parseReceipt(
                workReceipt({
                    outcome,
                    pr: undefined,
                    reason: `still red: ${outcome}`,
                })
            ) as WorkReceipt;
            expect(parsed.outcome).toBe(outcome);
            expect(parsed.reason).toBe(`still red: ${outcome}`);
        }
    });

    it("accepts an empty proofOfFailure — not every issue adds a guard", () => {
        const parsed = parseReceipt(
            workReceipt({ proofOfFailure: [] })
        ) as WorkReceipt;
        expect(parsed.proofOfFailure).toEqual([]);
    });

    it("accepts an approve verdict with no findings, and a blocking one with them", () => {
        expect(
            (parseReceipt(reviewReceipt()) as ReviewReceipt).findings
        ).toEqual([]);
        const blocking = parseReceipt(
            reviewReceipt({
                outcome: "blocking",
                findings: [
                    "layers.ts:88 — grant leaks after the source leaves",
                ],
            })
        ) as ReviewReceipt;
        expect(blocking.outcome).toBe("blocking");
        expect(blocking.findings).toHaveLength(1);
    });

    it("accepts a missing marker with a null transcript", () => {
        const parsed = parseReceipt({
            version: RECEIPT_VERSION,
            role: "missing",
            outcome: "missing",
            session: "sess-1",
            transcript: null,
        });
        expect(parsed.role).toBe("missing");
    });
});

describe("the receipt contract rejects malformed input, naming the field", () => {
    const cases: Array<{ what: string; field: string; value: unknown }> = [
        { what: "a non-object", field: "", value: "not a receipt" },
        { what: "an array", field: "", value: [] },
        {
            what: "a future version",
            field: "version",
            value: workReceipt({ version: 2 as never }),
        },
        {
            what: "an unknown role",
            field: "role",
            value: workReceipt({ role: "implementer" as never }),
        },
        {
            what: "a missing issue number",
            field: "issue",
            value: { ...workReceipt(), issue: undefined },
        },
        {
            what: "an issue number as a string",
            field: "issue",
            value: workReceipt({ issue: "2182" as never }),
        },
        {
            what: "an unknown outcome",
            field: "outcome",
            value: workReceipt({ outcome: "done" as never }),
        },
        {
            what: "a pr-open receipt with no PR",
            field: "pr",
            value: { ...workReceipt(), pr: undefined },
        },
        {
            what: "a pr-open receipt claiming an empty diff",
            field: "targetFiles",
            value: workReceipt({ targetFiles: [] }),
        },
        {
            what: "targetFiles as a string",
            field: "targetFiles",
            value: workReceipt({ targetFiles: "a.ts" as never }),
        },
        {
            what: "an empty path in targetFiles",
            field: "targetFiles[1]",
            value: workReceipt({ targetFiles: ["a.ts", "  "] }),
        },
        {
            what: "a wip receipt with no reason",
            field: "reason",
            value: { ...workReceipt({ outcome: "wip" }), pr: undefined },
        },
        {
            what: "a missing branch",
            field: "branch",
            value: workReceipt({ branch: "" }),
        },
        {
            what: "a missing worktree",
            field: "worktree",
            value: { ...workReceipt(), worktree: undefined },
        },
        {
            what: "proofOfFailure absent entirely",
            field: "proofOfFailure",
            value: { ...workReceipt(), proofOfFailure: undefined },
        },
        {
            what: "a proof entry naming no mutation",
            field: "proofOfFailure[0].broke",
            value: workReceipt({
                proofOfFailure: [{ broke: "", failed: "x.test.ts" }] as never,
            }),
        },
        {
            what: "a proof entry naming nothing that went red",
            field: "proofOfFailure[0].failed",
            value: workReceipt({
                proofOfFailure: [{ broke: "inverted it" }] as never,
            }),
        },
        {
            what: "a scenario with no label",
            field: "scenario.label",
            value: workReceipt({ scenario: { spec: {} } as never }),
        },
        {
            what: "a scenario with a non-object spec",
            field: "scenario.spec",
            value: workReceipt({
                scenario: { label: "x", spec: "y" } as never,
            }),
        },
        {
            what: "a blocking verdict with no findings",
            field: "findings",
            value: reviewReceipt({ outcome: "blocking" }),
        },
        {
            what: "a review verdict with no PR",
            field: "pr",
            value: { ...reviewReceipt(), pr: undefined },
        },
        {
            what: "a missing marker with no session",
            field: "session",
            value: {
                version: RECEIPT_VERSION,
                role: "missing",
                outcome: "missing",
                transcript: null,
            },
        },
    ];

    for (const { what, field, value } of cases) {
        it(`rejects ${what} (receipt.${field})`, () => {
            let error: unknown;
            try {
                parseReceipt(value);
            } catch (e) {
                error = e;
            }
            expect(error, `${what} was accepted`).toBeInstanceOf(ReceiptError);
            expect((error as ReceiptError).field).toBe(field);
        });
    }

    it("refuses to write a malformed receipt at all", () => {
        expect(() =>
            writeReceipt(tmp, "sess-1", workReceipt({ targetFiles: [] }))
        ).toThrow(ReceiptError);
        // The point of validating BEFORE the write: nothing reached disk to be
        // read back three steps later as an `undefined` field.
        expect(fs.existsSync(receiptDir(tmp, "sess-1"))).toBe(false);
    });

    it("reports the file when a receipt on disk is corrupt, without throwing", () => {
        const dir = receiptDir(tmp, "sess-1");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "9-implement.json"), '{"version":99}');
        const { receipts, errors } = readReceipts(tmp, "sess-1");
        expect(receipts).toEqual([]);
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toMatch(/9-implement\.json$/);
        expect(errors[0].message).toMatch(/receipt\.version/);
        expect(errors[0].issue).toBe(9);
    });

    it("quarantines only the corrupt file's issue — every other receipt in the same directory still reads clean", () => {
        writeReceipt(tmp, "sess-1", workReceipt({ issue: 10 }));
        const dir = receiptDir(tmp, "sess-1");
        fs.writeFileSync(path.join(dir, "9-implement.json"), '{"version":99}');

        const { receipts, errors } = readReceipts(tmp, "sess-1");
        expect(errors).toHaveLength(1);
        expect(errors[0].issue).toBe(9);
        // #10's receipt reads back fine — the corrupt #9 file next to it
        // does not take the whole directory down.
        expect(receipts).toHaveLength(1);
        expect((receipts[0] as WorkReceipt).issue).toBe(10);
    });
});

describe("receipts survive an orchestrator restart", () => {
    it("keeps implement, review and fixup for one issue distinguishable", () => {
        writeReceipt(tmp, "sess-1", workReceipt());
        writeReceipt(tmp, "sess-1", reviewReceipt({ outcome: "approve" }));
        writeReceipt(
            tmp,
            "sess-1",
            workReceipt({ role: "fixup", outcome: "wip", reason: "rebase" })
        );

        const roles = readReceipts(tmp, "sess-1")
            .receipts.map((r) => r.role)
            .sort();
        expect(roles).toEqual(["fixup", "implement", "review"]);
        // "Was this PR reviewed?" answered from disk alone.
        const review = readReceipts(tmp, "sess-1").receipts.find(
            (r): r is ReviewReceipt => r.role === "review"
        );
        expect(review?.outcome).toBe("approve");
    });

    it("carries the debug-scenario spec across a fresh read", () => {
        const scenario = {
            label: "Lightning Bolt — face damage",
            spec: { hand: ["Lightning Bolt"], phase: "PRECOMBAT_MAIN" },
        };
        writeReceipt(tmp, "sess-1", workReceipt({ scenario }));

        // A fresh read is the restart: nothing from the write survives in
        // memory, so this is the field crossing the process boundary.
        const [receipt] = readReceipts(tmp, "sess-1").receipts as WorkReceipt[];
        expect(receipt.scenario).toEqual(scenario);
    });

    it("names files by issue and role, and rejects a batch id that escapes the directory", () => {
        expect(receiptFilename(parseReceipt(workReceipt()) as Receipt)).toBe(
            "2182-implement.json"
        );
        expect(() => receiptDir(tmp, "../elsewhere")).toThrow(ReceiptError);
        expect(() => receiptDir(tmp, "")).toThrow(ReceiptError);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rounds: a second review or fixup for the same issue gets its own canonical
// name instead of overwriting the first, or being hand-written outside the
// validator (issue #2349).
// ─────────────────────────────────────────────────────────────────────────────

describe("a receipt round has its own canonical name — round 1 keeps the old one", () => {
    it("round 1 (absent) and round 1 (explicit) both emit the un-suffixed filename", () => {
        expect(receiptFilename(parseReceipt(workReceipt()) as Receipt)).toBe(
            "2182-implement.json"
        );
        expect(
            receiptFilename(parseReceipt(workReceipt({ round: 1 })) as Receipt)
        ).toBe("2182-implement.json");
    });

    it("round 2+ appends the round to the filename", () => {
        expect(
            receiptFilename(
                parseReceipt(reviewReceipt({ round: 2 })) as Receipt
            )
        ).toBe("2182-review-2.json");
        expect(
            receiptFilename(
                parseReceipt(
                    workReceipt({ role: "fixup", round: 3 })
                ) as Receipt
            )
        ).toBe("2182-fixup-3.json");
    });

    it("rejects a non-positive-integer round", () => {
        for (const round of [0, -1, 1.5, "2"] as unknown as number[]) {
            let error: unknown;
            try {
                parseReceipt(workReceipt({ round }));
            } catch (e) {
                error = e;
            }
            expect(
                error,
                `round ${JSON.stringify(round)} was accepted`
            ).toBeInstanceOf(ReceiptError);
            expect((error as ReceiptError).field).toBe("round");
        }
    });

    it("a second review round is written through writeReceipt without touching round 1", () => {
        writeReceipt(
            tmp,
            "sess-1",
            reviewReceipt({ outcome: "blocking", findings: ["x"] })
        );
        writeReceipt(
            tmp,
            "sess-1",
            reviewReceipt({ round: 2, outcome: "approve" })
        );

        const dir = receiptDir(tmp, "sess-1");
        expect(fs.existsSync(path.join(dir, "2182-review.json"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "2182-review-2.json"))).toBe(true);

        const { receipts, errors } = readReceipts(tmp, "sess-1");
        expect(errors).toEqual([]);
        const reviews = receipts.filter(
            (r): r is ReviewReceipt => r.role === "review"
        );
        expect(reviews).toHaveLength(2);
        // Round 1's own verdict is untouched — this is what "does not
        // overwrite the first" means concretely.
        const round1 = reviews.find((r) => (r.round ?? 1) === 1)!;
        expect(round1.outcome).toBe("blocking");
        const round2 = reviews.find((r) => r.round === 2)!;
        expect(round2.outcome).toBe("approve");
    });

    it("refuses to overwrite an existing receipt, naming the existing file", () => {
        writeReceipt(tmp, "sess-1", workReceipt());
        let error: unknown;
        try {
            writeReceipt(tmp, "sess-1", workReceipt());
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(Error);
        const dir = receiptDir(tmp, "sess-1");
        expect((error as Error).message).toContain(
            path.join(dir, "2182-implement.json")
        );
    });

    it("a repeat write WITH a bumped round does not collide", () => {
        writeReceipt(tmp, "sess-1", workReceipt({ role: "fixup" }));
        // Same (issue, role), round bumped — must not throw.
        expect(() =>
            writeReceipt(
                tmp,
                "sess-1",
                workReceipt({ role: "fixup", round: 2 })
            )
        ).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// A subagent can never learn its own session id — it only ever arrives via a
// hook payload on stdin — so the batch id passed to `writeReceipt` has to stay
// a caller-supplied parameter. That means a typo'd or stale id is possible,
// and it is silent: the directory it names looks like a fresh, empty batch,
// `writeReceipt` happily creates it, and `queue:train` — which only reads the
// ONE batch directory it was told about — never sees the receipt at all. The
// real incident: a reviewer's verdict landed in a batch dir nobody read back,
// caught only by eye.
// ─────────────────────────────────────────────────────────────────────────────
describe("writeReceipt refuses to create a new batch dir that misroutes an issue already tracked elsewhere", () => {
    it("throws, naming both directories, when a second batch dir would take the same issue", () => {
        writeReceipt(tmp, "sess-1", workReceipt({ issue: 2182 }));
        let error: unknown;
        try {
            writeReceipt(tmp, "sess-2-typo", workReceipt({ issue: 2182 }));
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain(receiptDir(tmp, "sess-1"));
        expect(message).toContain(receiptDir(tmp, "sess-2-typo"));
        expect(message).toContain("2182");
        // The misrouted write must never have reached disk.
        expect(fs.existsSync(receiptDir(tmp, "sess-2-typo"))).toBe(false);
    });

    it("still succeeds when a fresh batch dir takes a DIFFERENT issue", () => {
        writeReceipt(tmp, "sess-1", workReceipt({ issue: 2182 }));
        expect(() =>
            writeReceipt(tmp, "sess-2", workReceipt({ issue: 3001 }))
        ).not.toThrow();
        const [receipt] = readReceipts(tmp, "sess-2").receipts as WorkReceipt[];
        expect(receipt.issue).toBe(3001);
    });

    it("still succeeds for the first receipt of a genuinely new batch — no sibling exists yet", () => {
        expect(() =>
            writeReceipt(tmp, "sess-1", workReceipt({ issue: 2182 }))
        ).not.toThrow();
        const [receipt] = readReceipts(tmp, "sess-1").receipts as WorkReceipt[];
        expect(receipt.issue).toBe(2182);
    });

    // #2527 BLOCKER: the remediation text used to say "write into <sibling>
    // instead" — the opposite of correct, since `queue:train` only ever reads
    // the ONE batch dir it was told about (the new one), so following that
    // advice makes the receipt invisible to the running train. It also left no
    // escape hatch for a genuine re-attempt, unlike every other guard in this
    // repo (TOLARIA_ALLOW_MAIN_EDIT, TOLARIA_ALLOW_FULL_SUITE).
    it("never tells the caller to write into the sibling — that would misroute the receipt again", () => {
        writeReceipt(tmp, "sess-1", workReceipt({ issue: 2182 }));
        let error: unknown;
        try {
            writeReceipt(tmp, "sess-2-typo", workReceipt({ issue: 2182 }));
        } catch (e) {
            error = e;
        }
        const message = (error as Error).message;
        expect(message).not.toMatch(/write into .* instead of/);
        expect(message).toContain("TOLARIA_ALLOW_RECEIPT_REBATCH");
    });

    it("still throws WITHOUT the escape hatch set — the default stays fail-loud", () => {
        delete process.env.TOLARIA_ALLOW_RECEIPT_REBATCH;
        writeReceipt(tmp, "sess-1", workReceipt({ issue: 2182 }));
        expect(() =>
            writeReceipt(tmp, "sess-2-typo", workReceipt({ issue: 2182 }))
        ).toThrow(/already has receipt/);
        // The misrouted write must never have reached disk.
        expect(fs.existsSync(receiptDir(tmp, "sess-2-typo"))).toBe(false);
    });

    it("proceeds and writes when TOLARIA_ALLOW_RECEIPT_REBATCH=1 — a genuine re-attempt in a new batch", () => {
        writeReceipt(tmp, "sess-1", workReceipt({ issue: 2182 }));
        process.env.TOLARIA_ALLOW_RECEIPT_REBATCH = "1";
        try {
            expect(() =>
                writeReceipt(
                    tmp,
                    "sess-2-rebatch",
                    workReceipt({ issue: 2182, role: "fixup" })
                )
            ).not.toThrow();
            const [receipt] = readReceipts(tmp, "sess-2-rebatch")
                .receipts as WorkReceipt[];
            expect(receipt.issue).toBe(2182);
            expect(receipt.role).toBe("fixup");
        } finally {
            delete process.env.TOLARIA_ALLOW_RECEIPT_REBATCH;
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// #2527 F5: several sessions share `.claude/receipts` and nothing prunes it —
// a sibling batch directory can vanish, or become unreadable, between
// `findSiblingBatchWithIssue`'s `readdirSync(root)` and its later
// `readdirSync(siblingDir)` of one specific entry (a concurrent prune is the
// live shape; an unreadable directory reproduces the same failure class
// deterministically, since genuinely racing two synchronous fs calls in one
// process cannot be done without mocking a module whose "import *" binding
// vitest cannot patch). Either way, `writeReceipt` must not crash on it; it
// should just skip that sibling and carry on.
// ─────────────────────────────────────────────────────────────────────────────
describe("writeReceipt survives an unreadable sibling batch directory mid-scan", () => {
    it("skips a sibling directory readdirSync cannot read, instead of throwing out of writeReceipt", () => {
        const root = path.join(tmp, ".claude", "receipts");
        const ghostDir = path.join(root, "ghost-batch");
        fs.mkdirSync(ghostDir, { recursive: true });
        fs.chmodSync(ghostDir, 0o000);

        try {
            expect(() =>
                writeReceipt(tmp, "sess-new", workReceipt({ issue: 2182 }))
            ).not.toThrow();
            const [receipt] = readReceipts(tmp, "sess-new")
                .receipts as WorkReceipt[];
            expect(receipt.issue).toBe(2182);
        } finally {
            fs.chmodSync(ghostDir, 0o700);
        }
    });
});

describe("readReceipts detects tampering outside the sanctioned write path", () => {
    it("flags a live file whose name disagrees with its own contents", () => {
        const dir = receiptDir(tmp, "sess-1");
        fs.mkdirSync(dir, { recursive: true });
        // Content says round 1 (→ receiptFilename would emit the un-suffixed
        // name), but the file is hand-named as if it were round 2 — nothing
        // on the sanctioned write path can produce this.
        fs.writeFileSync(
            path.join(dir, "2182-implement-2.json"),
            JSON.stringify(parseReceipt(workReceipt()))
        );

        const { receipts, errors } = readReceipts(tmp, "sess-1");
        expect(receipts).toEqual([]);
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toMatch(/2182-implement-2\.json$/);
        expect(errors[0].message).toMatch(/does not match receiptFilename/);
        expect(errors[0].issue).toBe(2182);
    });

    it("flags a round sequence with a gap", () => {
        writeReceipt(tmp, "sess-1", reviewReceipt({ round: 1 }));
        writeReceipt(tmp, "sess-1", reviewReceipt({ round: 3 }));
        // Round 2 never landed (deleted, or never written) — 1 and 3 alone
        // are each individually well-formed and correctly named, but the
        // SEQUENCE is a gap the single-file check cannot see.
        const { errors } = readReceipts(tmp, "sess-1");
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toMatch(/round sequence has a gap/);
        expect(errors[0].issue).toBe(2182);
    });

    it("does not flag a clean, contiguous multi-round sequence", () => {
        writeReceipt(
            tmp,
            "sess-1",
            reviewReceipt({ outcome: "blocking", findings: ["x"] })
        );
        writeReceipt(tmp, "sess-1", reviewReceipt({ round: 2 }));
        writeReceipt(tmp, "sess-1", reviewReceipt({ round: 3 }));
        const { errors, receipts } = readReceipts(tmp, "sess-1");
        expect(errors).toEqual([]);
        expect(receipts).toHaveLength(3);
    });

    it("flags a LONE receipt whose round does not start at 1 — the round-1 blocking review was deleted (#2349)", () => {
        // Reproduces the reviewer's exact scenario: a batch containing
        // `10-implement.json` + `10-review-2.json` with NO `10-review.json`
        // on disk. The (issue 10, role review) group has exactly one
        // receipt, so the old `group.length < 2` guard skipped it — a
        // tampering signal (the round-1 blocking verdict deleted) that
        // reported `unreadable: []` and let a stale round-2 "approve" win.
        writeReceipt(tmp, "sess-1", workReceipt({ issue: 10 }));
        writeReceipt(
            tmp,
            "sess-1",
            reviewReceipt({ issue: 10, round: 2, outcome: "approve" })
        );
        const dir = receiptDir(tmp, "sess-1");
        expect(fs.existsSync(path.join(dir, "10-implement.json"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "10-review-2.json"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "10-review.json"))).toBe(false);

        const { errors } = readReceipts(tmp, "sess-1");
        const gap = errors.find(
            (e) => e.issue === 10 && /round sequence has a gap/.test(e.message)
        );
        expect(gap, JSON.stringify(errors)).toBeDefined();
    });

    it("does NOT flag a lone round-1 (or absent-round) receipt — no new false positive", () => {
        // The common, overwhelmingly frequent shape: one implement, one
        // review, no re-round. A lone receipt normalising to round 1 must
        // stay perfectly valid now that the size-1 guard is gone.
        writeReceipt(tmp, "sess-1", workReceipt());
        writeReceipt(tmp, "sess-1", reviewReceipt());
        const { errors, receipts } = readReceipts(tmp, "sess-1");
        expect(errors).toEqual([]);
        expect(receipts).toHaveLength(2);
    });

    it("does NOT flag a lone missing marker sharing an issue with a round-1 work receipt", () => {
        // `missing` receipts carry no `issue` and are excluded from the
        // round-sequence grouping entirely (they have no round). Confirms
        // removing the `group.length < 2` guard does not start pulling
        // `missing` markers into a group they were never meant to join.
        writeReceipt(tmp, "sess-1", workReceipt());
        fs.mkdirSync(receiptDir(tmp, "sess-1"), { recursive: true });
        fs.writeFileSync(
            path.join(receiptDir(tmp, "sess-1"), "missing-agent-1.json"),
            JSON.stringify(
                parseReceipt({
                    version: RECEIPT_VERSION,
                    role: "missing",
                    outcome: "missing",
                    session: "sess-1",
                    transcript: null,
                    agentId: "agent-1",
                    agentType: null,
                    agentTranscript: null,
                })
            )
        );
        const { errors } = readReceipts(tmp, "sess-1");
        expect(errors).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The SubagentStop hook. Its whole job is the case the subagent cannot cover:
// a subagent that crashed, was interrupted, or forgot leaves a FACT behind.
// ─────────────────────────────────────────────────────────────────────────────

function runHook(
    session: string,
    projectDir: string,
    transcript?: string,
    agent?: { id: string; type?: string; transcript?: string }
) {
    return spawnSync("sh", [HOOK], {
        input: JSON.stringify({
            session_id: session,
            hook_event_name: "SubagentStop",
            ...(transcript ? { transcript_path: transcript } : {}),
            ...(agent
                ? {
                      agent_id: agent.id,
                      ...(agent.type ? { agent_type: agent.type } : {}),
                      ...(agent.transcript
                          ? { agent_transcript_path: agent.transcript }
                          : {}),
                  }
                : {}),
        }),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });
}

const missingMarkers = (dir: string): string[] =>
    fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.startsWith("missing-"))
        : [];

describe("SubagentStop hook — a missing receipt is recorded as missing", () => {
    it("records a marker when the subagent wrote nothing", () => {
        const result = runHook("sess-1", tmp, "/tmp/transcript.jsonl");
        expect(result.status).toBe(0);
        const markers = missingMarkers(receiptDir(tmp, "sess-1"));
        expect(markers).toHaveLength(1);

        // The marker is a valid receipt — the scorecard reads it like any other.
        const parsed = parseReceipt(
            JSON.parse(
                fs.readFileSync(
                    path.join(receiptDir(tmp, "sess-1"), markers[0]),
                    "utf8"
                )
            )
        );
        expect(parsed.role).toBe("missing");
        expect(parsed.role === "missing" && parsed.transcript).toBe(
            "/tmp/transcript.jsonl"
        );
    });

    it("stays silent when the subagent DID write a receipt", () => {
        writeReceipt(tmp, "sess-1", workReceipt());
        expect(runHook("sess-1", tmp).status).toBe(0);
        expect(missingMarkers(receiptDir(tmp, "sess-1"))).toHaveLength(0);
    });

    it("accounts per subagent, not per session — the second stop with no new receipt is charged", () => {
        // Subagent A writes; its stop is clean.
        writeReceipt(tmp, "sess-1", workReceipt());
        runHook("sess-1", tmp);
        expect(missingMarkers(receiptDir(tmp, "sess-1"))).toHaveLength(0);

        // Subagent B writes nothing. A count-based hook would see one receipt
        // for two stops and stay silent; filename accounting catches it.
        runHook("sess-1", tmp);
        expect(missingMarkers(receiptDir(tmp, "sess-1"))).toHaveLength(1);

        // Subagent C writes — clean again, and the earlier marker survives.
        writeReceipt(tmp, "sess-1", workReceipt({ issue: 2183 }));
        runHook("sess-1", tmp);
        expect(missingMarkers(receiptDir(tmp, "sess-1"))).toHaveLength(1);
    });

    it("keeps sessions apart", () => {
        writeReceipt(tmp, "sess-1", workReceipt());
        runHook("sess-2", tmp);
        expect(missingMarkers(receiptDir(tmp, "sess-1"))).toHaveLength(0);
        expect(missingMarkers(receiptDir(tmp, "sess-2"))).toHaveLength(1);
    });

    // ─────────────────────────────────────────────────────────────────────
    // `SubagentStop` fires on EVERY yield of a background agent, not once per
    // subagent — 131 events for 4 subagents in one measured 94-minute run. A
    // marker minted per stop buried the real gaps under ~97% noise, so the
    // marker is keyed on `agent_id` and overwritten instead.
    // ─────────────────────────────────────────────────────────────────────

    it("collapses a background agent's repeated yields onto ONE marker", () => {
        for (let i = 0; i < 5; i++) {
            runHook("sess-1", tmp, "/tmp/parent.jsonl", { id: "agent-aaa" });
        }
        expect(missingMarkers(receiptDir(tmp, "sess-1"))).toEqual([
            "missing-agent-aaa.json",
        ]);
    });

    it("keeps one marker per subagent when several yield", () => {
        runHook("sess-1", tmp, undefined, { id: "agent-aaa" });
        runHook("sess-1", tmp, undefined, { id: "agent-bbb" });
        runHook("sess-1", tmp, undefined, { id: "agent-aaa" });
        expect(missingMarkers(receiptDir(tmp, "sess-1")).sort()).toEqual([
            "missing-agent-aaa.json",
            "missing-agent-bbb.json",
        ]);
    });

    it("clears an agent's marker once a receipt lands", () => {
        runHook("sess-1", tmp, undefined, { id: "agent-aaa" });
        expect(missingMarkers(receiptDir(tmp, "sess-1"))).toHaveLength(1);

        // The agent writes its receipt, then stops for good.
        writeReceipt(tmp, "sess-1", workReceipt());
        runHook("sess-1", tmp, undefined, { id: "agent-aaa" });
        expect(missingMarkers(receiptDir(tmp, "sess-1"))).toHaveLength(0);
    });

    it("re-marks an agent that yields again without delivering", () => {
        // A concurrent agent's receipt can clear the wrong marker — the hook
        // cannot attribute a receipt to an agent. It self-corrects: the agent
        // that still owes one is re-marked at its very next yield, so the end
        // state is right even when an intermediate one was not.
        runHook("sess-1", tmp, undefined, { id: "agent-aaa" });
        writeReceipt(tmp, "sess-1", workReceipt());
        runHook("sess-1", tmp, undefined, { id: "agent-aaa" });
        expect(missingMarkers(receiptDir(tmp, "sess-1"))).toHaveLength(0);

        runHook("sess-1", tmp, undefined, { id: "agent-aaa" });
        expect(missingMarkers(receiptDir(tmp, "sess-1"))).toEqual([
            "missing-agent-aaa.json",
        ]);
    });

    it("records which subagent left the gap, and its own transcript", () => {
        runHook("sess-1", tmp, "/tmp/parent.jsonl", {
            id: "agent-aaa",
            type: "general-purpose",
            transcript: "/tmp/subagents/agent-aaa.jsonl",
        });
        const parsed = parseReceipt(
            JSON.parse(
                fs.readFileSync(
                    path.join(
                        receiptDir(tmp, "sess-1"),
                        "missing-agent-aaa.json"
                    ),
                    "utf8"
                )
            )
        );
        expect(parsed.role).toBe("missing");
        if (parsed.role !== "missing") throw new Error("unreachable");
        expect(parsed.agentId).toBe("agent-aaa");
        expect(parsed.agentType).toBe("general-purpose");
        expect(parsed.agentTranscript).toBe("/tmp/subagents/agent-aaa.jsonl");
        // The parent transcript is still there, and is NOT the agent's own.
        expect(parsed.transcript).toBe("/tmp/parent.jsonl");
    });

    it("keeps an agent id from escaping the receipts directory", () => {
        runHook("sess-1", tmp, undefined, { id: "../../etc/passwd" });
        const markers = missingMarkers(receiptDir(tmp, "sess-1"));
        expect(markers).toHaveLength(1);
        expect(markers[0]).not.toContain("/");
        expect(fs.existsSync(path.join(tmp, "etc", "passwd"))).toBe(false);
    });

    it("parses a marker written by the older hook, which had no agent fields", () => {
        const parsed = parseReceipt({
            version: 1,
            role: "missing",
            outcome: "missing",
            session: "sess-1",
            transcript: "/tmp/parent.jsonl",
            ts: 1786097305,
        });
        expect(parsed.role === "missing" && parsed.agentId).toBe(null);
    });

    it("exits 0 with no session id rather than taking the run with it", () => {
        const result = spawnSync("sh", [HOOK], {
            input: "{}",
            encoding: "utf8",
            env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
        });
        expect(result.status).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// newestBatchDir (PR #2545 review, finding 4) — `loop:status` (#2519) uses
// this to decide which batch's receipts the whole view describes, so a wrong
// answer here silently points the dashboard/CLI at a stale batch. No test
// existed despite that.
// ─────────────────────────────────────────────────────────────────────────────

function touch(dir: string, mtimeMs: number): void {
    fs.mkdirSync(dir, { recursive: true });
    const t = mtimeMs / 1000;
    fs.utimesSync(dir, t, t);
}

describe("newestBatchDir", () => {
    it("returns undefined when the root does not exist", () => {
        expect(
            newestBatchDir(path.join(tmp, "does-not-exist"))
        ).toBeUndefined();
    });

    it("returns undefined for an existing but empty root (zero batch dirs)", () => {
        expect(newestBatchDir(tmp)).toBeUndefined();
    });

    it("picks the directory with the newest mtime, not the lexicographically last name", () => {
        const now = Date.now();
        touch(path.join(tmp, "sess-b-newer-name"), now - 10_000); // older mtime
        touch(path.join(tmp, "sess-a-older-name"), now); // newer mtime
        expect(newestBatchDir(tmp)).toBe("sess-a-older-name");
    });

    it("ignores plain files sitting next to the batch directories", () => {
        touch(path.join(tmp, "sess-1"), Date.now() - 5_000);
        fs.writeFileSync(path.join(tmp, "README.md"), "not a batch");
        // A stray file must never win just because fs.statSync happily
        // returns an mtime for it too.
        expect(newestBatchDir(tmp)).toBe("sess-1");
    });

    it("breaks an exact mtime tie by keeping whichever entry readdirSync visits first — arbitrary, but deterministic per platform readdir order, not random", () => {
        // `newestBatchDir` only updates `newest` on a STRICT `>` comparison,
        // so on a tie the FIRST entry `fs.readdirSync` returns keeps it and
        // every later tied entry is skipped. This is deliberately not
        // "latest name wins" or any other tie-break — it is whatever order
        // the filesystem's directory listing returns, which is stable for a
        // given directory's contents but not a documented ordering contract.
        const tie = Date.now();
        touch(path.join(tmp, "sess-x"), tie);
        touch(path.join(tmp, "sess-y"), tie);
        const winner = newestBatchDir(tmp);
        expect(fs.readdirSync(tmp)[0]).toBe(winner);
    });
});
