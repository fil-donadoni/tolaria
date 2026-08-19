import { describe, it, expect } from "vitest";
import {
    BUDGET_KEYS,
    coverageLine,
    evaluateRun,
    type BudgetFile,
    type Ceilings,
    type SurfaceWalk,
} from "../ui-gate/budgets.ts";

/**
 * The budget comparison for `bun run check:ui` (issue #2580).
 *
 * These assertions exist for ONE property: a surface the lane could not
 * measure must never be reported as green. That is the failure mode the lane
 * is built against — a headless walk that silently skips the screen it could
 * not reach reads exactly like a walk that found nothing wrong, and the second
 * one is a receipt while the first is a lie. The comparison is deliberately a
 * pure function of (budgets, known surfaces, walk results) so it can be
 * exercised without a browser, which is what makes the coverage rules testable
 * at all.
 */

const ZERO: Ceilings = Object.fromEntries(
    BUDGET_KEYS.map((k) => [k, 0])
) as Ceilings;

function metrics(over: Partial<Ceilings> = {}): Ceilings {
    return { ...ZERO, ...over };
}

function budgetFile(surfaces: BudgetFile["surfaces"]): BudgetFile {
    return { version: 1, recordedOn: "2026-08-19", surfaces };
}

function budgeted(
    viewports: Record<string, Ceilings & { knownDebt?: string }>
): BudgetFile["surfaces"][string] {
    return { label: "test surface", status: "budgeted", viewports };
}

function measured(
    surface: string,
    viewport: string,
    m: Ceilings = metrics()
): SurfaceWalk {
    return {
        surface,
        status: "measured",
        measurements: [{ viewport, metrics: m }],
    };
}

describe("check:ui budgets — a clean measured run", () => {
    it("passes when every measurement sits at or under its ceiling", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics({ ctrlsOcc: 2 }) }),
        });
        const ev = evaluateRun(
            budgets,
            ["lobby"],
            [measured("lobby", "390x844x3", metrics({ ctrlsOcc: 2 }))]
        );

        expect(ev.failures).toEqual([]);
        expect(ev.rows.map((r) => r.verdict)).toEqual(["PASS"]);
        expect(ev.measuredSurfaces).toBe(1);
        expect(coverageLine(ev)).toContain("1/1 surfaces measured");
    });

    it("fails and names the metric when a ceiling is exceeded", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics() }),
        });
        const ev = evaluateRun(
            budgets,
            ["lobby"],
            [measured("lobby", "390x844x3", metrics({ cardsOcc: 3 }))]
        );

        expect(ev.rows[0].verdict).toBe("FAIL");
        expect(ev.failures).toHaveLength(1);
        expect(ev.failures[0]).toContain("cardsOcc 3 > 0");
        // A surface with a red viewport is not a measured surface.
        expect(ev.measuredSurfaces).toBe(0);
    });

    it("checks every budget key, not just the card counts", () => {
        for (const key of BUDGET_KEYS) {
            const budgets = budgetFile({
                s: budgeted({ vp: metrics() }),
            });
            const ev = evaluateRun(
                budgets,
                ["s"],
                [measured("s", "vp", metrics({ [key]: 1 }))]
            );
            expect(ev.failures.join(" ")).toContain(`${key} 1 > 0`);
        }
    });
});

describe("check:ui budgets — coverage is asserted, never assumed", () => {
    it("refuses a surface with no budget entry instead of measuring it green", () => {
        const ev = evaluateRun(
            budgetFile({}),
            ["lobby"],
            [measured("lobby", "390x844x3")]
        );

        expect(ev.rows[0].verdict).toBe("UNWALKED");
        expect(ev.failures[0]).toContain("no entry in budgets.json");
        expect(ev.measuredSurfaces).toBe(0);
    });

    it("fails a budgeted surface the run could not reach, quoting the reason", () => {
        const budgets = budgetFile({
            "game-stress": budgeted({ "390x844x3": metrics() }),
        });
        const ev = evaluateRun(
            budgets,
            ["game-stress"],
            [
                {
                    surface: "game-stress",
                    status: "unreachable",
                    reason: "scenario row absent from this deployment",
                },
            ]
        );

        expect(ev.rows[0].verdict).toBe("UNWALKED");
        expect(ev.failures[0]).toContain("could not be reached");
        expect(ev.failures[0]).toContain("scenario row absent");
    });

    it("fails a budgeted surface the run never attempted", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics() }),
        });
        const ev = evaluateRun(budgets, ["lobby"], []);

        expect(ev.rows[0].verdict).toBe("UNWALKED");
        expect(ev.failures[0]).toContain("produced no result");
    });

    it("fails a budgeted viewport that produced no measurement", () => {
        const budgets = budgetFile({
            lobby: budgeted({
                "390x844x3": metrics(),
                "1440x900x2": metrics(),
            }),
        });
        const ev = evaluateRun(
            budgets,
            ["lobby"],
            [measured("lobby", "390x844x3")]
        );

        expect(ev.failures).toHaveLength(1);
        expect(ev.failures[0]).toContain(
            "1440x900x2: budgeted but not measured"
        );
    });

    it("fails a measurement taken at a viewport the budget does not cover", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics() }),
        });
        const ev = evaluateRun(
            budgets,
            ["lobby"],
            [
                {
                    surface: "lobby",
                    status: "measured",
                    measurements: [
                        { viewport: "390x844x3", metrics: metrics() },
                        { viewport: "9999x9999x1", metrics: metrics() },
                    ],
                },
            ]
        );

        expect(ev.failures.join(" ")).toContain(
            "measured with no budget entry for that viewport"
        );
    });

    it("fails a budgeted surface that declares no viewport ceilings at all", () => {
        const budgets = budgetFile({
            lobby: { label: "Lobby", status: "budgeted" },
        });
        const ev = evaluateRun(
            budgets,
            ["lobby"],
            [measured("lobby", "390x844x3")]
        );

        expect(ev.rows[0].verdict).toBe("UNWALKED");
        expect(ev.failures[0]).toContain("no viewport ceilings are declared");
    });

    it("fails a stale budget entry for a surface the lane no longer defines", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics() }),
            "deleted-surface": budgeted({ "390x844x3": metrics() }),
        });
        const ev = evaluateRun(
            budgets,
            ["lobby"],
            [measured("lobby", "390x844x3")]
        );

        expect(ev.failures).toHaveLength(1);
        expect(ev.failures[0]).toContain("deleted-surface");
    });

    it("does not call an unselected surface stale when the run covers a subset", () => {
        // `--surface=lobby` narrows what the run covers; the budget file still
        // legitimately holds every other surface. Comparing the file against
        // the SUBSET reported all of them as stale entries.
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics() }),
            "game-board": budgeted({ "390x844x3": metrics() }),
        });
        const ev = evaluateRun(
            budgets,
            ["lobby"],
            [measured("lobby", "390x844x3")],
            ["lobby", "game-board"]
        );

        expect(ev.failures).toEqual([]);
    });
});

describe("check:ui budgets — declared-unwalked is listed, not green", () => {
    it("skips a declared-unwalked surface without failing, and prints its reason", () => {
        const budgets = budgetFile({
            "draft-pick": {
                label: "Draft pick",
                status: "unwalked",
                reason: "no drafting event fixture yet",
            },
        });
        const ev = evaluateRun(budgets, ["draft-pick"], []);

        expect(ev.failures).toEqual([]);
        expect(ev.rows[0].verdict).toBe("UNWALKED");
        expect(ev.rows[0].detail).toContain("no drafting event fixture yet");
    });

    it("keeps a declared-unwalked surface OUT of the measured numerator", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics() }),
            "draft-pick": {
                label: "Draft pick",
                status: "unwalked",
                reason: "no fixture",
            },
        });
        const ev = evaluateRun(
            budgets,
            ["lobby", "draft-pick"],
            [measured("lobby", "390x844x3")]
        );

        expect(ev.failures).toEqual([]);
        expect(ev.measuredSurfaces).toBe(1);
        expect(ev.declaredUnwalked).toBe(1);
        expect(ev.knownSurfaces).toBe(2);
        expect(coverageLine(ev)).toBe(
            "coverage: 1/2 surfaces measured, 1 declared unwalked"
        );
    });
});

describe("check:ui budgets — known debt is surfaced, not hidden", () => {
    it("reports every knownDebt note in play", () => {
        const budgets = budgetFile({
            lobby: budgeted({
                "390x844x3": {
                    ...metrics({ ctrlsOcc: 4 }),
                    knownDebt: "4 controls under the fixed footer",
                },
            }),
        });
        const ev = evaluateRun(
            budgets,
            ["lobby"],
            [measured("lobby", "390x844x3", metrics({ ctrlsOcc: 4 }))]
        );

        expect(ev.failures).toEqual([]);
        expect(ev.knownDebt).toEqual([
            "lobby @ 390x844x3: 4 controls under the fixed footer",
        ]);
    });
});
