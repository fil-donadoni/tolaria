import { describe, it, expect } from "vitest";
import {
    VIEWPORTS,
    VIEWPORT_IDS,
    rendererOf,
    viewportIdsFor,
    viewportWalks,
} from "../ui-gate/viewports";
import {
    evaluateRun,
    zeroReadings,
    type SurfaceWalk,
} from "../ui-gate/receipt";
import { landableVerdictBlock } from "../ui-gate/verify-receipt";
import { SURFACES } from "../ui-gate/surfaces";

/**
 * The Viewport Matrix after ADR 0167 (issue #8321): six viewports, the sixth
 * a DPR 1 desktop that walks only the surfaces drawing printed card faces,
 * in the full Chromium — and the evaluation, the walk and the receipt
 * re-derivation all owe that viewport to exactly those surfaces.
 */
describe("the Viewport Matrix (ADR 0101, ADR 0167)", () => {
    it("holds the five DPR 2/3 viewports unchanged, then the DPR 1 desktop", () => {
        expect(VIEWPORT_IDS).toEqual([
            "1440x900x2",
            "390x844x3",
            "844x390x3",
            "820x1180x2",
            "1180x820x2",
            "1440x900x1",
        ]);
        const dpr1 = VIEWPORTS[5]!;
        expect(dpr1.dpr).toBe(1);
        expect(dpr1.mobile).toBe(false);
        expect(dpr1.cardsOnly).toBe(true);
        expect(rendererOf(dpr1)).toBe("chrome");
        for (const v of VIEWPORTS.slice(0, 5)) {
            expect(v.dpr).toBeGreaterThanOrEqual(2);
            expect(v.cardsOnly).toBeUndefined();
            expect(rendererOf(v)).toBe("shell");
        }
    });

    it("a cardsOnly viewport walks a surface iff it declares cards", () => {
        const dpr1 = VIEWPORTS[5]!;
        expect(viewportWalks(dpr1, { cards: true })).toBe(true);
        expect(viewportWalks(dpr1, {})).toBe(false);
        expect(viewportWalks(VIEWPORTS[0]!, {})).toBe(true);
        expect(viewportIdsFor({})).toEqual(VIEWPORT_IDS.slice(0, 5));
        expect(viewportIdsFor({ cards: true })).toEqual([...VIEWPORT_IDS]);
    });

    it("the surface table flags the surfaces that draw printed faces, and no specimen that draws none", () => {
        const flagged = SURFACES.filter((s) => s.cards).map((s) => s.id);
        for (const id of [
            "game-board",
            "game-zone-pile",
            "game-choice-prompt",
            "game-combat",
            "game-source-choice",
            "deck-builder",
            "draft-pick",
            "limited-build",
            "pick-selectable-card",
        ])
            expect(flagged, id).toContain(id);
        for (const id of ["auth-sign-in", "settings", "dlg-pause-menu"])
            expect(flagged, id).not.toContain(id);
    });
});

describe("evaluateRun owes a cardsOnly viewport only to a surface that draws cards", () => {
    const viewportIds = ["1440x900x2", "1440x900x1"];
    const viewportsOf = (surface: string) =>
        surface === "game-board" ? viewportIds : ["1440x900x2"];
    const walks: SurfaceWalk[] = [
        {
            surface: "game-board",
            status: "measured",
            measurements: viewportIds.map((viewport) => ({
                viewport,
                readings: zeroReadings(),
            })),
        },
        {
            surface: "settings",
            status: "measured",
            measurements: [
                { viewport: "1440x900x2", readings: zeroReadings() },
            ],
        },
    ];

    it("prints no row, and no failure, for the cell a surface does not owe", () => {
        const ev = evaluateRun({
            knownSurfaceIds: ["game-board", "settings"],
            walks,
            definedSurfaceIds: ["game-board", "settings"],
            viewportIds,
            viewportsOf,
            unwalked: [],
        });
        expect(ev.failures).toEqual([]);
        expect(ev.rows.map((r) => `${r.surface}@${r.viewport}`)).toEqual([
            "game-board@1440x900x2",
            "game-board@1440x900x1",
            "settings@1440x900x2",
        ]);
        expect(ev.measuredSurfaces).toBe(2);
    });

    it("still reds the cell a card surface owes and did not get", () => {
        const ev = evaluateRun({
            knownSurfaceIds: ["game-board"],
            walks: [
                {
                    surface: "game-board",
                    status: "measured",
                    measurements: [
                        { viewport: "1440x900x2", readings: zeroReadings() },
                    ],
                },
            ],
            definedSurfaceIds: ["game-board"],
            viewportIds,
            viewportsOf,
            unwalked: [],
        });
        expect(ev.failures).toEqual(["game-board @ 1440x900x1: not measured"]);
    });

    it("the re-derived landable block owes the same rows (verify-receipt)", () => {
        const lines = landableVerdictBlock(
            ["game-board", "settings"],
            {
                surfaceIds: ["game-board", "settings"],
                viewportIds,
                viewportsOf,
                unwalked: [],
                assertsBySurface: {},
            },
            null
        );
        expect(lines.filter((l) => l.startsWith("PASS"))).toHaveLength(3);
        expect(lines.some((l) => /settings\s+1440x900x1/.test(l))).toBe(false);
    });

    it("a --viewport= subset is DIAGNOSTIC whatever its surfaces", () => {
        const ev = evaluateRun({
            knownSurfaceIds: ["game-board"],
            walks: walks.slice(0, 1),
            definedSurfaceIds: ["game-board"],
            viewportIds,
            viewportsOf,
            unwalked: [],
            diagnosticReason: "--viewport= subset (1440x900x1)",
        });
        expect(ev.receiptKind).toBe("DIAGNOSTIC");
    });
});
