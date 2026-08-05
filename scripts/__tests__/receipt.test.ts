import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
    RECEIPT_VERSION,
    ReceiptError,
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
        const [receipt] = readReceipts(tmp, "sess-1") as WorkReceipt[];
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

    it("reports the file when a receipt on disk is corrupt", () => {
        const dir = receiptDir(tmp, "sess-1");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "9-implement.json"), '{"version":99}');
        expect(() => readReceipts(tmp, "sess-1")).toThrow(
            /9-implement\.json: receipt\.version/
        );
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
            .map((r) => r.role)
            .sort();
        expect(roles).toEqual(["fixup", "implement", "review"]);
        // "Was this PR reviewed?" answered from disk alone.
        const review = readReceipts(tmp, "sess-1").find(
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
        const [receipt] = readReceipts(tmp, "sess-1") as WorkReceipt[];
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
// The SubagentStop hook. Its whole job is the case the subagent cannot cover:
// a subagent that crashed, was interrupted, or forgot leaves a FACT behind.
// ─────────────────────────────────────────────────────────────────────────────

function runHook(session: string, projectDir: string, transcript?: string) {
    return spawnSync("sh", [HOOK], {
        input: JSON.stringify({
            session_id: session,
            hook_event_name: "SubagentStop",
            ...(transcript ? { transcript_path: transcript } : {}),
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

    it("exits 0 with no session id rather than taking the run with it", () => {
        const result = spawnSync("sh", [HOOK], {
            input: "{}",
            encoding: "utf8",
            env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
        });
        expect(result.status).toBe(0);
    });
});
