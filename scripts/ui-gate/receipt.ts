/**
 * The receipt `bun run check:ui` prints, and the PURE evaluation behind it
 * (ADR 0132 §1, §2, §6; issue #3648) — unit-tested without a browser
 * (`scripts/__tests__/ui-gate-floors.test.ts`), and the one renderer
 * `verify-receipt.ts` re-derives a pasted receipt through.
 *
 * THE RECEIPT HAS TWO BLOCKS.
 *
 *   1. The VERDICT BLOCK — the banner (kind, base, scope per ADR 0131), one line
 *      per surface × viewport saying `PASS|FAIL|INFRA|UNWALKED` with any broken
 *      Floor and its reading, and the coverage line. It is a function of the
 *      tree and the scope only: two runs of one tree print it byte-identical,
 *      which is what lets `land` re-derive it from the PR's diff and refuse on
 *      any mismatch or any line that is not `PASS`.
 *   2. The DIAGNOSTIC BLOCK — below `DIAGNOSTIC_SEPARATOR`: the Shape Readings
 *      of every measured cell, the infra signatures with their load and reason,
 *      then (printed by `index.ts`) the machine load, console errors, the
 *      screenshots and the wall time. For the reader; `land` never reads it.
 *
 * A SURFACE THE LANE COULD NOT MEASURE IS NEVER GREEN. Three shapes are kept
 * apart:
 *
 *   - DECLARED unwalked — an entry in `UNWALKED_SURFACES` (`floors.ts`), in
 *     code, with a reason and an issue. No row; named on the coverage line,
 *     counted out of the measured numerator, not a failure.
 *   - UNREACHABLE / NOT ATTEMPTED — a surface the run should have walked and
 *     has no measurement for: an `UNWALKED` row, and a red run.
 *   - INFRA (issue #3644) — a cell the machine cut short, standing after the
 *     lane's retries: an `INFRA` row, unproven, a red run, never a UI failure.
 */
import {
    FLOORS,
    SHAPE_READINGS,
    brokenFloors,
    type Readings,
    type UnwalkedSurface,
} from "./floors.ts";
import { infraDetail, type InfraSignature } from "./infra-verdict.ts";

/** One surface × viewport measurement handed back by the browser half. */
export interface Measurement {
    viewport: string;
    readings: Readings;
}

/** A cell (surface × viewport) the machine cut short, standing after the
 *  lane's retries (`infra-verdict.ts`, issue #3644). */
export interface InfraCell {
    viewport: string;
    signature: InfraSignature;
    /** The 1-minute load average when the last attempt failed. */
    load: number;
    /** What the last attempt failed on. */
    reason: string;
}

/** What the browser half reports for one surface. `infra` lists the viewports
 *  that stood as an Infra Verdict instead of producing a measurement. */
export type SurfaceWalk =
    | {
          surface: string;
          status: "measured";
          measurements: Measurement[];
          infra?: InfraCell[];
      }
    | { surface: string; status: "unreachable"; reason: string };

/**
 * `INFRA` (issue #3644) is the outcome beside pass and fail: the walk was cut
 * short by the machine and stood after the retries. `UNWALKED` is a walk that
 * could not reach the surface on a quiet machine.
 */
export type Verdict = "PASS" | "FAIL" | "INFRA" | "UNWALKED";

/**
 * A full walk — every surface the lane defines — is `RECEIPT`, a PR receipt
 * for any diff. A run the diff scoped (ADR 0131, `scripts/lib/ui-scope.ts`) is
 * `SCOPED`, a receipt for THAT diff only: `land` re-derives the scope from the
 * PR's own diff. A hand-picked `--surface=` subset is `DIAGNOSTIC` and never a
 * receipt (issue #2742).
 *
 * A SCOPE claim only, orthogonal to pass/fail: `FAIL` and `UNWALKED` keep their
 * meanings and exit codes whatever the kind.
 */
export type ReceiptKind = "RECEIPT" | "SCOPED" | "DIAGNOSTIC";

/** The diff scope a run was started under: the ref the diff was taken
 *  against and the surfaces it selected, in surface-table order. */
export interface DiffScope {
    base: string;
    surfaces: readonly string[];
}

export interface ReceiptKindResult {
    kind: ReceiptKind;
    /** Surfaces `definedSurfaceIds` names that this run did not request. */
    unmeasuredSurfaces: string[];
}

/**
 * Pure function of the requested surface set against the full surface list.
 * A request naming every defined surface is `RECEIPT`; a request equal to
 * `diffScope`'s surfaces is `SCOPED`; anything else is `DIAGNOSTIC`.
 *
 * `diffScope` is non-null only for a run the diff scoped — never for a
 * hand-picked `--surface=` subset, which stays `DIAGNOSTIC` even when it names
 * the same surfaces. An empty `definedSurfaceIds` is `DIAGNOSTIC`: a label
 * that decides coverage never defaults to "fully covered" when there is no
 * lane to have covered (issue #2742 review).
 */
export function receiptKindOf(
    requestedSurfaceIds: readonly string[],
    definedSurfaceIds: readonly string[],
    diffScope: DiffScope | null = null
): ReceiptKindResult {
    const requested = new Set(requestedSurfaceIds);
    const unmeasuredSurfaces = definedSurfaceIds.filter(
        (id) => !requested.has(id)
    );
    if (definedSurfaceIds.length === 0) {
        return { kind: "DIAGNOSTIC", unmeasuredSurfaces };
    }
    if (unmeasuredSurfaces.length === 0) {
        return { kind: "RECEIPT", unmeasuredSurfaces };
    }
    const scoped = new Set(diffScope?.surfaces ?? []);
    const matchesScope =
        diffScope !== null &&
        scoped.size === requested.size &&
        [...requested].every((id) => scoped.has(id));
    return {
        kind: matchesScope ? "SCOPED" : "DIAGNOSTIC",
        unmeasuredSurfaces,
    };
}

export interface ResultRow {
    surface: string;
    /** Null for a whole-surface row (unreachable / not attempted). */
    viewport: string | null;
    verdict: Verdict;
    detail: string;
}

/** A measured cell's Shape Readings, for the diagnostic block. */
export interface ShapeRow {
    surface: string;
    viewport: string;
    readings: Readings;
}

/** An Infra Verdict cell as the diagnostic block prints it. */
export interface InfraRow {
    surface: string;
    viewport: string;
    detail: string;
}

export interface Evaluation {
    /** The verdict block's rows, in surface-table × viewport order. */
    rows: ResultRow[];
    /** One line per reason the run is red. Empty ⇒ exit 0. */
    failures: string[];
    /** Surfaces with a `PASS` at every viewport. */
    measuredSurfaces: number;
    /** The in-scope surfaces `UNWALKED_SURFACES` declares unwalked. */
    declaredUnwalked: UnwalkedSurface[];
    /** Surfaces this run was asked to cover. */
    knownSurfaces: number;
    receiptKind: ReceiptKind;
    /** Surfaces this run did not request; empty for a RECEIPT. */
    unmeasuredSurfaces: string[];
    /** The diff scope the run was started under; null unless the diff scoped it. */
    diffScope: DiffScope | null;
    /** Diagnostic block: every measured cell's Shape Readings. */
    shapes: ShapeRow[];
    /** Diagnostic block: every INFRA cell with its load and reason. */
    infra: InfraRow[];
}

export interface EvaluateInput {
    /** What THIS run was asked to cover, in surface-table order. */
    knownSurfaceIds: readonly string[];
    walks: readonly SurfaceWalk[];
    /** Every surface the lane defines — the RECEIPT/DIAGNOSTIC label's
     *  denominator. Required: defaulting it to `knownSurfaceIds` compares a
     *  set against itself and labels every subset RECEIPT (issue #2742). */
    definedSurfaceIds: readonly string[];
    /** The Viewport Matrix (ADR 0101), in its order. */
    viewportIds: readonly string[];
    unwalked: readonly UnwalkedSurface[];
    diffScope?: DiffScope | null;
}

/** The detail of a `PASS` row — constant, so the verdict block is too. */
export const PASS_DETAIL = "every floor at zero";

/**
 * Judge a run against the Floors. Pure: no fs, no browser, no clock. Shape
 * Readings are carried into the diagnostic block and compared against nothing.
 */
export function evaluateRun(input: EvaluateInput): Evaluation {
    const { knownSurfaceIds, walks, definedSurfaceIds, viewportIds, unwalked } =
        input;
    const diffScope = input.diffScope ?? null;
    const rows: ResultRow[] = [];
    const failures: string[] = [];
    const shapes: ShapeRow[] = [];
    const infra: InfraRow[] = [];
    const declaredUnwalked: UnwalkedSurface[] = [];
    const bySurface = new Map(walks.map((w) => [w.surface, w]));
    const unwalkedById = new Map(unwalked.map((u) => [u.surface, u]));
    let measuredSurfaces = 0;

    for (const surface of knownSurfaceIds) {
        const declared = unwalkedById.get(surface);
        if (declared) {
            declaredUnwalked.push(declared);
            continue;
        }

        const walk = bySurface.get(surface);
        if (!walk) {
            rows.push({
                surface,
                viewport: null,
                verdict: "UNWALKED",
                detail: "not attempted in this run",
            });
            failures.push(`${surface}: the run produced no result for it`);
            continue;
        }

        if (walk.status === "unreachable") {
            rows.push({
                surface,
                viewport: null,
                verdict: "UNWALKED",
                detail: `unreachable: ${walk.reason}`,
            });
            failures.push(`${surface}: could not be reached — ${walk.reason}`);
            continue;
        }

        const measured = new Map(
            walk.measurements.map((m) => [m.viewport, m] as const)
        );
        const infraCells = new Map(
            (walk.infra ?? []).map((c) => [c.viewport, c] as const)
        );

        let surfaceComplete = true;
        for (const viewport of viewportIds) {
            const m = measured.get(viewport);
            if (!m) {
                surfaceComplete = false;
                const cell = infraCells.get(viewport);
                if (cell) {
                    // The load and the reason differ between two runs of one
                    // tree, so they go to the diagnostic block; the verdict
                    // line carries only the signature.
                    const said = infraDetail(cell.signature, cell.load);
                    rows.push({
                        surface,
                        viewport,
                        verdict: "INFRA",
                        detail: cell.signature,
                    });
                    infra.push({
                        surface,
                        viewport,
                        detail: `${said} — ${cell.reason}`,
                    });
                    failures.push(
                        `${surface} @ ${viewport}: INFRA — ${said} — the machine cut the walk short, so this cell is unproven`
                    );
                    continue;
                }
                rows.push({
                    surface,
                    viewport,
                    verdict: "UNWALKED",
                    detail: "no measurement at this viewport",
                });
                failures.push(`${surface} @ ${viewport}: not measured`);
                continue;
            }

            shapes.push({ surface, viewport, readings: m.readings });
            const broken = brokenFloors(m.readings);
            if (broken.length > 0) {
                surfaceComplete = false;
                const said = broken
                    .map((b) => `${b.floor} ${b.reading}`)
                    .join(", ");
                rows.push({
                    surface,
                    viewport,
                    verdict: "FAIL",
                    detail: `broken floor: ${said}`,
                });
                failures.push(`${surface} @ ${viewport}: ${said}`);
            } else {
                rows.push({
                    surface,
                    viewport,
                    verdict: "PASS",
                    detail: PASS_DETAIL,
                });
            }
        }

        if (surfaceComplete) measuredSurfaces++;
    }

    const { kind: receiptKind, unmeasuredSurfaces } = receiptKindOf(
        knownSurfaceIds,
        definedSurfaceIds,
        diffScope
    );

    return {
        rows,
        failures,
        measuredSurfaces,
        declaredUnwalked,
        knownSurfaces: knownSurfaceIds.length,
        receiptKind,
        unmeasuredSurfaces,
        diffScope,
        shapes,
        infra,
    };
}

/**
 * The exact text of one verdict line — the one place the format exists, so
 * `index.ts`'s printer and `verify-receipt.ts` cannot drift (issue #2760).
 * Fixed-width via `padEnd`; the verifier's parser matches the finite
 * surface/viewport vocabularies rather than splitting on column offsets.
 */
export function formatResultRow(row: ResultRow): string {
    return `${row.verdict.padEnd(8)} ${row.surface.padEnd(20)} ${(row.viewport ?? "—").padEnd(12)} ${row.detail}`;
}

/** The coverage line closing the verdict block — the honest denominator, and
 *  the declared-unwalked surfaces by name and issue. */
export function coverageLine(ev: Evaluation): string {
    const head = `coverage: ${ev.measuredSurfaces}/${ev.knownSurfaces} surfaces measured, ${ev.declaredUnwalked.length} declared unwalked`;
    if (ev.declaredUnwalked.length === 0) return head;
    return `${head}: ${ev.declaredUnwalked.map((u) => `${u.surface} (issue #${u.issue})`).join(", ")}`;
}

/**
 * The banner opening the verdict block (issue #2742): the first thing a reader
 * sees, so a subset run cannot be mistaken for a receipt. `RECEIPT` is a scope
 * claim, never a measurement claim — the counts beside it come off the same
 * `Evaluation` fields `coverageLine` reads, so the two lines cannot disagree.
 * `SCOPED` names the diff base and every surface in scope, so `land` can
 * re-render it from the scope it re-derives.
 */
export function receiptKindLine(ev: Evaluation): string {
    const counts = `(${ev.measuredSurfaces} measured, ${ev.declaredUnwalked.length} declared unwalked)`;
    if (ev.receiptKind === "RECEIPT") {
        return `RECEIPT — full lane run, ${ev.knownSurfaces} surface(s) in scope ${counts}`;
    }
    if (ev.receiptKind === "SCOPED") {
        const base = ev.diffScope?.base ?? "?";
        if (ev.knownSurfaces === 0) {
            return `SCOPED — diff base ${base}, 0 surface(s) in scope: nothing in this diff reaches a walked route`;
        }
        return (
            `SCOPED — diff base ${base}, ${ev.knownSurfaces} surface(s) in scope: ` +
            `${(ev.diffScope?.surfaces ?? []).join(", ")} ${counts}`
        );
    }
    return (
        `DIAGNOSTIC — NOT a PR receipt: ${ev.unmeasuredSurfaces.length} surface(s) ` +
        `not measured this run (${ev.unmeasuredSurfaces.join(", ")})`
    );
}

/** The verdict block, line by line: banner, rows, coverage line. */
export function verdictBlockLines(ev: Evaluation): string[] {
    return [
        receiptKindLine(ev),
        ...ev.rows.map(formatResultRow),
        coverageLine(ev),
    ];
}

/** The fixed line between the two blocks. Everything after it is diagnostic. */
export const DIAGNOSTIC_SEPARATOR =
    "─── diagnostic — shape readings, load, infra, wall time; never read by land ───";

/** The diagnostic block's evaluation half: Shape Readings per measured cell,
 *  then the Infra Verdicts with their load and reason. `index.ts` appends the
 *  run's own facts (load, console errors, screenshots, wall time). */
export function diagnosticLines(ev: Evaluation): string[] {
    const lines = ev.shapes.map(
        (s) =>
            `shape    ${s.surface.padEnd(20)} ${s.viewport.padEnd(12)} ` +
            SHAPE_READINGS.map((k) => `${k} ${s.readings[k]}`).join(" ")
    );
    for (const i of ev.infra) {
        lines.push(
            `infra    ${i.surface.padEnd(20)} ${i.viewport.padEnd(12)} ${i.detail}`
        );
    }
    return lines;
}

/** Every Floor at zero and every Shape Reading at zero — a measurement that
 *  passes. For fixtures and for the verifier's re-derived landable block. */
export function zeroReadings(): Readings {
    return Object.fromEntries(
        [...FLOORS, ...SHAPE_READINGS].map((k) => [k, 0])
    ) as Readings;
}
