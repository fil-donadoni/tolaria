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
    loadBudgets,
    BUDGET_KEYS,
    type BudgetFile,
    type BudgetKey,
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

/**
 * A surface counts as measured iff EVERY viewport `budgets.json` budgets for
 * it appears among its rows, all as PASS — this is `evaluateRun`'s real
 * `surfaceComplete` (issue #2760 review, finding 2), not the "every row for
 * this surface happens to be PASS" the prior version checked.
 *
 * Those two are NOT equivalent, and the gap is `budgets.ts:406-419`:
 * `evaluateRun` can push an extra "measured but no budget for this viewport"
 * UNWALKED row for a surface WITHOUT ever clearing `surfaceComplete` — that
 * row is about a viewport `budgets.json` does not cover, which is simply not
 * part of what "this surface is complete" means. The prior predicate treated
 * that row as disqualifying, so an honest, byte-perfect, unmodified paste of
 * exactly that shape was rejected (banner AND coverage mismatch) even though
 * it is the correct, unmodified output of the real evaluator — reachable the
 * moment a viewport is added to `viewports.ts` ahead of a `budgets.json`
 * update, or a surface ships before its first `--record` run.
 *
 * Grouping rows by surface and requiring every BUDGETED viewport present (no
 * more, no fewer) as PASS also gives the row-census check
 * (`rowCensusProblems`) a second, independent line of defense: a paste that
 * drops a budgeted viewport's row now undercounts here too, so the banner
 * and coverage lines a forger recomputed from the SAME (already-fixed) logic
 * would themselves go inconsistent unless the forger also hand-edits this
 * count — which `rowCensusProblems` catches regardless of what the banner or
 * coverage line claims.
 */
export function countMeasuredSurfaces(
    rows: readonly ResultRow[],
    budgets: BudgetFile
): number {
    const bySurface = new Map<string, ResultRow[]>();
    for (const row of rows) {
        const list = bySurface.get(row.surface) ?? [];
        list.push(row);
        bySurface.set(row.surface, list);
    }
    let count = 0;
    for (const [surface, forSurface] of bySurface) {
        const budget = budgets.surfaces[surface];
        if (!budget || budget.status !== "budgeted") {
            // No budget to check completeness against (undeclared, or
            // declared unwalked) — falls back to the old all-PASS predicate,
            // which is harmless here since neither shape is ever "complete".
            if (forSurface.every((r) => r.verdict === "PASS")) count++;
            continue;
        }
        const budgetedViewports = new Set(Object.keys(budget.viewports ?? {}));
        if (budgetedViewports.size === 0) continue;

        const budgetedRows = forSurface.filter(
            (r) => r.viewport !== null && budgetedViewports.has(r.viewport)
        );
        const presentViewports = new Set(budgetedRows.map((r) => r.viewport));
        const complete =
            presentViewports.size === budgetedViewports.size &&
            budgetedRows.every((r) => r.verdict === "PASS");
        if (complete) count++;
    }
    return count;
}

/**
 * The row-census check (issue #2760 review, finding 1 — the HIGH one).
 * Nothing previously anchored a pasted receipt's rows to `budgets.json`, so
 * only the SURFACE axis was ever checked (via `receiptKindOf`'s
 * RECEIPT/DIAGNOSTIC label, which compares surface ids only): a paste could
 * delete every viewport row for a surface but ONE and keep the surface
 * itself represented, and nothing caught the missing viewport axis — not
 * even a genuine FAIL row's disappearance, since a forger who also
 * hand-edits the banner/coverage counts to match the shrunken row set makes
 * those byte-diffs agree with each other by construction (they are both
 * derived FROM the same rows). This check does not care what the banner or
 * coverage line say: it walks `budgets.json` directly and requires a row for
 * every (surface, budgeted-viewport) pair among the surfaces the paste
 * actually claims to cover.
 *
 * Scoped to surfaces present in the paste's own rows — a surface missing
 * ENTIRELY is already the `receiptKindOf`/banner check's job (it shows up as
 * a DIAGNOSTIC banner disagreeing with a RECEIPT paste); this only closes
 * the gap one level down, a surface PARTIALLY present.
 */
export function rowCensusProblems(
    rows: readonly ResultRow[],
    budgets: BudgetFile
): string[] {
    const problems: string[] = [];
    const bySurface = new Map<string, ResultRow[]>();
    for (const row of rows) {
        const list = bySurface.get(row.surface) ?? [];
        list.push(row);
        bySurface.set(row.surface, list);
    }

    for (const [surface, surfaceRows] of bySurface) {
        const budget = budgets.surfaces[surface];
        if (!budget) continue; // undeclared entirely — a different failure shape, not this check's job

        const seenViewports = new Set(surfaceRows.map((r) => r.viewport));

        if (budget.status === "unwalked") {
            if (!seenViewports.has(null)) {
                problems.push(
                    `row census: "${surface}" is declared unwalked in budgets.json, but the paste carries no whole-surface row for it`
                );
            }
            continue;
        }

        const budgetedViewports = Object.keys(budget.viewports ?? {});
        if (budgetedViewports.length === 0) {
            if (!seenViewports.has(null)) {
                problems.push(
                    `row census: "${surface}" is budgeted with no viewport ceilings, so the paste should carry a single whole-surface row for it`
                );
            }
            continue;
        }

        const missing = budgetedViewports.filter(
            (vp) => !seenViewports.has(vp)
        );
        if (missing.length > 0) {
            problems.push(
                `row census: "${surface}" is missing a verdict row for budgeted viewport(s) ${missing.join(", ")} — budgets.json requires ${budgetedViewports.length} row(s) for this surface, the paste has ${surfaceRows.length}`
            );
        }
    }

    return problems;
}

/** Matches one `<key> <actual> > <ceiling>` token inside a FAIL row's
 *  "over budget: …" suffix (see `evaluateRun`'s `over.push` in `budgets.ts`). */
const OVER_BUDGET_TOKEN = /([A-Za-z]+) (-?\d+(?:\.\d+)?) > (-?\d+(?:\.\d+)?)/g;

/**
 * Cross-checks the CEILING half of a FAIL row's "over budget: key val >
 * ceiling" text against the real ceiling in `budgets.json` (issue #2760
 * review, finding 1's closing sentence — "FAIL-row ceilings in detail text
 * are likewise never compared to budgets.json"). The per-row byte-diff in
 * `verifyReceiptText` only proves a row round-trips through
 * `parseResultRowLine`/`formatResultRow` unchanged; it says nothing about
 * whether the NUMBERS inside `detail` are honest, because `detail` is opaque
 * free text to that check. This walks the finite `BUDGET_KEYS` vocabulary
 * over the "over budget:" suffix and compares each claimed ceiling to the
 * real one.
 */
export function failCeilingProblems(
    rows: readonly ResultRow[],
    budgets: BudgetFile
): string[] {
    const problems: string[] = [];
    const keySet = new Set<string>(BUDGET_KEYS);
    for (const row of rows) {
        if (row.verdict !== "FAIL" || row.viewport === null) continue;
        const budget = budgets.surfaces[row.surface];
        const ceilings =
            budget?.status === "budgeted"
                ? budget.viewports?.[row.viewport]
                : undefined;
        if (!ceilings) continue; // no ceiling to check against — the census check above already flags this shape

        const overIdx = row.detail.indexOf("over budget:");
        if (overIdx === -1) continue; // shape mismatch is the row byte-diff's job, not this one's
        const overText = row.detail.slice(overIdx);
        for (const m of overText.matchAll(OVER_BUDGET_TOKEN)) {
            const [, key, , claimedCeiling] = m;
            if (!keySet.has(key)) continue;
            const real = ceilings[key as BudgetKey];
            if (real !== undefined && String(real) !== claimedCeiling) {
                problems.push(
                    `row census: "${row.surface}" @ ${row.viewport} claims a ${key} ceiling of ${claimedCeiling}, but budgets.json says ${real}`
                );
            }
        }
    }
    return problems;
}

/**
 * The pure verification: given the PR body text, the real surface/viewport
 * vocabularies and the real budget file (all defaulted to the real ones;
 * overridable so tests never depend on the live catalogue), decide whether
 * the pasted receipt matches what the real renderer would print for the rows
 * it claims, AND that the rows it claims are the complete census
 * `budgets.json` requires (issue #2760 review, finding 1) — the two checks
 * this file existed for before this fix only ever verified the FIRST half.
 */
export function verifyReceiptText(
    body: string,
    definedSurfaceIds: readonly string[] = SURFACE_IDS,
    definedViewportIds: readonly string[] = VIEWPORT_IDS,
    budgets: BudgetFile = loadBudgets()
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
        measuredSurfaces: countMeasuredSurfaces(region.rows, budgets),
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

    // The row-census + FAIL-ceiling checks (finding 1) — independent of the
    // banner/coverage/per-row checks above: they compare the pasted rows
    // directly against `budgets.json`, so a forger who recomputes a
    // self-consistent banner/coverage FROM a trimmed row set cannot satisfy
    // them by construction.
    mismatches.push(...rowCensusProblems(region.rows, budgets));
    mismatches.push(...failCeilingProblems(region.rows, budgets));

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
