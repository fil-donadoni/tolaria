/**
 * The budget contract for `bun run check:ui` (issue #2580) — and the PURE half
 * of the lane, so it can be unit-tested without a browser
 * (`scripts/__tests__/ui-gate-budgets.test.ts`).
 *
 * The whole point of this file is that a surface the lane could not MEASURE is
 * never reported as green. Three shapes get confused with each other and this
 * module keeps them apart:
 *
 *   1. DECLARED unwalked — `"status": "unwalked"` plus a `reason` in
 *      `budgets.json`. An honest "nobody has built the fixture for this screen
 *      yet". Printed as UNWALKED, counted OUT of the coverage numerator, does
 *      NOT fail the run. This is the row a later slice deletes when it walks
 *      the surface, and it is the only way a surface is allowed to be skipped.
 *   2. UNDECLARED — a surface the lane knows how to walk with no entry in
 *      `budgets.json` at all (or a budgeted surface missing a viewport). The
 *      lane REFUSES to run it and FAILS: a missing ceiling must never read as
 *      "no ceiling exceeded".
 *   3. UNREACHABLE — a budgeted surface the lane tried and could not reach:
 *      the scenario row is absent from this deployment, an active game blocks
 *      the route, the login failed. FAILS, naming the reason. Coverage is the
 *      thing being asserted; "we could not look" is a red, not a shrug.
 *
 * The mirror guard matters as much: a budget entry for a surface the lane no
 * longer defines is also a failure. Otherwise a renamed surface silently
 * carries its old ceilings and measures nothing.
 */

/**
 * The measured quantities a budget puts a ceiling on. Flat and explicit — one
 * key per number, so `budgets.json` is diffable and a later slice tightening a
 * single surface changes a single line.
 *
 * `cards*` are the card tiles (the probe's `img` selector), `ctrls*` every
 * button/link/input — the "stranded CTA" case from the issue is
 * `ctrlsStranded`. `starved` counts scroll containers shorter than their
 * tallest child. `axeSerious`/`axeCritical` are axe-core violation counts at
 * those two impact levels. `small` is `probe.js`'s `smallN` (issue #2658):
 * count of visible in-band interactive controls (`button,a[href],input,
 * select,[role=button],[role=tab],[role=option]`) whose smaller dimension is
 * under 44px.
 *
 * `small` is DELIBERATELY POINTER-BLIND — the probe tests `< 44` at every
 * viewport, including the desktop one, but `--control-h` resolves to 32px
 * under `pointer: fine` ON PURPOSE (`src/index.css:942,946-948`, citing WCAG
 * 2.5.8, which is a TOUCH-target rule and does not apply to a mouse). So a
 * nonzero `small` on a `1440x900x2` (desktop, `pointer: fine`) row is very
 * often the intended 32px control height showing up in a blind measurement —
 * NOT debt — while the same nonzero count on a `…x3,mobile,touch…` row is
 * real: those contexts get the 44px `--control-h-coarse` branch and a small
 * reading there is an actual sub-target control. Every nonzero `small`
 * ceiling MUST carry a `knownDebt` note that says which of the two it is, so
 * a later reader does not "fix" a desktop reading by shrinking a touch
 * target (or wave off a touch reading as "just the desktop thing").
 */
export const BUDGET_KEYS = [
    "cardsZero",
    "cardsOcc",
    "cardsStranded",
    "ctrlsZero",
    "ctrlsOcc",
    "ctrlsStranded",
    "starved",
    "small",
    "axeSerious",
    "axeCritical",
] as const;

export type BudgetKey = (typeof BUDGET_KEYS)[number];

/** One viewport's ceilings for one surface. Every key is required. */
export type Ceilings = Record<BudgetKey, number>;

export interface ViewportBudget extends Ceilings {
    /**
     * Set when a ceiling is above the hard floor the issue asks for (zero
     * `cardsOcc`, zero `ctrlsStranded`, zero axe serious/critical). It records
     * WHAT is broken so the number reads as debt rather than as a decision.
     * The lane prints every one of these under the table; a slice that owns
     * the surface deletes the note and the slack together.
     */
    knownDebt?: string;
}

export interface SurfaceBudget {
    label: string;
    /**
     * `budgeted` — must be walked and measured at every viewport listed.
     * `unwalked` — declared not-yet-covered; skipped, printed, not a failure.
     */
    status: "budgeted" | "unwalked";
    /** Required when `status === "unwalked"`: why, and what would unblock it. */
    reason?: string;
    /** Required when `status === "budgeted"`: keyed by `Viewport.id`. */
    viewports?: Record<string, ViewportBudget>;
}

export interface BudgetFile {
    version: number;
    /** When the numbers below were measured, and against what. */
    recordedOn: string;
    note?: string;
    surfaces: Record<string, SurfaceBudget>;
}

/** One surface × viewport measurement handed back by the browser half. */
export interface Measurement {
    viewport: string;
    metrics: Ceilings;
    /** Path of the evidence screenshot, if one was taken. */
    screenshot?: string;
    /** The full probe payload, for the printed detail line. */
    detail?: string;
}

/** What the browser half reports for one surface. */
export type SurfaceWalk =
    | { surface: string; status: "measured"; measurements: Measurement[] }
    | { surface: string; status: "unreachable"; reason: string };

export type Verdict = "PASS" | "FAIL" | "UNWALKED";

export interface ResultRow {
    surface: string;
    /** Null for a whole-surface row (unwalked / unreachable / undeclared). */
    viewport: string | null;
    verdict: Verdict;
    detail: string;
    screenshot?: string;
}

export interface Evaluation {
    rows: ResultRow[];
    /** One line per reason the run is red. Empty ⇒ exit 0. */
    failures: string[];
    /** Surfaces measured at every budgeted viewport. */
    measuredSurfaces: number;
    /** Surfaces the budget file declares `unwalked`. */
    declaredUnwalked: number;
    /** Surfaces the lane knows how to walk. */
    knownSurfaces: number;
    /** `knownDebt` notes in play, so the PR can list what the next slice owns. */
    knownDebt: string[];
}

function fmtMetrics(m: Ceilings): string {
    return [
        `cards zero${m.cardsZero} occ${m.cardsOcc} stranded${m.cardsStranded}`,
        `ctrls zero${m.ctrlsZero} occ${m.ctrlsOcc} stranded${m.ctrlsStranded}`,
        `starved${m.starved}`,
        `small${m.small}`,
        `axe s${m.axeSerious}/c${m.axeCritical}`,
    ].join(" | ");
}

/**
 * Compare a run against the budget file. Pure: no fs, no browser, no clock.
 *
 * `knownSurfaceIds` is what THIS RUN was asked to cover, which is deliberately
 * a different list from the budget file's keys — the two guards that catch
 * drift both live in the gap between them.
 *
 * `definedSurfaceIds` is every surface `surfaces.ts` defines, and it exists
 * only for the stale-entry guard: under `--surface=` the run covers a subset,
 * and comparing the budget file against that subset would report every
 * unselected surface as a stale entry.
 */
export function evaluateRun(
    budgets: BudgetFile,
    knownSurfaceIds: readonly string[],
    walks: readonly SurfaceWalk[],
    definedSurfaceIds: readonly string[] = knownSurfaceIds
): Evaluation {
    const rows: ResultRow[] = [];
    const failures: string[] = [];
    const knownDebt: string[] = [];
    const bySurface = new Map(walks.map((w) => [w.surface, w]));
    let measuredSurfaces = 0;
    let declaredUnwalked = 0;

    // Guard: a budget entry for a surface the lane no longer defines. Left
    // alone, a renamed surface keeps green ceilings that measure nothing.
    for (const id of Object.keys(budgets.surfaces)) {
        if (!definedSurfaceIds.includes(id)) {
            failures.push(
                `budgets.json has an entry for "${id}", which is not a surface this lane defines — delete it or restore the walk`
            );
        }
    }

    for (const surface of knownSurfaceIds) {
        const budget = budgets.surfaces[surface];

        if (!budget) {
            rows.push({
                surface,
                viewport: null,
                verdict: "UNWALKED",
                detail: "no budget entry — refusing to run",
            });
            failures.push(
                `${surface}: no entry in budgets.json. Add ceilings, or declare it {"status":"unwalked","reason":…} — a surface without a ceiling is not a passing surface`
            );
            continue;
        }

        if (budget.status === "unwalked") {
            declaredUnwalked++;
            rows.push({
                surface,
                viewport: null,
                verdict: "UNWALKED",
                detail: `declared unwalked: ${budget.reason ?? "no reason recorded"}`,
            });
            continue;
        }

        const walk = bySurface.get(surface);
        if (!walk) {
            rows.push({
                surface,
                viewport: null,
                verdict: "UNWALKED",
                detail: "budgeted but not attempted in this run",
            });
            failures.push(
                `${surface}: budgeted but the run produced no result for it`
            );
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

        const vpBudgets = budget.viewports ?? {};
        const budgetedViewports = Object.keys(vpBudgets);
        if (budgetedViewports.length === 0) {
            rows.push({
                surface,
                viewport: null,
                verdict: "UNWALKED",
                detail: "budgeted with no viewport ceilings",
            });
            failures.push(
                `${surface}: status "budgeted" but no viewport ceilings are declared`
            );
            continue;
        }

        const measured = new Map(
            walk.measurements.map((m) => [m.viewport, m] as const)
        );

        // A measurement with no ceiling is the same hole as a surface with no
        // entry, one level down.
        for (const m of walk.measurements) {
            if (!vpBudgets[m.viewport]) {
                rows.push({
                    surface,
                    viewport: m.viewport,
                    verdict: "UNWALKED",
                    detail: `measured but no budget for this viewport — ${fmtMetrics(m.metrics)}`,
                    screenshot: m.screenshot,
                });
                failures.push(
                    `${surface} @ ${m.viewport}: measured with no budget entry for that viewport`
                );
            }
        }

        let surfaceComplete = true;
        for (const viewport of budgetedViewports) {
            const ceilings = vpBudgets[viewport];
            if (ceilings.knownDebt) {
                knownDebt.push(
                    `${surface} @ ${viewport}: ${ceilings.knownDebt}`
                );
            }
            const m = measured.get(viewport);
            if (!m) {
                surfaceComplete = false;
                rows.push({
                    surface,
                    viewport,
                    verdict: "UNWALKED",
                    detail: "budgeted viewport produced no measurement",
                });
                failures.push(
                    `${surface} @ ${viewport}: budgeted but not measured`
                );
                continue;
            }

            const over: string[] = [];
            for (const key of BUDGET_KEYS) {
                const actual = m.metrics[key];
                const ceiling = ceilings[key];
                if (actual > ceiling) {
                    over.push(`${key} ${actual} > ${ceiling}`);
                }
            }

            if (over.length > 0) {
                surfaceComplete = false;
                rows.push({
                    surface,
                    viewport,
                    verdict: "FAIL",
                    detail: `${fmtMetrics(m.metrics)} — over budget: ${over.join(", ")}`,
                    screenshot: m.screenshot,
                });
                failures.push(`${surface} @ ${viewport}: ${over.join(", ")}`);
            } else {
                rows.push({
                    surface,
                    viewport,
                    verdict: "PASS",
                    detail: fmtMetrics(m.metrics),
                    screenshot: m.screenshot,
                });
            }
        }

        if (surfaceComplete) measuredSurfaces++;
    }

    return {
        rows,
        failures,
        measuredSurfaces,
        declaredUnwalked,
        knownSurfaces: knownSurfaceIds.length,
        knownDebt,
    };
}

/** The coverage line printed under the table — the honest denominator. */
export function coverageLine(ev: Evaluation): string {
    return `coverage: ${ev.measuredSurfaces}/${ev.knownSurfaces} surfaces measured, ${ev.declaredUnwalked} declared unwalked`;
}
