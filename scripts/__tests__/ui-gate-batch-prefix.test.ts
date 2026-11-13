import { describe, expect, it } from "vitest";
import {
    evaluateRun,
    verdictBlockLines,
    zeroReadings,
    type Readings,
    type SurfaceWalk,
} from "../ui-gate/receipt.ts";
import { prefixProbesOf } from "../ui-gate/batch-run.ts";
import {
    settleOrphans,
    type BatchAttribution,
    type PrefixProbe,
} from "../ui-gate/batch-receipt.ts";
import { planCollect } from "../ui-gate/batch-collect.ts";
import { LANE_VOCABULARY } from "../ui-gate/verify-receipt.ts";

/**
 * Issue #9265 — a surface red in the batch and owned by no single PR is
 * settled on merge-order prefixes: the first prefix that MEASURES it red
 * names the head that completes the break.
 */

const SURFACES = ["game-board", "game-combat"];
const A = 10;
const B = 11;
const C = 12;
const ORDER = [A, B, C];
const SCOPES = new Map<number, string[]>([
    [A, ["game-board"]],
    [B, ["game-board"]],
    [C, ["game-board"]],
]);
const RED_LINE = "FAIL game-board @ 820x1180x2: cardsStranded 2";

/** The batch's attribution after the solo re-walks: `game-board` an orphan. */
function orphaned(): BatchAttribution {
    return {
        passSurfaces: [],
        clean: [],
        red: new Map(),
        ambiguous: [],
        orphan: ["game-board"],
        unmeasured: [],
    };
}

const pass: PrefixProbe = { verdict: "pass" };
const fail: PrefixProbe = { verdict: "fail", lines: [RED_LINE] };
const unsettled: PrefixProbe = { verdict: "unsettled" };

function settle(rows: PrefixProbe[]) {
    return settleOrphans(
        orphaned(),
        ORDER,
        SCOPES,
        new Map([["game-board", rows]])
    );
}

describe("settleOrphans — the merge-order prefix settle (issue #9265)", () => {
    it("red on {A,B}, green on {A}: blames B, clears A, leaves C unproven", () => {
        const s = settle([pass, pass, fail]);
        expect(s.combination).toEqual([
            { surface: "game-board", culprit: B, partners: [A], after: [C] },
        ]);
        expect([...s.attribution.red.keys()]).toEqual([B]);
        expect(s.attribution.red.get(B)).toEqual([
            `game-board: red when #${B} is merged in combination with #${A} (merged before it)`,
            RED_LINE,
        ]);
        expect(s.attribution.clean).toEqual([A]);
        expect(s.attribution.orphan).toEqual([]);
        expect(s.cleared.get(A)).toEqual(["game-board"]);
    });

    it("an UNWALKED / INFRA prefix row blames nobody", () => {
        const s = settle([pass, unsettled]);
        expect(s.combination).toEqual([]);
        expect(s.attribution.red.size).toBe(0);
        expect(s.attribution.clean).toEqual([]);
        expect(s.attribution.orphan).toEqual(["game-board"]);
        expect(s.nonReproducible).toEqual([]);
    });

    it("green on every prefix, the full set included: unproven, non-reproducible", () => {
        const s = settle([pass, pass, pass, pass]);
        expect(s.combination).toEqual([]);
        expect(s.attribution.red.size).toBe(0);
        expect(s.attribution.orphan).toEqual(["game-board"]);
        expect(s.nonReproducible).toEqual(["game-board"]);
        expect(s.attribution.clean).toEqual([]);
    });

    it("red on the base alone: the base's, no head blamed", () => {
        const s = settle([fail]);
        expect(s.combination).toEqual([]);
        expect(s.attribution.red.size).toBe(0);
        expect(s.baseRed).toEqual(["game-board"]);
    });
});

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

/** A prefix walk's printed output: its verdict block, as the walk logs it. */
function walkOutput(walks: readonly SurfaceWalk[]): string {
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

describe("prefixProbesOf — one prefix walk per orphan (issue #9265)", () => {
    it("a measured FAIL is `fail` with the viewport; a clean walk is `pass`", () => {
        const probes = prefixProbesOf(
            walkOutput([
                measured("game-board", (v) => v === "820x1180x2"),
                measured("game-combat"),
            ]),
            SURFACES
        );
        const board = probes.get("game-board");
        expect(board?.verdict).toBe("fail");
        expect(board?.verdict === "fail" && board.lines.join("\n")).toContain(
            "game-board @ 820x1180x2"
        );
        expect(probes.get("game-combat")).toEqual({ verdict: "pass" });
    });

    it("an UNWALKED surface is `unsettled`, never `pass`", () => {
        const probes = prefixProbesOf(
            walkOutput([
                {
                    surface: "game-board",
                    status: "unreachable",
                    reason: "an active game the lane did not create is in progress",
                },
                measured("game-combat"),
            ]),
            SURFACES
        );
        expect(probes.get("game-board")).toEqual({ verdict: "unsettled" });
    });
});

describe("planCollect — the combination break's culprit and the heads behind it (issue #9265)", () => {
    it("fails the culprit naming the surface, viewports, red lines and partners; holds the head after it", () => {
        const s = settle([pass, pass, fail]);
        const actions = planCollect({
            clean: s.attribution.clean,
            red: s.attribution.red,
            dropped: [],
            unproven: [C],
            combination: s.combination,
        });
        const culprit = actions.find((a) => a.kind === "fail");
        expect(culprit).toMatchObject({ pr: B, partners: [A] });
        const text = culprit && "comment" in culprit ? culprit.comment : "";
        expect(text).toContain("`game-board` is red only in combination");
        expect(text).toContain(`in combination with #${A}`);
        expect(text).toContain("820x1180x2");
        expect(text).toContain(RED_LINE);
        const behind = actions.find((a) => a.pr === C);
        expect(behind).toMatchObject({
            kind: "hold",
            comment: expect.stringContaining("rides the next batch"),
        });
        expect(actions.find((a) => a.pr === A)).toEqual({
            kind: "land",
            pr: A,
        });
    });
});
