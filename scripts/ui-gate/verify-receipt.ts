#!/usr/bin/env bun
/**
 * `bun run verify:ui-receipt <PR#>` — mechanically verify a pasted `check:ui`
 * receipt in a PR body (issue #2760), and the one decision `land` makes about
 * it (ADR 0132 §6, issue #3648).
 *
 * WHAT IS VERIFIED: THE VERDICT BLOCK, AND NOTHING ELSE. A receipt has two
 * blocks (`receipt.ts`). The verdict block — banner, one line per surface ×
 * viewport, coverage line — is a function of the tree and the scope, so it is
 * RE-DERIVED here: the only verdict block that lands is the all-`PASS` one, and
 * that block is fully determined by the scope. This file builds it by running
 * the REAL evaluator (`evaluateRun`) over a clean walk of every in-scope cell
 * and rendering it through the REAL renderer (`verdictBlockLines`), then diffs
 * the paste against it line by line. Nothing about the renderer is
 * re-implemented, and nothing the paste claims about the scope is trusted.
 *
 * The diagnostic block (after the coverage line) is never read: its shape
 * readings, load and wall time differ between two runs of one tree, and a
 * receipt that differs from a re-run only there verifies identically.
 *
 * REFUSED, each said out loud:
 *   - any line that is not `PASS` — `FAIL` (a broken Floor), `INFRA` (the
 *     machine cut the walk short, issue #3644), `UNWALKED` (never measured);
 *   - a cell the scope owes and the paste lacks, or a cell outside the scope;
 *   - a banner or coverage line that differs from the re-derived one, a row
 *     reflowed or reordered (never reflow a row, #2783/#2786);
 *   - a `DIAGNOSTIC` (a hand-picked `--surface=` subset, issue #2742);
 *   - a `SCOPED` receipt with no landing diff to re-derive its scope from, or
 *     for a diff that forces the full run (issue #3628, ADR 0131). A full
 *     `RECEIPT` satisfies any diff.
 *
 * THE ROW FORMAT IS FIXED-WIDTH VIA `padEnd`, which is lossy to split on column
 * offsets. `parseResultRowLine` matches the real, finite surface/viewport
 * vocabularies instead, longest-id-first so one id never swallows another.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { gh } from "../lib/gh.ts";
import { ORIGIN_BASE } from "../lib/branches.ts";
import { createImportGraph } from "../lib/import-graph.ts";
import { computeUiScope, type UiScope } from "../lib/ui-scope.ts";
import { UNWALKED_SURFACES, type UnwalkedSurface } from "./floors.ts";
import {
    evaluateRun,
    formatAssertRow,
    formatResultRow,
    verdictBlockLines,
    zeroReadings,
    type AssertRow,
    type DiffScope,
    type ResultRow,
    type SurfaceWalk,
    type Verdict,
    VERDICT_DIGEST_PREFIX,
    verdictDigest,
} from "./receipt.ts";
import { assertLabelsBySurface } from "./assertions.ts";
import { SURFACES, SURFACE_IDS } from "./surfaces.ts";
import { VIEWPORT_IDS } from "./viewports.ts";

/** The scope a landing diff re-derives, and the ref that diff was taken against. */
export interface ExpectedScope {
    base: string;
    scope: UiScope;
}

/**
 * The scope of a landing diff: `computeUiScope` over the real surface table
 * and the import graph of the tree at `root`. `check:ui` computes its run's
 * scope through this same function, so the scope a receipt was walked under
 * and the scope `land` checks it against cannot come from two derivations.
 */
export function landingDiffScope(
    changed: readonly string[],
    root: string
): UiScope {
    return computeUiScope({
        changed,
        surfaces: SURFACES,
        graph: createImportGraph({ root }),
    });
}

/** What a receipt is re-derived against. Overridable so tests never depend
 *  on the live surface table. */
export interface ReceiptVocabulary {
    surfaceIds: readonly string[];
    viewportIds: readonly string[];
    unwalked: readonly UnwalkedSurface[];
    /** The Named Assertion labels each surface promises, in declaration order
     *  — REQUIRED, and read without a fallback: a vocabulary that forgot it
     *  would expect no assertion line at all, and a paste with every one of
     *  them deleted would verify clean.
     *  (ADR 0132 §3, issue #3649). Re-derived from the surface table, never
     *  read off the paste: a receipt that dropped an assertion line is a
     *  receipt missing a cell the scope owes. */
    assertsBySurface: Record<string, readonly string[]>;
}

export const LANE_VOCABULARY: ReceiptVocabulary = {
    surfaceIds: SURFACE_IDS,
    viewportIds: VIEWPORT_IDS,
    unwalked: UNWALKED_SURFACES,
    assertsBySurface: assertLabelsBySurface(SURFACES),
};

const VERDICTS: readonly Verdict[] = ["PASS", "FAIL", "INFRA", "UNWALKED"];

export interface ReceiptVerification {
    ok: boolean;
    /** One entry per parse failure, refused line or divergence. Empty iff `ok`. */
    problems: string[];
}

/**
 * Parse ONE printed row back into a `ResultRow`, matching against the real,
 * finite vocabularies rather than splitting on `padEnd`'s column offsets.
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

export interface VerdictBlock {
    bannerLine: string;
    rows: ResultRow[];
    rowLines: string[];
    /** The Named Assertion lines, parsed (issue #3649). */
    assertRows: AssertRow[];
    assertLines: string[];
    /** Every line between banner and coverage line, in the pasted order —
     *  what the ordering check compares, so a paste that shuffled the two
     *  kinds together is refused even when each kind is individually right. */
    middleLines: string[];
    coverageLine: string;
    /** Set when the body carried the DIGEST form in place of the rows
     *  (issue #4419); `rows`/`assertRows` are then empty by construction. */
    digest?: VerdictDigest;
}

/**
 * Parse ONE printed assertion line back into an `AssertRow`. Same discipline
 * as `parseResultRowLine`: the finite vocabularies, longest-id-first, never
 * `padEnd`'s column offsets. The label is the rest of the line, so a label
 * containing spaces round-trips.
 */
export function parseAssertRowLine(
    line: string,
    knownSurfaceIds: readonly string[],
    knownViewportIds: readonly string[]
): AssertRow | null {
    if (!line.startsWith("assert ")) return null;
    const afterPrefix = line.slice("assert".length).replace(/^ +/, "");
    const surfaces = [...knownSurfaceIds].sort((a, b) => b.length - a.length);
    const viewports = [...knownViewportIds].sort((a, b) => b.length - a.length);

    for (const surface of surfaces) {
        if (!afterPrefix.startsWith(surface)) continue;
        const afterSurface = afterPrefix.slice(surface.length);
        if (!afterSurface.startsWith(" ")) continue;
        const afterSurfaceTrimmed = afterSurface.replace(/^ +/, "");
        for (const viewport of viewports) {
            if (!afterSurfaceTrimmed.startsWith(viewport)) continue;
            const afterViewport = afterSurfaceTrimmed
                .slice(viewport.length)
                .replace(/^ +/, "");
            for (const verdict of ["PASS", "FAIL"] as const) {
                if (!afterViewport.startsWith(`${verdict} `)) continue;
                const label = afterViewport
                    .slice(verdict.length)
                    .replace(/^ +/, "");
                if (label === "") return null;
                return { surface, viewport, label, verdict };
            }
        }
    }
    return null;
}

/**
 * Locate and parse the verdict block inside a PR body: the banner, the rows,
 * and the first `coverage: ` line after it. Everything after the coverage line
 * is the diagnostic block and is never read.
 */
/** A body that carried the DIGEST form instead of the whole block (issue
 *  #4419): the SHA-256 the paste claims, and the line count beside it. */
export interface VerdictDigest {
    sha256: string;
    lines: number;
}

/** Parse the digest line, or `null` if this is not one. */
export function parseDigestLine(line: string): VerdictDigest | null {
    if (!line.startsWith(VERDICT_DIGEST_PREFIX)) return null;
    const rest = line.slice(VERDICT_DIGEST_PREFIX.length).trim();
    const m = /^([0-9a-f]{64})\s+\((\d+) lines?\)$/.exec(rest);
    if (!m) return null;
    return { sha256: m[1], lines: Number(m[2]) };
}

export function extractVerdictBlock(
    body: string,
    vocab: ReceiptVocabulary
): { block: VerdictBlock | null; problems: string[] } {
    const lines = body.split(/\r?\n/).map((l) => l.trim());
    const bannerIdx = lines.findIndex((l) =>
        /^(RECEIPT|SCOPED|DIAGNOSTIC) —/.test(l)
    );
    if (bannerIdx === -1) {
        return {
            block: null,
            problems: [
                "no RECEIPT/SCOPED/DIAGNOSTIC banner line found in the PR body — check:ui was not pasted, or the banner was removed",
            ],
        };
    }
    const coverageIdx = lines.findIndex(
        (l, i) => i > bannerIdx && l.startsWith("coverage: ")
    );
    if (coverageIdx === -1) {
        return {
            block: null,
            problems: [
                "no `coverage: …` line found after the banner — the verdict block was pasted without the line that closes it",
            ],
        };
    }

    const middle = lines
        .slice(bannerIdx + 1, coverageIdx)
        .filter((l) => l !== "");
    // THE DIGEST FORM (issue #4419): banner, one `verdict-sha256:` line,
    // coverage. Recognised here rather than in the row parser so a body that
    // carries a digest AND stray rows is a parse error, not a half-read
    // block that verifies on the half it could read.
    if (middle.length === 1) {
        const digest = parseDigestLine(middle[0]);
        if (digest) {
            return {
                block: {
                    bannerLine: lines[bannerIdx],
                    rows: [],
                    rowLines: [],
                    assertRows: [],
                    assertLines: [],
                    middleLines: [],
                    coverageLine: lines[coverageIdx],
                    digest,
                },
                problems: [],
            };
        }
    }

    const problems: string[] = [];
    const rows: ResultRow[] = [];
    const rowLines: string[] = [];
    const assertRows: AssertRow[] = [];
    const assertLines: string[] = [];
    const middleLines: string[] = [];
    for (let i = bannerIdx + 1; i < coverageIdx; i++) {
        if (lines[i] === "") continue;
        const row = parseResultRowLine(
            lines[i],
            vocab.surfaceIds,
            vocab.viewportIds
        );
        if (row) {
            rows.push(row);
            rowLines.push(lines[i]);
            middleLines.push(lines[i]);
            continue;
        }
        const assertRow = parseAssertRowLine(
            lines[i],
            vocab.surfaceIds,
            vocab.viewportIds
        );
        if (!assertRow) {
            problems.push(
                `line ${i + 1}: could not parse as a verdict line: ${JSON.stringify(lines[i])}`
            );
            continue;
        }
        assertRows.push(assertRow);
        assertLines.push(lines[i]);
        middleLines.push(lines[i]);
    }

    return {
        block:
            problems.length === 0
                ? {
                      bannerLine: lines[bannerIdx],
                      rows,
                      rowLines,
                      assertRows,
                      assertLines,
                      middleLines,
                      coverageLine: lines[coverageIdx],
                  }
                : null,
        problems,
    };
}

function cellName(row: ResultRow): string {
    return `${row.surface} @ ${row.viewport ?? "—"}`;
}

function assertName(row: AssertRow): string {
    return `${row.surface} @ ${row.viewport} — ${JSON.stringify(row.label)}`;
}

/** One refusal naming every FAILED Named Assertion (issue #3649). A surface
 *  that stopped offering what it promises is a defect in the tree, exactly as
 *  a broken Floor is. */
export function failedAssertProblems(rows: readonly AssertRow[]): string[] {
    const failed = rows.filter((r) => r.verdict === "FAIL");
    if (failed.length === 0) return [];
    return [
        `the receipt carries ${failed.length} FAIL assertion line(s) (${failed
            .map(assertName)
            .join(
                "; "
            )}) — a surface stopped keeping a promise it declares: fix it and re-run check:ui`,
    ];
}

/** One refusal per non-`PASS` verdict present, naming every such cell. */
export function nonPassProblems(rows: readonly ResultRow[]): string[] {
    const said: Record<Exclude<Verdict, "PASS">, string> = {
        FAIL: "a broken Floor is a defect in the tree: fix it and re-run check:ui",
        INFRA: "the machine cut those walks short, so they are unproven: re-run check:ui once the load has dropped",
        UNWALKED:
            "the lane never measured them, so they are unproven: make the surface reachable, or declare it in UNWALKED_SURFACES with its issue",
    };
    const problems: string[] = [];
    for (const verdict of ["FAIL", "INFRA", "UNWALKED"] as const) {
        const hit = rows.filter((r) => r.verdict === verdict);
        if (hit.length === 0) continue;
        problems.push(
            `the receipt carries ${hit.length} ${verdict} line(s) (${hit.map((r) => `${cellName(r)}: ${r.detail}`).join("; ")}) — ${said[verdict]}`
        );
    }
    return problems;
}

/**
 * The surfaces a pasted banner claims to cover, re-derived — never read off
 * the banner. `RECEIPT` covers every defined surface; `SCOPED` covers exactly
 * the landing diff's scope; `DIAGNOSTIC` covers nothing a PR can land on.
 */
export function landableScope(
    bannerLine: string,
    vocab: ReceiptVocabulary,
    expected: ExpectedScope | null
):
    | { surfaces: readonly string[]; diffScope: DiffScope | null }
    | { problems: string[] } {
    if (bannerLine.startsWith("RECEIPT —")) {
        return { surfaces: vocab.surfaceIds, diffScope: null };
    }
    if (bannerLine.startsWith("DIAGNOSTIC —")) {
        return {
            problems: [
                "a DIAGNOSTIC (a hand-picked --surface= subset) is not a PR receipt — paste a full RECEIPT, or the SCOPED run of the landing diff",
            ],
        };
    }
    if (!expected) {
        return {
            problems: [
                "a SCOPED receipt covers only what its diff reaches, and no landing diff was given to re-derive that scope — verify it through `bun run land`, or paste a full RECEIPT",
            ],
        };
    }
    if (expected.scope.kind === "full") {
        return {
            problems: [
                `the landing diff forces the full run (${expected.scope.reason}) — a SCOPED receipt cannot cover it; paste a full RECEIPT`,
            ],
        };
    }
    return {
        surfaces: expected.scope.surfaces,
        diffScope: { base: expected.base, surfaces: expected.scope.surfaces },
    };
}

/**
 * The one verdict block that lands for `surfaces`: every walked cell `PASS`.
 * Built through the real evaluator and renderer over a clean walk, so it is
 * what `check:ui` prints for a green run of that scope, by construction.
 */
export function landableVerdictBlock(
    surfaces: readonly string[],
    vocab: ReceiptVocabulary,
    diffScope: DiffScope | null
): string[] {
    const walks: SurfaceWalk[] = surfaces.map((surface) => ({
        surface,
        status: "measured",
        measurements: vocab.viewportIds.map((viewport) => ({
            viewport,
            readings: zeroReadings(),
            // Every promise kept — the only outcome that lands, rendered
            // through the same evaluator `check:ui` prints from.
            asserts: (vocab.assertsBySurface[surface] ?? []).map((label) => ({
                label,
                ok: true,
                detail: "",
            })),
        })),
    }));
    return verdictBlockLines(
        evaluateRun({
            knownSurfaceIds: surfaces,
            walks,
            definedSurfaceIds: vocab.surfaceIds,
            viewportIds: vocab.viewportIds,
            unwalked: vocab.unwalked,
            diffScope,
            assertsBySurface: vocab.assertsBySurface,
        })
    );
}

/**
 * The pure verification. `expected` is the scope re-derived from the landing
 * diff (issue #3628); only a `SCOPED` paste needs it.
 */
export function verifyReceiptText(
    body: string,
    expected: ExpectedScope | null = null,
    vocab: ReceiptVocabulary = LANE_VOCABULARY
): ReceiptVerification {
    const { block, problems } = extractVerdictBlock(body, vocab);
    if (!block) return { ok: false, problems };

    const refused = [
        ...nonPassProblems(block.rows),
        ...failedAssertProblems(block.assertRows),
    ];
    const scope = landableScope(block.bannerLine, vocab, expected);
    if ("problems" in scope) {
        const all = [...scope.problems, ...refused];
        return { ok: false, problems: all };
    }

    const [expectedBanner, ...rest] = landableVerdictBlock(
        scope.surfaces,
        vocab,
        scope.diffScope
    );
    const expectedCoverage = rest.pop()!;
    const expectedMiddle = rest;

    // THE DIGEST FORM (issue #4419). The block is re-derived either way; this
    // branch compares its SHA-256 instead of diffing 1,141 lines the body
    // cannot hold. A run that broke a Floor, missed a cell or lost an
    // assertion renders different lines and hashes differently, so the claim
    // is the same one — see `receipt.ts` § THE DIGEST FORM.
    if (block.digest) {
        const problems: string[] = [];
        if (block.bannerLine !== expectedBanner) {
            problems.push(
                `banner mismatch:\n  pasted:      ${block.bannerLine}\n  re-derived:  ${expectedBanner}`
            );
        }
        const expectedDigest = verdictDigest(expectedMiddle);
        if (block.digest.lines !== expectedMiddle.length) {
            problems.push(
                `the digest claims ${block.digest.lines} verdict line(s); this tree's scope owes ${expectedMiddle.length}`
            );
        }
        if (block.digest.sha256 !== expectedDigest) {
            problems.push(
                `verdict digest mismatch — the pasted run is not a run of this tree at this scope:\n  pasted:      ${block.digest.sha256}\n  re-derived:  ${expectedDigest}`
            );
        }
        if (block.coverageLine !== expectedCoverage) {
            problems.push(
                `coverage line mismatch:\n  pasted:      ${block.coverageLine}\n  re-derived:  ${expectedCoverage}`
            );
        }
        return { ok: problems.length === 0, problems };
    }

    const expectedRows = expectedMiddle.filter(
        (line) =>
            parseResultRowLine(line, vocab.surfaceIds, vocab.viewportIds) !==
            null
    );
    const expectedAssertLines = expectedMiddle.filter(
        (line) =>
            parseAssertRowLine(line, vocab.surfaceIds, vocab.viewportIds) !==
            null
    );
    const mismatches: string[] = [...refused];

    if (block.bannerLine !== expectedBanner) {
        mismatches.push(
            `banner mismatch:\n  pasted:      ${block.bannerLine}\n  re-derived:  ${expectedBanner}`
        );
    }

    const key = (r: ResultRow) => `${r.surface}\0${r.viewport ?? ""}`;
    const expectedByCell = new Map<string, string>();
    for (const line of expectedRows) {
        const row = parseResultRowLine(
            line,
            vocab.surfaceIds,
            vocab.viewportIds
        )!;
        expectedByCell.set(key(row), line);
    }
    const pastedCells = new Set(block.rows.map(key));

    const missing = expectedRows
        .map(
            (line) =>
                parseResultRowLine(line, vocab.surfaceIds, vocab.viewportIds)!
        )
        .filter((row) => !pastedCells.has(key(row)));
    if (missing.length > 0) {
        mismatches.push(
            `the receipt is missing ${missing.length} cell(s) its scope owes: ${missing.map(cellName).join(", ")}`
        );
    }
    const outside = block.rows.filter((row) => !expectedByCell.has(key(row)));
    if (outside.length > 0) {
        mismatches.push(
            `the receipt carries ${outside.length} line(s) outside its scope: ${outside.map(cellName).join(", ")}`
        );
    }

    // Byte-diff only the PASS lines of owed cells: a non-PASS line was refused
    // above, and reporting it a second time as a mismatch says nothing new.
    block.rows.forEach((row, i) => {
        const owed = expectedByCell.get(key(row));
        if (owed === undefined || row.verdict !== "PASS") return;
        if (block.rowLines[i] !== owed) {
            mismatches.push(
                `line for ${cellName(row)} does not match the renderer:\n  pasted:      ${block.rowLines[i]}\n  re-derived:  ${owed}`
            );
        }
    });

    // The Named Assertions, on the same terms (issue #3649): every promise the
    // scope's surfaces make owes a line, nothing may claim a promise the
    // surface table does not declare, and each line is byte-compared.
    const assertKey = (r: AssertRow) =>
        `${r.surface}\0${r.viewport}\0${r.label}`;
    const expectedByAssert = new Map<string, string>();
    for (const line of expectedAssertLines) {
        const row = parseAssertRowLine(
            line,
            vocab.surfaceIds,
            vocab.viewportIds
        )!;
        expectedByAssert.set(assertKey(row), line);
    }
    const pastedAsserts = new Set(block.assertRows.map(assertKey));
    const missingAsserts = expectedAssertLines
        .map(
            (line) =>
                parseAssertRowLine(line, vocab.surfaceIds, vocab.viewportIds)!
        )
        .filter((row) => !pastedAsserts.has(assertKey(row)));
    if (missingAsserts.length > 0) {
        mismatches.push(
            `the receipt is missing ${missingAsserts.length} assertion line(s) its scope owes: ${missingAsserts.map(assertName).join(", ")} — an assertion nobody ran is not one that passed`
        );
    }
    const outsideAsserts = block.assertRows.filter(
        (row) => !expectedByAssert.has(assertKey(row))
    );
    if (outsideAsserts.length > 0) {
        mismatches.push(
            `the receipt carries ${outsideAsserts.length} assertion line(s) the surface table does not declare: ${outsideAsserts.map(assertName).join(", ")}`
        );
    }
    block.assertRows.forEach((row, i) => {
        const owed = expectedByAssert.get(assertKey(row));
        if (owed === undefined || row.verdict !== "PASS") return;
        if (block.assertLines[i] !== owed) {
            mismatches.push(
                `assertion line for ${assertName(row)} does not match the renderer:\n  pasted:      ${block.assertLines[i]}\n  re-derived:  ${owed}`
            );
        }
    });

    if (
        mismatches.length === 0 &&
        block.middleLines.join("\n") !== expectedMiddle.join("\n")
    ) {
        mismatches.push(
            "the verdict lines are not in the order check:ui prints them (surface table, then viewport matrix, then the assertions)"
        );
    }

    if (block.coverageLine !== expectedCoverage) {
        mismatches.push(
            `coverage line mismatch:\n  pasted:      ${block.coverageLine}\n  re-derived:  ${expectedCoverage}`
        );
    }

    return { ok: mismatches.length === 0, problems: mismatches };
}

/** Re-exported for callers that render a row in a message. */
export { formatAssertRow, formatResultRow };

function usage(): never {
    console.error("usage: bun run verify:ui-receipt <PR#>");
    process.exit(2);
}

async function main(): Promise<number> {
    const arg = process.argv[2];
    const pr = Number((arg ?? "").replace(/^#/, ""));
    if (!Number.isInteger(pr) || pr <= 0) usage();

    const raw = gh(["pr", "view", String(pr), "--json", "body,files"]);
    const { body, files } = JSON.parse(raw) as {
        body: string;
        files: { path: string }[];
    };
    // `gh pr view --json files` caps the list at 100 entries: a scope derived
    // from a truncated list could be narrower than the PR's. `land` never
    // reads this list — it diffs the landing worktree — so this is a warning.
    if (files.length >= 100) {
        console.warn(
            `verify:ui-receipt — PR #${pr}: GitHub returned ${files.length} changed files, possibly truncated; the scope may be too narrow. \`bun run land\` derives it from the worktree and is authoritative.`
        );
    }

    // The PR's changed paths come from GitHub; the import graph they are
    // placed in is THIS checkout's — run it from the PR's worktree. `land`
    // derives both from the landing worktree itself.
    const root = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        ".."
    );
    const expected: ExpectedScope = {
        base: ORIGIN_BASE,
        scope: landingDiffScope(
            files.map((f) => f.path),
            root
        ),
    };
    const result = verifyReceiptText(body, expected);
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
