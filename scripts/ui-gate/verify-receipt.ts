#!/usr/bin/env bun
/**
 * `bun run verify:ui-receipt <PR#>` — mechanically verify a pasted
 * `check:ui` receipt in a PR body (issue #2760).
 *
 * WHY THIS EXISTS. `check:ui` labels its own output `RECEIPT` for a full walk
 * and `DIAGNOSTIC` for a `--surface=` subset, naming exactly what it skipped
 * — that makes the PRODUCER honest. The TRANSPORT (copying that output into
 * a PR body) was not: the label is plain text in a fenced block, and nothing
 * recomputed it. Two bypasses were observed in one batch: a full-lane header
 * pasted above rows covering two surfaces, and a subset run with the
 * disqualifying banner line deleted. Both were caught only by a reviewer
 * re-running the lane by hand and eyeballing a diff.
 *
 * WHAT "RE-RENDER THROUGH THE EVALUATOR" ACTUALLY MEANS HERE. `evaluateRun`
 * consumes `SurfaceWalk[]` — raw browser measurements. A pasted receipt does
 * NOT contain measurements; it contains already-rendered `ResultRow` lines.
 * The measurements are not recoverable from the text, so this file does not
 * try to reconstruct `SurfaceWalk[]` and call `evaluateRun` — that would
 * either be impossible (metrics genuinely lost) or would fabricate inputs
 * until the output matched, which verifies nothing.
 *
 * Instead: parse the pasted rows back into `ResultRow[]`
 * (`parseResultRowLine`), assemble an `Evaluation`-shaped value from them
 * (`measuredSurfaces`/`declaredUnwalked` derived from the rows themselves,
 * `knownSurfaces` from the real `SURFACE_IDS`, `receiptKind` from the REAL
 * `receiptKindOf`), then call the REAL `receiptKindLine()` / `coverageLine()`
 * / `formatResultRow()` on that value and diff the result against what was
 * pasted, byte for byte. This is genuinely "through the same renderer" — the
 * derived lines are RECOMPUTED from the claimed rows, never re-implemented —
 * and it catches both observed bypasses: a full-lane banner over rows
 * spanning too few surfaces (the recomputed banner comes back `DIAGNOSTIC`,
 * because `receiptKindOf` sees the gap against the real `SURFACE_IDS`), and
 * a subset run with its banner deleted (the recomputed banner is simply
 * absent from the paste, which is its own failure).
 *
 * THE ROW FORMAT IS FIXED-WIDTH VIA `padEnd`, WHICH IS LOSSY TO SPLIT ON
 * COLUMN OFFSETS: a surface id at or past 20 chars, or a `detail` containing
 * extra whitespace, breaks a positional parse. `parseResultRowLine` instead
 * matches against the real, FINITE surface/viewport vocabularies
 * (`SURFACE_IDS` / `VIEWPORT_IDS`), longest-id-first so one id can never
 * swallow another as a prefix. `formatResultRow` (`budgets.ts`) is the one
 * place the format string exists — this file never re-implements it.
 *
 * THE ELISION MARKER. One legitimate case must survive: a receipt may elide
 * the "known debt carried by the budgets" trailer `check:ui` prints — pure
 * `budgets.json` prose, duplicated verbatim, that can blow up a PR body's
 * size — behind `KNOWN_DEBT_ELISION_MARKER`. `check:ui`'s own print order is
 * banner → rows → coverage line → console errors → known-debt trailer →
 * screenshots/wall-time → pass/fail summary, so the known-debt trailer sits
 * OUTSIDE the region this file verifies (banner..rows..coverage). Eliding it
 * — marked or not — cannot touch a verdict row, a ceiling (embedded in a
 * row's own `detail`), the coverage line or the banner, because none of
 * those lines live in the trailer. The marker's job is narrower and
 * structural: if it appears INSIDE the verified region (between the banner
 * and the coverage line), that is treated as an attempt to disguise a
 * dropped row and rejected outright — the one place eliding is never safe.
 */

import { gh } from "../lib/gh.ts";
import {
    coverageLine,
    receiptKindLine,
    receiptKindOf,
    formatResultRow,
    type Evaluation,
    type ResultRow,
    type Verdict,
} from "./budgets.ts";
import { SURFACE_IDS } from "./surfaces.ts";
import { VIEWPORT_IDS } from "./viewports.ts";

const VERDICTS: readonly Verdict[] = ["PASS", "FAIL", "UNWALKED"];

/**
 * The marker a receipt may use IN PLACE OF the "known debt carried by the
 * budgets" trailer — see the module comment for why that section, and only
 * that section, is safe to elide. Anywhere else in the receipt this literal
 * string is rejected (see `extractReceiptRegion`).
 */
export const KNOWN_DEBT_ELISION_MARKER =
    "[check:ui receipt: known-debt trailer elided — verbatim in scripts/ui-gate/budgets.json]";

export interface ReceiptVerification {
    ok: boolean;
    /** One entry per parse failure or divergence. Empty iff `ok`. */
    problems: string[];
}

/**
 * Parse ONE printed row back into a `ResultRow`, matching against the real,
 * finite vocabularies rather than splitting on `padEnd`'s column offsets
 * (see the module comment). Longest-first within each vocabulary so one
 * surface/viewport id can never be swallowed as a prefix of another.
 */
export function parseResultRowLine(
    line: string,
    knownSurfaceIds: readonly string[],
    knownViewportIds: readonly string[]
): ResultRow | null {
    const surfaces = [...knownSurfaceIds].sort((a, b) => b.length - a.length);
    const viewports = [...knownViewportIds].sort((a, b) => b.length - a.length);

    for (const verdict of VERDICTS) {
        if (!line.startsWith(verdict)) continue;
        const afterVerdict = line.slice(verdict.length);
        if (!afterVerdict.startsWith(" ")) continue;
        const afterVerdictTrimmed = afterVerdict.replace(/^ +/, "");

        for (const surface of surfaces) {
            if (!afterVerdictTrimmed.startsWith(surface)) continue;
            const afterSurface = afterVerdictTrimmed.slice(surface.length);
            if (!afterSurface.startsWith(" ")) continue;
            const afterSurfaceTrimmed = afterSurface.replace(/^ +/, "");

            if (afterSurfaceTrimmed.startsWith("—")) {
                const afterViewport = afterSurfaceTrimmed.slice(1);
                if (!afterViewport.startsWith(" ")) continue;
                return {
                    surface,
                    viewport: null,
                    verdict,
                    detail: afterViewport.replace(/^ +/, ""),
                };
            }

            for (const viewport of viewports) {
                if (!afterSurfaceTrimmed.startsWith(viewport)) continue;
                const afterViewport = afterSurfaceTrimmed.slice(
                    viewport.length
                );
                if (!afterViewport.startsWith(" ")) continue;
                return {
                    surface,
                    viewport,
                    verdict,
                    detail: afterViewport.replace(/^ +/, ""),
                };
            }
        }
    }
    return null;
}

interface ParsedReceiptRegion {
    bannerLine: string;
    rows: ResultRow[];
    rowLines: string[];
    coverageLine: string;
}

/**
 * Locate and parse the banner → rows → coverage-line region inside a PR
 * body. Deliberately silent about anything OUTSIDE this region (trailer
 * content: known debt, console errors, screenshots, wall time, the final
 * summary) — that is exactly the region issue #2760 allows a receipt to
 * elide.
 */
export function extractReceiptRegion(
    body: string,
    knownSurfaceIds: readonly string[],
    knownViewportIds: readonly string[]
): { region: ParsedReceiptRegion | null; problems: string[] } {
    const lines = body.split(/\r?\n/);
    const bannerIdx = lines.findIndex((l) =>
        /^(RECEIPT|DIAGNOSTIC) —/.test(l.trim())
    );
    if (bannerIdx === -1) {
        return {
            region: null,
            problems: [
                "no RECEIPT/DIAGNOSTIC banner line found in the PR body — check:ui was not pasted, or the banner was removed",
            ],
        };
    }

    let coverageIdx = -1;
    for (let i = bannerIdx + 1; i < lines.length; i++) {
        if (
            /^coverage: \d+\/\d+ surfaces measured, \d+ declared unwalked$/.test(
                lines[i].trim()
            )
        ) {
            coverageIdx = i;
            break;
        }
    }
    if (coverageIdx === -1) {
        return {
            region: null,
            problems: [
                "no `coverage: …` line found after the banner — the row table was pasted without the line check:ui prints below it",
            ],
        };
    }

    const problems: string[] = [];
    const rows: ResultRow[] = [];
    const rowLines: string[] = [];
    for (let i = bannerIdx + 1; i < coverageIdx; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === "") continue;
        if (trimmed === KNOWN_DEBT_ELISION_MARKER) {
            problems.push(
                `line ${i + 1}: the known-debt elision marker cannot appear inside the verdict-row region — it may only replace the trailer AFTER the coverage line`
            );
            continue;
        }
        const row = parseResultRowLine(
            trimmed,
            knownSurfaceIds,
            knownViewportIds
        );
        if (!row) {
            problems.push(
                `line ${i + 1}: could not parse as a verdict row: ${JSON.stringify(trimmed)}`
            );
            continue;
        }
        rows.push(row);
        rowLines.push(trimmed);
    }

    if (rows.length === 0 && problems.length === 0) {
        problems.push(
            "no verdict rows found between the banner and the coverage line"
        );
    }

    return {
        region:
            problems.length === 0
                ? {
                      bannerLine: lines[bannerIdx].trim(),
                      rows,
                      rowLines,
                      coverageLine: lines[coverageIdx].trim(),
                  }
                : null,
        problems,
    };
}

/** A surface counts as measured (for the recomputed coverage line) iff it
 *  has at least one row and every row for it is PASS — the same predicate
 *  `evaluateRun`'s `surfaceComplete` flag encodes, read back off rows alone
 *  since that is all a pasted receipt gives us. */
function countMeasuredSurfaces(rows: readonly ResultRow[]): number {
    const bySurface = new Map<string, ResultRow[]>();
    for (const row of rows) {
        const list = bySurface.get(row.surface) ?? [];
        list.push(row);
        bySurface.set(row.surface, list);
    }
    let count = 0;
    for (const forSurface of bySurface.values()) {
        if (forSurface.every((r) => r.verdict === "PASS")) count++;
    }
    return count;
}

/**
 * The pure verification: given the PR body text and the real
 * surface/viewport vocabularies (defaulted to the real ones; overridable so
 * tests never depend on the live catalogue), decide whether the pasted
 * receipt matches what the real renderer would print for the rows it
 * claims.
 */
export function verifyReceiptText(
    body: string,
    definedSurfaceIds: readonly string[] = SURFACE_IDS,
    definedViewportIds: readonly string[] = VIEWPORT_IDS
): ReceiptVerification {
    const { region, problems } = extractReceiptRegion(
        body,
        definedSurfaceIds,
        definedViewportIds
    );
    if (!region) return { ok: false, problems };

    const knownSurfaceIds = [...new Set(region.rows.map((r) => r.surface))];
    const { kind: receiptKind, unmeasuredSurfaces } = receiptKindOf(
        knownSurfaceIds,
        definedSurfaceIds
    );

    const ev: Evaluation = {
        rows: region.rows,
        failures: [],
        measuredSurfaces: countMeasuredSurfaces(region.rows),
        declaredUnwalked: region.rows.filter(
            (r) =>
                r.verdict === "UNWALKED" &&
                r.detail.startsWith("declared unwalked:")
        ).length,
        knownSurfaces: knownSurfaceIds.length,
        knownDebt: [],
        receiptKind,
        unmeasuredSurfaces,
    };

    const mismatches: string[] = [];

    const expectedBanner = receiptKindLine(ev);
    if (region.bannerLine !== expectedBanner) {
        mismatches.push(
            `banner mismatch:\n  pasted:     ${region.bannerLine}\n  recomputed: ${expectedBanner}`
        );
    }

    const expectedCoverage = coverageLine(ev);
    if (region.coverageLine !== expectedCoverage) {
        mismatches.push(
            `coverage line mismatch:\n  pasted:     ${region.coverageLine}\n  recomputed: ${expectedCoverage}`
        );
    }

    region.rows.forEach((row, i) => {
        const expected = formatResultRow(row);
        if (region.rowLines[i] !== expected) {
            mismatches.push(
                `row ${i + 1} does not match the real renderer:\n  pasted:     ${region.rowLines[i]}\n  recomputed: ${expected}`
            );
        }
    });

    return { ok: mismatches.length === 0, problems: mismatches };
}

function usage(): never {
    console.error("usage: bun run verify:ui-receipt <PR#>");
    process.exit(2);
}

async function main(): Promise<number> {
    const arg = process.argv[2];
    const pr = Number((arg ?? "").replace(/^#/, ""));
    if (!Number.isInteger(pr) || pr <= 0) usage();

    const raw = gh(["pr", "view", String(pr), "--json", "body"]);
    const { body } = JSON.parse(raw) as { body: string };

    const result = verifyReceiptText(body);
    if (result.ok) {
        console.log(
            `verify:ui-receipt — PR #${pr}: check:ui receipt verified clean`
        );
        return 0;
    }
    console.error(
        `verify:ui-receipt — PR #${pr}: check:ui receipt verification FAILED`
    );
    for (const p of result.problems) console.error(`  · ${p}`);
    return 1;
}

if (import.meta.main) {
    main().then((code) => process.exit(code));
}
