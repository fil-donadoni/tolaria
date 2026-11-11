import { describe, it, expect } from "vitest";
import type { Readings } from "../ui-gate/floors.ts";
import {
    evaluateRun,
    verdictBlockLines,
    zeroReadings,
    type SurfaceWalk,
} from "../ui-gate/receipt.ts";
import { redSurfacesOf } from "../ui-gate/batch-run.ts";
import { settleAmbiguous } from "../ui-gate/batch-receipt.ts";
import { planCollect } from "../ui-gate/batch-collect.ts";
import { LANE_VOCABULARY } from "../ui-gate/verify-receipt.ts";

/**
 * Issue #9210 — a solo `--surface=` re-walk attributes a surface to a PR only
 * when it MEASURED it red. Every block here is rendered by the real
 * `evaluateRun` / `verdictBlockLines` over the lane's own vocabulary, exactly
 * as the solo walk prints it.
 */

const SURFACES = ["game-board", "game-combat"];

/** A measured walk of `surface`, a broken floor at the viewports `broken`
 *  names. */
function measured(
    surface: string,
    broken: (viewport: string) => boolean = () => false
): SurfaceWalk {
    const viewports = LANE_VOCABULARY.viewportsOf!(surface);
    const labels = LANE_VOCABULARY.assertsBySurface[surface] ?? [];
    return {
        surface,
        status: "measured",
        measurements: viewports.map((viewport) => ({
            viewport,
            readings: broken(viewport)
                ? ({ ...zeroReadings(), cardsStranded: 2 } as Readings)
                : zeroReadings(),
            asserts: labels.map((label) => ({ label, ok: true, detail: "" })),
        })),
    };
}

/** The solo walk's printed output: its verdict block, as the walk logs it. */
function soloOutput(walks: readonly SurfaceWalk[]): string {
    const ev = evaluateRun({
        knownSurfaceIds: SURFACES,
        walks,
        definedSurfaceIds: LANE_VOCABULARY.surfaceIds,
        viewportIds: LANE_VOCABULARY.viewportIds,
        viewportsOf: LANE_VOCABULARY.viewportsOf,
        unwalked: [],
        assertsBySurface: LANE_VOCABULARY.assertsBySurface,
    });
    return ["ui-gate: walking…", ...verdictBlockLines(ev), ""].join("\n");
}

describe("redSurfacesOf — the solo re-walk's red surfaces (issue #9210)", () => {
    it("an UNWALKED surface attributes nothing", () => {
        const out = soloOutput([
            {
                surface: "game-board",
                status: "unreachable",
                reason: "an active game the lane did not create is in progress",
            },
            measured("game-combat"),
        ]);
        expect(out).toContain("UNWALKED");
        expect(redSurfacesOf(out)).toEqual([]);
    });

    it("a viewport with no measurement (UNWALKED cell) attributes nothing", () => {
        const walk = measured("game-board") as Extract<
            SurfaceWalk,
            { status: "measured" }
        >;
        const out = soloOutput([
            { ...walk, measurements: walk.measurements.slice(1) },
            measured("game-combat"),
        ]);
        expect(out).toContain("UNWALKED");
        expect(redSurfacesOf(out)).toEqual([]);
    });

    it("a measured FAIL row still attributes its surface", () => {
        const out = soloOutput([
            measured("game-board", (v) => v === "820x1180x2"),
            measured("game-combat"),
        ]);
        expect(redSurfacesOf(out)).toEqual(["game-board"]);
    });
});

describe("an UNWALKED solo re-walk through to the collector (issue #9210)", () => {
    it("leaves the surface an orphan: the candidates end hold (UNPROVEN), never fail", () => {
        const unreachable = soloOutput([
            {
                surface: "game-board",
                status: "unreachable",
                reason: "an active game the lane did not create is in progress",
            },
            measured("game-combat"),
        ]);
        const settled = settleAmbiguous(
            {
                passSurfaces: [],
                clean: [],
                red: new Map(),
                ambiguous: [{ surface: "game-board", candidates: [30, 31] }],
                orphan: [],
            },
            new Map([
                [30, redSurfacesOf(unreachable)],
                [31, redSurfacesOf(unreachable)],
            ])
        );
        expect(settled.red.size).toBe(0);
        expect(settled.orphan).toEqual(["game-board"]);
        const actions = planCollect({
            clean: [],
            red: settled.red,
            dropped: [],
            unproven: [30, 31],
        });
        expect(actions.map((a) => [a.kind, a.pr])).toEqual([
            ["hold", 30],
            ["hold", 31],
        ]);
    });
});
