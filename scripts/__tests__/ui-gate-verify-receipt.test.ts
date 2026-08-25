import { describe, it, expect } from "vitest";
import {
    BUDGET_KEYS,
    coverageLine,
    evaluateRun,
    formatResultRow,
    receiptKindLine,
    type BudgetFile,
    type Ceilings,
    type ResultRow,
    type SurfaceWalk,
} from "../ui-gate/budgets.ts";
import {
    KNOWN_DEBT_ELISION_MARKER,
    extractReceiptRegion,
    parseResultRowLine,
    verifyReceiptText,
} from "../ui-gate/verify-receipt.ts";

/**
 * Issue #2760 — nothing verified that a `check:ui` receipt PASTED into a PR
 * body still matched what the real evaluator/renderer would print for the
 * rows it claims. Both observed bypasses are reproduced here: a full-lane
 * banner over rows spanning too few surfaces, and a subset run with the
 * banner line deleted.
 *
 * `evaluateRun` consumes raw `SurfaceWalk[]` measurements, which a pasted
 * receipt does not contain (only the rendered `ResultRow` lines survive the
 * round trip through markdown) — so these tests build a REAL `Evaluation`
 * via `evaluateRun`, render it with the REAL `receiptKindLine`/
 * `coverageLine`/`formatResultRow`, paste the rendered text into a fake PR
 * body, then feed that text to `verifyReceiptText`. Every negative case
 * tampers with the RENDERED TEXT, exactly like a human editing a PR body —
 * never with the `Evaluation` object, which the verifier never sees.
 */

const ZERO: Ceilings = Object.fromEntries(
    BUDGET_KEYS.map((k) => [k, 0])
) as Ceilings;

function budgetFile(surfaces: BudgetFile["surfaces"]): BudgetFile {
    return { version: 1, recordedOn: "2026-08-25", surfaces };
}

function budgeted(
    viewports: Record<string, Ceilings>
): BudgetFile["surfaces"][string] {
    return { label: "test surface", status: "budgeted", viewports };
}

function measured(surface: string, viewport: string): SurfaceWalk {
    return {
        surface,
        status: "measured",
        measurements: [{ viewport, metrics: ZERO }],
    };
}

/** Render a real, clean, full-lane receipt: two surfaces, one viewport
 *  each, everything PASS. Returns the exact text `check:ui` would print for
 *  the banner..rows..coverage region. */
function realCleanReceipt(): {
    text: string;
    surfaceIds: string[];
    viewportIds: string[];
} {
    const surfaceIds = ["deck-builder", "lobby"];
    const viewportIds = ["1440x900x2"];
    const budgets = budgetFile({
        "deck-builder": budgeted({ "1440x900x2": ZERO }),
        lobby: budgeted({ "1440x900x2": ZERO }),
    });
    const walks: SurfaceWalk[] = [
        measured("deck-builder", "1440x900x2"),
        measured("lobby", "1440x900x2"),
    ];
    const ev = evaluateRun(budgets, surfaceIds, walks, surfaceIds);
    const lines = [
        receiptKindLine(ev),
        ...ev.rows.map(formatResultRow),
        coverageLine(ev),
    ];
    return { text: lines.join("\n"), surfaceIds, viewportIds };
}

function wrapInBody(receiptText: string): string {
    return [
        "Closes #2760",
        "",
        "## check:ui receipt",
        "",
        "```",
        "─── check:ui ───────────────────────────────────────────────────",
        receiptText,
        "console errors: none",
        "screenshots: scripts/ui-gate/.shots/",
        "wall time: 42s",
        "",
        "✓ check:ui passed",
        "```",
    ].join("\n");
}

describe("verify-receipt — parseResultRowLine", () => {
    const surfaces = [
        "deck-builder",
        "lobby",
        "draft-pick",
        "draft-pick-extra",
    ];
    const viewports = ["1440x900x2", "390x844x3"];

    it("round-trips every field through formatResultRow", () => {
        const rows: ResultRow[] = [
            {
                surface: "lobby",
                viewport: "1440x900x2",
                verdict: "PASS",
                detail: "cards zero0 occ0 stranded0",
            },
            {
                surface: "deck-builder",
                viewport: "390x844x3",
                verdict: "FAIL",
                detail: "over budget: cardsOcc 3 > 0",
            },
            {
                surface: "lobby",
                viewport: null,
                verdict: "UNWALKED",
                detail: "declared unwalked: no fixture yet",
            },
        ];
        for (const row of rows) {
            const line = formatResultRow(row);
            expect(parseResultRowLine(line, surfaces, viewports)).toEqual(row);
        }
    });

    it("does not let one surface id swallow another as a prefix (longest-first)", () => {
        const row: ResultRow = {
            surface: "draft-pick-extra",
            viewport: "1440x900x2",
            verdict: "PASS",
            detail: "ok",
        };
        const parsed = parseResultRowLine(
            formatResultRow(row),
            surfaces,
            viewports
        );
        expect(parsed?.surface).toBe("draft-pick-extra");
    });

    it("parses the em dash as a null viewport", () => {
        const row: ResultRow = {
            surface: "lobby",
            viewport: null,
            verdict: "UNWALKED",
            detail: "unreachable: login failed",
        };
        expect(
            parseResultRowLine(formatResultRow(row), surfaces, viewports)
        ).toEqual(row);
    });

    it("returns null for a line matching no known vocabulary", () => {
        expect(
            parseResultRowLine(
                "PASS     nonexistent-surface —            ok",
                surfaces,
                viewports
            )
        ).toBeNull();
    });
});

describe("verify-receipt — a clean, real receipt", () => {
    it("verifies clean when the paste matches the real renderer exactly", () => {
        const { text, surfaceIds, viewportIds } = realCleanReceipt();
        const result = verifyReceiptText(
            wrapInBody(text),
            surfaceIds,
            viewportIds
        );
        expect(result.ok).toBe(true);
        expect(result.problems).toEqual([]);
    });
});

describe("verify-receipt — rejects a subset presented as a full run (#2742-shaped bypass)", () => {
    it("recomputes DIAGNOSTIC when the pasted rows cover fewer surfaces than the real full set, no matter what banner sits above them", () => {
        const { text, surfaceIds, viewportIds } = realCleanReceipt();
        const lines = text.split("\n");
        // Drop the "lobby" row — the paste now covers only 1 of 2 in-scope
        // surfaces — but leave the RECEIPT banner (line 0) untouched, exactly
        // reproducing the observed bypass: "one pasted a full-lane header
        // above rows covering two surfaces."
        const tampered = [lines[0], lines[1], lines[lines.length - 1]].join(
            "\n"
        );
        expect(lines[0]).toMatch(/^RECEIPT —/);

        const result = verifyReceiptText(
            wrapInBody(tampered),
            surfaceIds,
            viewportIds
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(/banner mismatch/);
        expect(result.problems.join("\n")).toMatch(/DIAGNOSTIC/);
    });
});

describe("verify-receipt — rejects a receipt whose banner was removed or altered", () => {
    it("rejects when the banner line is deleted entirely (the other observed bypass: a subset run with the disqualifying line deleted)", () => {
        const { text, surfaceIds, viewportIds } = realCleanReceipt();
        const lines = text.split("\n");
        const withoutBanner = lines.slice(1).join("\n"); // drop the banner
        const result = verifyReceiptText(
            wrapInBody(withoutBanner),
            surfaceIds,
            viewportIds
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(
            /no RECEIPT\/DIAGNOSTIC banner/
        );
    });

    it("rejects when the banner wording was altered but rows/coverage were not", () => {
        const { text, surfaceIds, viewportIds } = realCleanReceipt();
        const lines = text.split("\n");
        lines[0] = lines[0].replace(
            /\(\d+ measured, \d+ declared unwalked\)/,
            "(999 measured, 0 declared unwalked)"
        );
        const result = verifyReceiptText(
            wrapInBody(lines.join("\n")),
            surfaceIds,
            viewportIds
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(/banner mismatch/);
    });
});

describe("verify-receipt — the known-debt elision marker", () => {
    it("accepts a marked elision that replaces only the trailer (after the coverage line) — every row/coverage/banner stays byte-identical", () => {
        const { text, surfaceIds, viewportIds } = realCleanReceipt();
        const body = [
            "Closes #2760",
            "",
            "```",
            text,
            KNOWN_DEBT_ELISION_MARKER,
            "console errors: none",
            "```",
        ].join("\n");
        const result = verifyReceiptText(body, surfaceIds, viewportIds);
        expect(result.ok).toBe(true);
    });

    it("rejects the marker when it stands in for a dropped verdict row instead of the trailer", () => {
        const { text, surfaceIds, viewportIds } = realCleanReceipt();
        const lines = text.split("\n");
        // Replace the SECOND row (a real verdict row, inside the
        // banner..coverage region) with the marker — this is exactly the
        // shape of "removing any verdict row" the marker must never be
        // allowed to disguise.
        const tampered = [...lines];
        tampered[2] = KNOWN_DEBT_ELISION_MARKER;
        const result = verifyReceiptText(
            wrapInBody(tampered.join("\n")),
            surfaceIds,
            viewportIds
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(
            /cannot appear inside the verdict-row region/
        );
    });

    it("rejects an elision that removes the coverage line, marker or not", () => {
        const { text, surfaceIds, viewportIds } = realCleanReceipt();
        const lines = text.split("\n");
        const withoutCoverage = lines.slice(0, -1).join("\n"); // drop coverage
        const result = verifyReceiptText(
            wrapInBody(withoutCoverage),
            surfaceIds,
            viewportIds
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(/no `coverage: …` line/);
    });
});

describe("verify-receipt — extractReceiptRegion", () => {
    it("is silent about trailer content — the region ends at the coverage line", () => {
        const { text, surfaceIds, viewportIds } = realCleanReceipt();
        const body = wrapInBody(text);
        const { region, problems } = extractReceiptRegion(
            body,
            surfaceIds,
            viewportIds
        );
        expect(problems).toEqual([]);
        expect(region?.coverageLine).toMatch(/^coverage: /);
    });
});

describe("verify-receipt — proof this suite would catch a broken recomputation", () => {
    // Proof-of-failure (not a permanent test): temporarily changed
    // `verifyReceiptText`'s banner comparison from `!==` to a no-op
    // (`false &&`) — "recomputes DIAGNOSTIC when the pasted rows cover
    // fewer surfaces…" and "rejects when the banner wording was altered…"
    // both went green-on-a-lie (they still failed for the RIGHT reason via
    // the coverage-line check, so this test independently pins the banner
    // check by itself). Reverted after confirming red; recorded in the PR
    // receipt's proofOfFailure list.
    it("banner-only tamper is caught even when coverage and rows are otherwise consistent", () => {
        const { text, surfaceIds, viewportIds } = realCleanReceipt();
        const lines = text.split("\n");
        expect(lines[0]).toMatch(/^RECEIPT —/);
        // Byte-different from the real renderer's output (extra trailing
        // word) while every OTHER line (rows, coverage) is untouched.
        lines[0] = `${lines[0]} (verified locally)`;
        const result = verifyReceiptText(
            wrapInBody(lines.join("\n")),
            surfaceIds,
            viewportIds
        );
        expect(result.ok).toBe(false);
    });
});
