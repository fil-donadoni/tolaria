import { describe, it, expect } from "vitest";
import {
    BUDGET_KEYS,
    coverageLine,
    evaluateRun,
    metricsOf,
    receiptKindLine,
    receiptKindOf,
    type AxeCount,
    type BudgetFile,
    type Ceilings,
    type ProbeResult,
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
            [measured("lobby", "390x844x3", metrics({ ctrlsOcc: 2 }))],
            ["lobby"]
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
            [measured("lobby", "390x844x3", metrics({ cardsOcc: 3 }))],
            ["lobby"]
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
                [measured("s", "vp", metrics({ [key]: 1 }))],
                ["s"]
            );
            expect(ev.failures.join(" ")).toContain(`${key} 1 > 0`);
        }
    });

    it("gates sub-44px tap targets: a surface regressing from 44px to 22px controls goes red (issue #2658)", () => {
        // A surface budgeted with zero known-small controls at this
        // viewport — the ceiling the touch-target regression must not cross.
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics({ small: 0 }) }),
        });

        // The run measures 3 controls under 44px on the same surface —
        // exactly the "48x22 status chip" shape from the issue's evidence.
        const ev = evaluateRun(
            budgets,
            ["lobby"],
            [measured("lobby", "390x844x3", metrics({ small: 3 }))],
            ["lobby"]
        );

        expect(ev.rows[0].verdict).toBe("FAIL");
        expect(ev.failures[0]).toContain("small 3 > 0");
        expect(ev.measuredSurfaces).toBe(0);
    });
});

describe("check:ui budgets — coverage is asserted, never assumed", () => {
    it("refuses a surface with no budget entry instead of measuring it green", () => {
        const ev = evaluateRun(
            budgetFile({}),
            ["lobby"],
            [measured("lobby", "390x844x3")],
            ["lobby"]
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
            ],
            ["game-stress"]
        );

        expect(ev.rows[0].verdict).toBe("UNWALKED");
        expect(ev.failures[0]).toContain("could not be reached");
        expect(ev.failures[0]).toContain("scenario row absent");
    });

    it("fails a budgeted surface the run never attempted", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics() }),
        });
        const ev = evaluateRun(budgets, ["lobby"], [], ["lobby"]);

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
            [measured("lobby", "390x844x3")],
            ["lobby"]
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
            ],
            ["lobby"]
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
            [measured("lobby", "390x844x3")],
            ["lobby"]
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
            [measured("lobby", "390x844x3")],
            ["lobby"]
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
        const ev = evaluateRun(budgets, ["draft-pick"], [], ["draft-pick"]);

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
            [measured("lobby", "390x844x3")],
            ["lobby", "draft-pick"]
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
            [measured("lobby", "390x844x3", metrics({ ctrlsOcc: 4 }))],
            ["lobby"]
        );

        expect(ev.failures).toEqual([]);
        expect(ev.knownDebt).toEqual([
            "lobby @ 390x844x3: 4 controls under the fixed footer",
        ]);
    });
});

describe("receiptKindOf — RECEIPT vs DIAGNOSTIC is a pure function of the two surface lists (issue #2742)", () => {
    it("is RECEIPT when the requested set names every surface the lane defines", () => {
        const result = receiptKindOf(
            ["lobby", "game-board", "deck-builder"],
            ["lobby", "game-board", "deck-builder"]
        );
        expect(result.kind).toBe("RECEIPT");
        expect(result.unmeasuredSurfaces).toEqual([]);
    });

    it("is RECEIPT regardless of request order — set comparison, not array equality", () => {
        const result = receiptKindOf(
            ["deck-builder", "lobby", "game-board"],
            ["lobby", "game-board", "deck-builder"]
        );
        expect(result.kind).toBe("RECEIPT");
    });

    it("is DIAGNOSTIC for a proper --surface= subset, naming what it did not measure", () => {
        const result = receiptKindOf(
            ["lobby"],
            ["lobby", "game-board", "deck-builder"]
        );
        expect(result.kind).toBe("DIAGNOSTIC");
        expect(result.unmeasuredSurfaces).toEqual([
            "game-board",
            "deck-builder",
        ]);
    });

    it("is DIAGNOSTIC even for a single-surface omission — a near-full walk is still not a receipt", () => {
        const result = receiptKindOf(
            ["lobby", "game-board"],
            ["lobby", "game-board", "deck-builder"]
        );
        expect(result.kind).toBe("DIAGNOSTIC");
        expect(result.unmeasuredSurfaces).toEqual(["deck-builder"]);
    });

    it("is DIAGNOSTIC, never RECEIPT, when the defined-surface list is empty — there is no lane to have fully covered (review finding 2, #2742)", () => {
        const result = receiptKindOf([], []);
        expect(result.kind).toBe("DIAGNOSTIC");
        expect(result.unmeasuredSurfaces).toEqual([]);
    });
});

describe("evaluateRun wires receiptKind through, and it never softens a failure (issue #2742)", () => {
    it("a full walk (no --surface, or --surface naming every surface) reports RECEIPT", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics() }),
        });
        const ev = evaluateRun(
            budgets,
            ["lobby"],
            [measured("lobby", "390x844x3")],
            ["lobby"]
        );
        expect(ev.receiptKind).toBe("RECEIPT");
        expect(ev.unmeasuredSurfaces).toEqual([]);
        expect(receiptKindLine(ev)).toBe(
            "RECEIPT — full lane run, 1 surface(s) in scope (1 measured, 0 declared unwalked)"
        );
    });

    it("a RECEIPT run touching a declared-unwalked surface never claims every surface was MEASURED — that is a scope claim, not a measurement claim (review finding 1, #2742)", () => {
        // budgets.json shape from the bug report: --surface names the whole
        // lane (RECEIPT-eligible scope), but one of those surfaces is
        // declared `status: "unwalked"` and index.ts skips it before
        // walking — a clean full run still has measuredSurfaces < knownSurfaces.
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics() }),
            "draft-pick": {
                label: "Draft pick",
                status: "unwalked",
                reason: "no drafting event fixture yet",
            },
        });
        const ev = evaluateRun(
            budgets,
            ["lobby", "draft-pick"],
            [measured("lobby", "390x844x3")],
            ["lobby", "draft-pick"]
        );

        expect(ev.receiptKind).toBe("RECEIPT");
        expect(ev.measuredSurfaces).toBe(1);
        expect(ev.knownSurfaces).toBe(2);
        expect(ev.declaredUnwalked).toBe(1);

        const line = receiptKindLine(ev);
        // The old wording asserted every surface WAS MEASURED, which was
        // false right here (1 of 2 was declared unwalked, not measured).
        expect(line).not.toContain(
            "every surface this lane defines was measured"
        );
        // The counts in the RECEIPT line must be the same numbers
        // `coverageLine` reports, never restated independently.
        expect(line).toContain(`${ev.measuredSurfaces} measured`);
        expect(line).toContain(`${ev.declaredUnwalked} declared unwalked`);
    });

    it("a --surface= subset reports DIAGNOSTIC and names the unmeasured surfaces", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics() }),
        });
        const ev = evaluateRun(
            budgets,
            ["lobby"],
            [measured("lobby", "390x844x3")],
            ["lobby", "game-board", "deck-builder"]
        );
        expect(ev.receiptKind).toBe("DIAGNOSTIC");
        expect(ev.unmeasuredSurfaces).toEqual(["game-board", "deck-builder"]);
        expect(receiptKindLine(ev)).toContain("NOT a PR receipt");
        expect(receiptKindLine(ev)).toContain("game-board");
        expect(receiptKindLine(ev)).toContain("deck-builder");
    });

    it("orthogonality: a DIAGNOSTIC subset run that hits a budget failure still fails, with the same FAIL verdict and non-empty failures a full run would produce", () => {
        const budgets = budgetFile({
            lobby: budgeted({ "390x844x3": metrics() }),
        });
        const ev = evaluateRun(
            budgets,
            ["lobby"],
            [measured("lobby", "390x844x3", metrics({ cardsOcc: 3 }))],
            ["lobby", "game-board"] // a subset run — DIAGNOSTIC
        );

        expect(ev.receiptKind).toBe("DIAGNOSTIC");
        // The receipt-kind label changed; the verdict and exit-worthiness did not.
        expect(ev.rows[0].verdict).toBe("FAIL");
        expect(ev.failures).toHaveLength(1);
        expect(ev.failures[0]).toContain("cardsOcc 3 > 0");
    });

    it("orthogonality, the other direction: a RECEIPT (full) run with a coverage hole still reports UNWALKED and fails", () => {
        const ev = evaluateRun(
            budgetFile({}),
            ["lobby"],
            [measured("lobby", "390x844x3")],
            ["lobby"] // full walk — RECEIPT
        );

        expect(ev.receiptKind).toBe("RECEIPT");
        expect(ev.rows[0].verdict).toBe("UNWALKED");
        expect(ev.failures[0]).toContain("no entry in budgets.json");
    });
});

describe("metricsOf — probe/axe → Ceilings mapping (issue #2658)", () => {
    /**
     * `index.ts` has no `import.meta.main` guard: importing it runs the whole
     * CLI (boots Vite, launches Playwright). `metricsOf` was pulled into
     * `budgets.ts` (the pure half of this lane) specifically so this mapping
     * — in particular `small: probe.smallN` — has a test that does not need a
     * browser. Every field gets a DISTINCT value so a mis-wire (a swapped
     * field, a hardcoded 0, `small` reading `tinyText` instead of `smallN`)
     * shows up as a mismatch rather than passing by coincidence.
     */
    function probe(over: Partial<ProbeResult> = {}): ProbeResult {
        return {
            vp: "390x844x3",
            cards: { n: 10, zero: 1, occ: 2, reachable: 3, stranded: 4 },
            ctrls: { n: 20, zero: 5, occ: 6, reachable: 7, stranded: 8 },
            starvedN: 9,
            starved: [],
            smallN: 11,
            tinyText: 12,
            hOverflow: 13,
            cardW: null,
            ...over,
        };
    }

    function axe(over: Partial<AxeCount> = {}): AxeCount {
        return { serious: 14, critical: 15, ids: [], exempt: 0, ...over };
    }

    it("maps every probe/axe field to its own Ceilings key", () => {
        const result = metricsOf(probe(), axe());

        expect(result).toEqual({
            cardsZero: 1,
            cardsOcc: 2,
            cardsStranded: 4,
            ctrlsZero: 5,
            ctrlsOcc: 6,
            ctrlsStranded: 8,
            starved: 9,
            small: 11,
            axeSerious: 14,
            axeCritical: 15,
        });
    });

    it("wires Ceilings.small to probe.smallN specifically", () => {
        const result = metricsOf(probe({ smallN: 42 }), axe());
        expect(result.small).toBe(42);

        const other = metricsOf(probe({ smallN: 0, tinyText: 42 }), axe());
        expect(other.small).toBe(0);
    });
});
