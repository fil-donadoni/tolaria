import { describe, it, expect } from "vitest";
import type { Readings } from "../ui-gate/floors.ts";
import {
    evaluateRun,
    verdictBlockLines,
    zeroReadings,
    type SurfaceWalk,
} from "../ui-gate/receipt.ts";
import { cellProbesOf, redSurfacesOf } from "../ui-gate/batch-run.ts";
import {
    attributeBatch,
    settleAmbiguous,
    settleUnmeasured,
} from "../ui-gate/batch-receipt.ts";
import { planCollect } from "../ui-gate/batch-collect.ts";
import {
    extractVerdictBlock,
    LANE_VOCABULARY,
} from "../ui-gate/verify-receipt.ts";

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
                unmeasured: [],
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

/**
 * Issue #9549 — a surface ONE PR reaches whose non-`PASS` rows are all
 * `UNWALKED` / `INFRA` measured nothing: it is re-walked on that PR alone,
 * at those cells only, and settled — never red straight from the batch.
 */
describe("an unmeasured-only surface owned by one PR (issue #9549)", () => {
    const BOARD_VIEWPORTS = LANE_VOCABULARY.viewportsOf!("game-board");
    const SKIPPED = BOARD_VIEWPORTS[0];
    const scopes = new Map<number, readonly string[]>([[40, SURFACES]]);

    /** game-board measured everywhere but `SKIPPED` (an UNWALKED cell). */
    function boardMissingCell(
        broken: (viewport: string) => boolean = () => false
    ): SurfaceWalk {
        const walk = measured("game-board", broken) as Extract<
            SurfaceWalk,
            { status: "measured" }
        >;
        return {
            ...walk,
            measurements: walk.measurements.filter(
                (m) => m.viewport !== SKIPPED
            ),
        };
    }

    function attribute(walks: readonly SurfaceWalk[]) {
        const { block } = extractVerdictBlock(
            soloOutput(walks),
            LANE_VOCABULARY
        );
        return attributeBatch(SURFACES, block!.rows, block!.assertRows, scopes);
    }

    it("is unmeasured at its UNWALKED cells, never red — a single-PR batch included", () => {
        const a = attribute([boardMissingCell(), measured("game-combat")]);
        expect(a.red.size).toBe(0);
        expect(a.clean).toEqual([]);
        expect(
            a.unmeasured.map((u) => [u.surface, u.owner, u.viewports])
        ).toEqual([["game-board", 40, [SKIPPED]]]);
    });

    it("a whole-surface UNWALKED row re-walks every viewport", () => {
        const a = attribute([
            {
                surface: "game-board",
                status: "unreachable",
                reason: "opened no [role=dialog] layer within 8s",
            },
            measured("game-combat"),
        ]);
        expect(a.red.size).toBe(0);
        expect(a.unmeasured.map((u) => [u.surface, u.viewports])).toEqual([
            ["game-board", null],
        ]);
    });

    it("a measured FAIL beside an UNWALKED cell reds the owner directly, as before", () => {
        const a = attribute([
            boardMissingCell((v) => v === BOARD_VIEWPORTS[1]),
            measured("game-combat"),
        ]);
        expect([...a.red.keys()]).toEqual([40]);
        expect(a.unmeasured).toEqual([]);
    });

    function settleWith(rewalk: readonly SurfaceWalk[]) {
        const a = attribute([boardMissingCell(), measured("game-combat")]);
        const probes = cellProbesOf(soloOutput(rewalk), a.unmeasured);
        return settleUnmeasured(a, scopes, probes);
    }

    it("a solo re-walk measuring PASS on the cells clears the PR, naming the cells", () => {
        const { attribution, rewalked } = settleWith([
            measured("game-board"),
            measured("game-combat"),
        ]);
        expect(attribution.red.size).toBe(0);
        expect(attribution.unmeasured).toEqual([]);
        expect(attribution.clean).toEqual([40]);
        expect(attribution.passSurfaces).toContain("game-board");
        const actions = planCollect({
            clean: attribution.clean,
            red: attribution.red,
            dropped: [],
            unproven: [],
            base: "b",
            rewalked,
        });
        expect(actions).toHaveLength(1);
        expect(actions[0].kind).toBe("land");
        expect(actions[0]).toMatchObject({
            comment: expect.stringContaining(`game-board @ ${SKIPPED}`),
        });
    });

    it("a solo re-walk still UNWALKED leaves the PR UNPROVEN (ui-owed, comment), never land-failed", () => {
        const { attribution } = settleWith([
            boardMissingCell(),
            measured("game-combat"),
        ]);
        expect(attribution.red.size).toBe(0);
        expect(attribution.clean).toEqual([]);
        expect(attribution.unmeasured.map((u) => u.owner)).toEqual([40]);
        const actions = planCollect({
            clean: [],
            red: attribution.red,
            dropped: [],
            unproven: [40],
            base: "b",
            unmeasured: attribution.unmeasured,
        });
        expect(actions.map((a) => a.kind)).toEqual(["hold"]);
        expect(actions[0].comment).toMatch(
            /UNPROVEN — `game-board @ .+` measured nothing/
        );
    });

    it("a solo re-walk measuring FAIL on the cell reds the owner", () => {
        const { attribution } = settleWith([
            measured("game-board", (v) => v === SKIPPED),
            measured("game-combat"),
        ]);
        expect([...attribution.red.keys()]).toEqual([40]);
        expect(attribution.red.get(40)!.join("\n")).toMatch(
            new RegExp(`FAIL game-board @ ${SKIPPED}`)
        );
        expect(attribution.clean).toEqual([]);
    });

    it("judges the re-walked cells only", () => {
        const probes = cellProbesOf(
            soloOutput([
                measured("game-board", (v) => v !== SKIPPED),
                measured("game-combat"),
            ]),
            [{ surface: "game-board", viewports: [SKIPPED] }]
        );
        expect(probes.get("game-board")).toEqual({ verdict: "pass" });
    });
});
