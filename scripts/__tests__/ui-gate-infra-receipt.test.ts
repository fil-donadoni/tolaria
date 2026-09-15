// An Infra Verdict on the receipt (issue #3644): `evaluateRun` renders a cell
// the machine cut short as an INFRA row — never PASS, never FAIL, never a
// whole-surface UNWALKED — and the PR-receipt verifier parses that row and
// refuses it, because an unproven cell must never land as green.
import { describe, expect, it } from "vitest";
import {
    BUDGET_KEYS,
    coverageLine,
    evaluateRun,
    formatResultRow,
    receiptKindLine,
    type BudgetFile,
    type Ceilings,
    type Evaluation,
    type SurfaceWalk,
} from "../ui-gate/budgets.ts";
import {
    parseResultRowLine,
    verifyReceiptText,
} from "../ui-gate/verify-receipt.ts";

const ZERO = Object.fromEntries(BUDGET_KEYS.map((k) => [k, 0])) as Ceilings;
const SURFACES = ["lobby"];
const VIEWPORTS = ["390x844x3", "1440x900x2"];

const BUDGETS: BudgetFile = {
    version: 1,
    recordedOn: "2026-09-15",
    surfaces: {
        lobby: {
            label: "Lobby",
            status: "budgeted",
            viewports: { "390x844x3": ZERO, "1440x900x2": ZERO },
        },
    },
};

const INFRA_WALK: SurfaceWalk = {
    surface: "lobby",
    status: "measured",
    measurements: [{ viewport: "1440x900x2", metrics: ZERO }],
    infra: [
        {
            viewport: "390x844x3",
            signature: "function-timeout",
            load: 23.44,
            reason: "the lobby offered neither Resume nor a selectable Deck Shelf tile",
        },
    ],
};

const CLEAN_WALK: SurfaceWalk = {
    surface: "lobby",
    status: "measured",
    measurements: VIEWPORTS.map((viewport) => ({ viewport, metrics: ZERO })),
};

function paste(ev: Evaluation): string {
    return [
        "## check:ui receipt",
        "```",
        receiptKindLine(ev),
        ...ev.rows.map(formatResultRow),
        coverageLine(ev),
        "```",
    ].join("\n");
}

describe("evaluateRun — an Infra Verdict cell", () => {
    const ev = evaluateRun(BUDGETS, SURFACES, [INFRA_WALK], SURFACES);

    it("renders an INFRA row naming the signature, the load and the reason", () => {
        expect(ev.rows).toContainEqual({
            surface: "lobby",
            viewport: "390x844x3",
            verdict: "INFRA",
            detail: "function-timeout, load 23.4 — the lobby offered neither Resume nor a selectable Deck Shelf tile",
        });
    });

    it("still measures the viewports the machine did not cut short", () => {
        expect(ev.rows.find((r) => r.viewport === "1440x900x2")?.verdict).toBe(
            "PASS"
        );
    });

    it("is never green: the run fails, and the surface is not counted as measured", () => {
        expect(ev.failures).toEqual([
            "lobby @ 390x844x3: INFRA — function-timeout, load 23.4 — the machine cut the walk short, so this cell is unproven",
        ]);
        expect(ev.measuredSurfaces).toBe(0);
    });
});

describe("verify-receipt — an INFRA row is parsed, then refused", () => {
    it("round-trips an INFRA row through formatResultRow", () => {
        const row = evaluateRun(
            BUDGETS,
            SURFACES,
            [INFRA_WALK],
            SURFACES
        ).rows.find((r) => r.verdict === "INFRA")!;
        expect(
            parseResultRowLine(formatResultRow(row), SURFACES, VIEWPORTS)
        ).toEqual(row);
    });

    it("refuses a faithful receipt that carries an INFRA cell", () => {
        const result = verifyReceiptText(
            paste(evaluateRun(BUDGETS, SURFACES, [INFRA_WALK], SURFACES)),
            SURFACES,
            VIEWPORTS,
            BUDGETS
        );
        expect(result.ok).toBe(false);
        expect(result.problems).toEqual([
            "the receipt carries 1 INFRA cell(s) (lobby @ 390x844x3) — the machine cut those walks short, so they are unproven: re-run check:ui once the load has dropped",
        ]);
    });

    it("accepts the same receipt once every cell was measured", () => {
        expect(
            verifyReceiptText(
                paste(evaluateRun(BUDGETS, SURFACES, [CLEAN_WALK], SURFACES)),
                SURFACES,
                VIEWPORTS,
                BUDGETS
            )
        ).toEqual({ ok: true, problems: [] });
    });
});
