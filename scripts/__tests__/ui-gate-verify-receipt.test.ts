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
    countMeasuredSurfaces,
    extractReceiptRegion,
    failCeilingProblems,
    parseResultRowLine,
    rowCensusProblems,
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

/** The real Viewport Matrix ids (ADR 0101) — used by the census tests below,
 *  which need MULTIPLE viewports per surface to have a viewport axis to
 *  delete a row from. */
const FIVE_VIEWPORTS = [
    "1440x900x2",
    "390x844x3",
    "844x390x3",
    "820x1180x2",
    "1180x820x2",
];

function measuredMulti(
    surface: string,
    metricsByViewport: Record<string, Ceilings>
): SurfaceWalk {
    return {
        surface,
        status: "measured",
        measurements: Object.entries(metricsByViewport).map(
            ([viewport, metrics]) => ({ viewport, metrics })
        ),
    };
}

/** Render a real, clean, full-lane receipt: two surfaces, all FIVE
 *  viewports, everything PASS — the shape the review's row-census
 *  reproduction (finding 1) actually used (2 surfaces x 5 viewports). */
function twoSurfaceFiveViewportReceipt(): {
    text: string;
    surfaceIds: string[];
    viewportIds: string[];
    budgets: BudgetFile;
} {
    const surfaceIds = ["deck-builder", "lobby"];
    const allZero = Object.fromEntries(FIVE_VIEWPORTS.map((v) => [v, ZERO]));
    const budgets = budgetFile({
        "deck-builder": budgeted(allZero),
        lobby: budgeted(allZero),
    });
    const walks: SurfaceWalk[] = surfaceIds.map((s) =>
        measuredMulti(s, allZero)
    );
    const ev = evaluateRun(budgets, surfaceIds, walks, surfaceIds);
    const lines = [
        receiptKindLine(ev),
        ...ev.rows.map(formatResultRow),
        coverageLine(ev),
    ];
    return {
        text: lines.join("\n"),
        surfaceIds,
        viewportIds: FIVE_VIEWPORTS,
        budgets,
    };
}

/** Same shape, but "lobby" genuinely FAILS at "390x844x3" (cardsOcc over
 *  budget) — the review's harder repro: "the same deletion plus a two-line
 *  edit of the banner/coverage counts also verified clean, hiding an
 *  over-budget viewport outright." */
function twoSurfaceWithGenuineFailReceipt(): {
    text: string;
    surfaceIds: string[];
    viewportIds: string[];
    budgets: BudgetFile;
} {
    const surfaceIds = ["deck-builder", "lobby"];
    const allZero = Object.fromEntries(FIVE_VIEWPORTS.map((v) => [v, ZERO]));
    const budgets = budgetFile({
        "deck-builder": budgeted(allZero),
        lobby: budgeted(allZero),
    });
    const OVER: Ceilings = { ...ZERO, cardsOcc: 3 };
    const walks: SurfaceWalk[] = [
        measuredMulti("deck-builder", allZero),
        measuredMulti("lobby", { ...allZero, "390x844x3": OVER }),
    ];
    const ev = evaluateRun(budgets, surfaceIds, walks, surfaceIds);
    const lines = [
        receiptKindLine(ev),
        ...ev.rows.map(formatResultRow),
        coverageLine(ev),
    ];
    return {
        text: lines.join("\n"),
        surfaceIds,
        viewportIds: FIVE_VIEWPORTS,
        budgets,
    };
}

/** Render a real, clean, full-lane receipt: two surfaces, one viewport
 *  each, everything PASS. Returns the exact text `check:ui` would print for
 *  the banner..rows..coverage region. */
function realCleanReceipt(): {
    text: string;
    surfaceIds: string[];
    viewportIds: string[];
    budgets: BudgetFile;
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
    return { text: lines.join("\n"), surfaceIds, viewportIds, budgets };
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
        const { text, surfaceIds, viewportIds, budgets } = realCleanReceipt();
        const result = verifyReceiptText(
            wrapInBody(text),
            surfaceIds,
            viewportIds,
            budgets
        );
        expect(result.ok).toBe(true);
        expect(result.problems).toEqual([]);
    });
});

describe("verify-receipt — rejects a subset presented as a full run (#2742-shaped bypass)", () => {
    it("recomputes DIAGNOSTIC when the pasted rows cover fewer surfaces than the real full set, no matter what banner sits above them", () => {
        const { text, surfaceIds, viewportIds, budgets } = realCleanReceipt();
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
            viewportIds,
            budgets
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(/banner mismatch/);
        expect(result.problems.join("\n")).toMatch(/DIAGNOSTIC/);
    });
});

describe("verify-receipt — rejects a receipt whose banner was removed or altered", () => {
    it("rejects when the banner line is deleted entirely (the other observed bypass: a subset run with the disqualifying line deleted)", () => {
        const { text, surfaceIds, viewportIds, budgets } = realCleanReceipt();
        const lines = text.split("\n");
        const withoutBanner = lines.slice(1).join("\n"); // drop the banner
        const result = verifyReceiptText(
            wrapInBody(withoutBanner),
            surfaceIds,
            viewportIds,
            budgets
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(
            /no RECEIPT\/DIAGNOSTIC banner/
        );
    });

    it("rejects when the banner wording was altered but rows/coverage were not", () => {
        const { text, surfaceIds, viewportIds, budgets } = realCleanReceipt();
        const lines = text.split("\n");
        lines[0] = lines[0].replace(
            /\(\d+ measured, \d+ declared unwalked\)/,
            "(999 measured, 0 declared unwalked)"
        );
        const result = verifyReceiptText(
            wrapInBody(lines.join("\n")),
            surfaceIds,
            viewportIds,
            budgets
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(/banner mismatch/);
    });
});

describe("verify-receipt — the known-debt elision marker", () => {
    it("accepts a marked elision that replaces only the trailer (after the coverage line) — every row/coverage/banner stays byte-identical", () => {
        const { text, surfaceIds, viewportIds, budgets } = realCleanReceipt();
        const body = [
            "Closes #2760",
            "",
            "```",
            text,
            KNOWN_DEBT_ELISION_MARKER,
            "console errors: none",
            "```",
        ].join("\n");
        const result = verifyReceiptText(
            body,
            surfaceIds,
            viewportIds,
            budgets
        );
        expect(result.ok).toBe(true);
    });

    it("rejects the marker when it stands in for a dropped verdict row instead of the trailer", () => {
        const { text, surfaceIds, viewportIds, budgets } = realCleanReceipt();
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
            viewportIds,
            budgets
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(
            /cannot appear inside the verdict-row region/
        );
    });

    it("rejects an elision that removes the coverage line, marker or not", () => {
        const { text, surfaceIds, viewportIds, budgets } = realCleanReceipt();
        const lines = text.split("\n");
        const withoutCoverage = lines.slice(0, -1).join("\n"); // drop coverage
        const result = verifyReceiptText(
            wrapInBody(withoutCoverage),
            surfaceIds,
            viewportIds,
            budgets
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(/no `coverage: …` line/);
    });
});

describe("verify-receipt — extractReceiptRegion", () => {
    it("is silent about trailer content — the region ends at the coverage line", () => {
        const { text, surfaceIds, viewportIds, budgets } = realCleanReceipt();
        const body = wrapInBody(text);
        const { region, problems } = extractReceiptRegion(
            body,
            surfaceIds,
            viewportIds,
            budgets
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
        const { text, surfaceIds, viewportIds, budgets } = realCleanReceipt();
        const lines = text.split("\n");
        expect(lines[0]).toMatch(/^RECEIPT —/);
        // Byte-different from the real renderer's output (extra trailing
        // word) while every OTHER line (rows, coverage) is untouched.
        lines[0] = `${lines[0]} (verified locally)`;
        const result = verifyReceiptText(
            wrapInBody(lines.join("\n")),
            surfaceIds,
            viewportIds,
            budgets
        );
        expect(result.ok).toBe(false);
    });
});

describe("verify-receipt — row census against budgets.json (issue #2760 review, finding 1)", () => {
    it("catches 8-of-10 rows deleted even when the banner/coverage are forged to match the trimmed set", () => {
        const { surfaceIds, viewportIds, budgets } =
            twoSurfaceFiveViewportReceipt();

        // Reproduce the review's exact bypass: keep only the "1440x900x2"
        // row per surface, discard the other 8, and forge a banner/coverage
        // that are SELF-CONSISTENT with the trimmed set — computed the same
        // way the real renderer would (via the already-fixed
        // `countMeasuredSurfaces`), so the byte-diff checks alone cannot
        // catch this. Only the census check, which walks `budgets.json`
        // directly, can.
        const trimmedRows: ResultRow[] = surfaceIds.map((surface) => ({
            surface,
            viewport: "1440x900x2",
            verdict: "PASS",
            detail: "cards zero0 occ0 stranded0 | ctrls zero0 occ0 stranded0 | starved0 | small0 | axe s0/c0",
        }));
        const forgedEv = {
            rows: trimmedRows,
            failures: [],
            measuredSurfaces: countMeasuredSurfaces(trimmedRows, budgets),
            declaredUnwalked: 0,
            knownSurfaces: surfaceIds.length,
            knownDebt: [],
            receiptKind: "RECEIPT" as const,
            unmeasuredSurfaces: [],
        };
        const forgedText = [
            receiptKindLine(forgedEv),
            ...trimmedRows.map(formatResultRow),
            coverageLine(forgedEv),
        ].join("\n");

        const result = verifyReceiptText(
            wrapInBody(forgedText),
            surfaceIds,
            viewportIds,
            budgets
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(/row census/);
        expect(result.problems.join("\n")).toMatch(
            /missing a verdict row for budgeted viewport/
        );
    });

    it("catches a genuine FAIL row's disappearance, not just a PASS row's", () => {
        const { surfaceIds, viewportIds, budgets } =
            twoSurfaceWithGenuineFailReceipt();

        // Same trim as above — keep only "1440x900x2" per surface. This
        // silently deletes the genuine FAIL at "lobby" @ "390x844x3", the
        // review's harder repro ("hiding an over-budget viewport outright").
        const trimmedRows: ResultRow[] = surfaceIds.map((surface) => ({
            surface,
            viewport: "1440x900x2",
            verdict: "PASS",
            detail: "cards zero0 occ0 stranded0 | ctrls zero0 occ0 stranded0 | starved0 | small0 | axe s0/c0",
        }));
        const forgedEv = {
            rows: trimmedRows,
            failures: [],
            measuredSurfaces: countMeasuredSurfaces(trimmedRows, budgets),
            declaredUnwalked: 0,
            knownSurfaces: surfaceIds.length,
            knownDebt: [],
            receiptKind: "RECEIPT" as const,
            unmeasuredSurfaces: [],
        };
        const forgedText = [
            receiptKindLine(forgedEv),
            ...trimmedRows.map(formatResultRow),
            coverageLine(forgedEv),
        ].join("\n");

        const result = verifyReceiptText(
            wrapInBody(forgedText),
            surfaceIds,
            viewportIds,
            budgets
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(/"lobby"/);
        expect(result.problems.join("\n")).toMatch(/390x844x3/);
    });

    // Proof-of-failure (not a permanent test): commented out the two
    // `mismatches.push(...rowCensusProblems(...))` /
    // `...failCeilingProblems(...)` lines in `verifyReceiptText` — both
    // tests above went green-on-a-lie (`result.ok` came back `true`).
    // Reverted after confirming red; recorded in the PR receipt's
    // `proofOfFailure` list.

    it("rowCensusProblems names every missing budgeted viewport, not just the first", () => {
        const budgets = budgetFile({
            lobby: budgeted(
                Object.fromEntries(FIVE_VIEWPORTS.map((v) => [v, ZERO]))
            ),
        });
        const onlyOneRow: ResultRow[] = [
            {
                surface: "lobby",
                viewport: "1440x900x2",
                verdict: "PASS",
                detail: "ok",
            },
        ];
        const problems = rowCensusProblems(onlyOneRow, budgets);
        expect(problems).toHaveLength(1);
        for (const vp of FIVE_VIEWPORTS.slice(1)) {
            expect(problems[0]).toContain(vp);
        }
    });

    it("failCeilingProblems catches a FAIL row whose claimed ceiling does not match budgets.json", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": ZERO }),
        });
        const tamperedFailRow: ResultRow[] = [
            {
                surface: "lobby",
                viewport: "390x844x3",
                verdict: "FAIL",
                // Claims the ceiling is 5, but budgets.json says 0.
                detail: "cards zero0 occ3 stranded0 — over budget: cardsOcc 3 > 5",
            },
        ];
        const problems = failCeilingProblems(tamperedFailRow, budgets);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/cardsOcc ceiling of 5/);
        expect(problems[0]).toMatch(/budgets\.json says 0/);
    });
});

describe("verify-receipt — countMeasuredSurfaces matches evaluateRun's surfaceComplete (issue #2760 review, finding 2)", () => {
    it("does not penalize an extra 'measured but no budget for this viewport' row — an honest, byte-perfect paste verifies clean", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "1440x900x2": ZERO }),
        });
        // The real walk measured an EXTRA viewport lobby is not budgeted
        // for — legitimate real output the moment `viewports.ts` grows
        // ahead of `budgets.json`, or a surface ships before its first
        // `--record` run (`budgets.ts:406-419`).
        const walk: SurfaceWalk = {
            surface: "lobby",
            status: "measured",
            measurements: [
                { viewport: "1440x900x2", metrics: ZERO },
                { viewport: "390x844x3", metrics: ZERO },
            ],
        };
        const ev = evaluateRun(budgets, ["lobby"], [walk], ["lobby"]);
        // Sanity: the real evaluator considers this surface COMPLETE.
        expect(ev.measuredSurfaces).toBe(1);

        const text = [
            receiptKindLine(ev),
            ...ev.rows.map(formatResultRow),
            coverageLine(ev),
        ].join("\n");

        const result = verifyReceiptText(
            wrapInBody(text),
            ["lobby"],
            ["1440x900x2", "390x844x3"],
            budgets
        );
        expect(result.ok).toBe(true);
        expect(result.problems).toEqual([]);
    });

    it("requires ALL budgeted viewports present, not just 'every existing row happens to be PASS'", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "1440x900x2": ZERO, "390x844x3": ZERO }),
        });
        const onlyOneOfTwo: ResultRow[] = [
            {
                surface: "lobby",
                viewport: "1440x900x2",
                verdict: "PASS",
                detail: "ok",
            },
        ];
        expect(countMeasuredSurfaces(onlyOneOfTwo, budgets)).toBe(0);
    });

    // Proof-of-failure (not a permanent test): reverted `countMeasuredSurfaces`
    // to the prior "every row for this surface is PASS" predicate — the first
    // test above went red (`banner mismatch` + `coverage line mismatch` on an
    // untampered, byte-perfect paste). Reverted after confirming red;
    // recorded in the PR receipt's `proofOfFailure` list.
});

describe("verify-receipt — the coverage-line comparison is independently guarded (issue #2760 review, finding 4)", () => {
    it("catches a coverage-line-only tamper when the banner and every row still match", () => {
        const { text, surfaceIds, viewportIds, budgets } = realCleanReceipt();
        const lines = text.split("\n");
        const coverageIdx = lines.length - 1;
        expect(lines[coverageIdx]).toMatch(/^coverage: /);
        lines[coverageIdx] = lines[coverageIdx].replace(
            /^coverage: \d+\//,
            "coverage: 1/"
        );
        const result = verifyReceiptText(
            wrapInBody(lines.join("\n")),
            surfaceIds,
            viewportIds,
            budgets
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(/coverage line mismatch/);
        expect(result.problems.join("\n")).not.toMatch(/banner mismatch/);
    });

    // Proof-of-failure (not a permanent test): changed the coverage-line
    // comparison in `verifyReceiptText` from `!==` to `false &&` — this test
    // went green-on-a-lie (`result.ok` came back `true`). Reverted after
    // confirming red; recorded in the PR receipt's `proofOfFailure` list.
});

describe("verify-receipt — the per-row byte-diff is independently guarded (issue #2760 review, finding 4)", () => {
    it("catches a row whose padding was reflowed to single spaces, even though it parses to the identical ResultRow (PR #2783/#2786-shaped)", () => {
        const { text, surfaceIds, viewportIds, budgets } = realCleanReceipt();
        const lines = text.split("\n");
        const rowIdx = 1; // first row line, right after the banner
        const collapsed = lines[rowIdx].replace(/ {2,}/g, " ");
        expect(collapsed).not.toBe(lines[rowIdx]); // sanity: the tamper changed something
        // Confirm it still parses to the identical row (the whole point of
        // the reflow bypass: a lossless-looking edit).
        expect(
            parseResultRowLine(collapsed, [...surfaceIds], [...viewportIds])
        ).toEqual(
            parseResultRowLine(lines[rowIdx], [...surfaceIds], [...viewportIds])
        );
        lines[rowIdx] = collapsed;
        const result = verifyReceiptText(
            wrapInBody(lines.join("\n")),
            surfaceIds,
            viewportIds,
            budgets
        );
        expect(result.ok).toBe(false);
        expect(result.problems.join("\n")).toMatch(
            /does not match the real renderer/
        );
        expect(result.problems.join("\n")).not.toMatch(/banner mismatch/);
        expect(result.problems.join("\n")).not.toMatch(
            /coverage line mismatch/
        );
    });

    // Proof-of-failure (not a permanent test): changed the per-row
    // comparison in `verifyReceiptText` from `!==` to `false &&` — this test
    // went green-on-a-lie (`result.ok` came back `true`). Reverted after
    // confirming red; recorded in the PR receipt's `proofOfFailure` list.
});
