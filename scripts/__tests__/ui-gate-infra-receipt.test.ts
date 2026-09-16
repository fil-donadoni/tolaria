// An Infra Verdict on the receipt (issue #3644): `evaluateRun` renders a cell
// the machine cut short as an INFRA line — never PASS, never FAIL, never a
// whole-surface UNWALKED — carrying only its signature in the verdict block and
// its load and reason in the diagnostic block; the PR-receipt verifier parses
// that line and refuses it, because an unproven cell must never land as green.
import { describe, expect, it } from "vitest";
import {
    DIAGNOSTIC_SEPARATOR,
    diagnosticLines,
    evaluateRun,
    formatResultRow,
    verdictBlockLines,
    zeroReadings,
    type Evaluation,
    type SurfaceWalk,
} from "../ui-gate/receipt.ts";
import {
    parseResultRowLine,
    verifyReceiptText,
    type ReceiptVocabulary,
} from "../ui-gate/verify-receipt.ts";

const SURFACES = ["lobby"];
const VIEWPORTS = ["390x844x3", "1440x900x2"];
const VOCAB: ReceiptVocabulary = {
    surfaceIds: SURFACES,
    viewportIds: VIEWPORTS,
    unwalked: [],
    // This file is about the INFRA line; the surface promises nothing, so the
    // receipt owes no assertion line (issue #3649).
    assertsBySurface: { lobby: [] },
};

const INFRA_WALK: SurfaceWalk = {
    surface: "lobby",
    status: "measured",
    measurements: [{ viewport: "1440x900x2", readings: zeroReadings() }],
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
    measurements: VIEWPORTS.map((viewport) => ({
        viewport,
        readings: zeroReadings(),
    })),
};

function evaluate(walk: SurfaceWalk): Evaluation {
    return evaluateRun({
        knownSurfaceIds: SURFACES,
        walks: [walk],
        definedSurfaceIds: SURFACES,
        viewportIds: VIEWPORTS,
        unwalked: [],
    });
}

function paste(ev: Evaluation): string {
    return [
        "## check:ui receipt",
        "```",
        ...verdictBlockLines(ev),
        DIAGNOSTIC_SEPARATOR,
        ...diagnosticLines(ev),
        "```",
    ].join("\n");
}

describe("evaluateRun — an Infra Verdict cell", () => {
    const ev = evaluate(INFRA_WALK);

    it("renders an INFRA verdict line naming only the signature", () => {
        expect(ev.rows).toContainEqual({
            surface: "lobby",
            viewport: "390x844x3",
            verdict: "INFRA",
            detail: "function-timeout",
        });
    });

    it("carries the load and the reason into the diagnostic block", () => {
        expect(diagnosticLines(ev)).toContain(
            "infra    lobby                390x844x3    function-timeout, load 23.4 — the lobby offered neither Resume nor a selectable Deck Shelf tile"
        );
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

describe("verify-receipt — an INFRA line is parsed, then refused", () => {
    it("round-trips an INFRA line through formatResultRow", () => {
        const row = evaluate(INFRA_WALK).rows.find(
            (r) => r.verdict === "INFRA"
        )!;
        expect(
            parseResultRowLine(formatResultRow(row), SURFACES, VIEWPORTS)
        ).toEqual(row);
    });

    it("refuses a faithful receipt that carries an INFRA cell", () => {
        const result = verifyReceiptText(
            paste(evaluate(INFRA_WALK)),
            null,
            VOCAB
        );
        expect(result.ok).toBe(false);
        expect(result.problems[0]).toBe(
            "the receipt carries 1 INFRA line(s) (lobby @ 390x844x3: function-timeout) — the machine cut those walks short, so they are unproven: re-run check:ui once the load has dropped"
        );
    });

    it("accepts the same receipt once every cell was measured", () => {
        expect(
            verifyReceiptText(paste(evaluate(CLEAN_WALK)), null, VOCAB)
        ).toEqual({ ok: true, problems: [] });
    });
});
