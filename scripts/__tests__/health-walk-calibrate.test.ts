// The Linux walk is advisory until calibrated (issue #5465): its verdict goes
// under `context=ui-walk`, never `health`; `ui:calibrate` compares two
// receipts of one tip Floor by Floor; `ui-walk.gating` decides whether the
// health verdict heeds the walk.
import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    calibrate,
    formatDivergence,
    parseReceipt,
} from "../ui-gate/calibrate";
import { UNWALKED_SURFACES, type Readings } from "../ui-gate/floors";
import {
    evaluateRun,
    verdictBlockLines,
    zeroReadings,
    type SurfaceWalk,
} from "../ui-gate/receipt";
import { SURFACE_IDS } from "../ui-gate/surfaces";
import { VIEWPORT_IDS } from "../ui-gate/viewports";
import {
    parseUiWalkGating,
    uiWalkGating,
    writeWalkVerdict,
} from "../lib/health-verdict-walk";
import {
    HEALTH_CONTEXT,
    UI_WALK_CONTEXT,
    type GhRunner,
} from "../lib/health-verdict-store";
import { walkDisposition, walkOutcome } from "../lib/health-walk-plan";

const SURFACE = SURFACE_IDS.find(
    (id) => !UNWALKED_SURFACES.some((u) => u.surface === id)
)!;
const [V1, V2] = VIEWPORT_IDS;

/** A receipt rendered by the REAL evaluator and renderer, with `over` applied
 *  to the readings of one cell. */
function receipt(
    over: { viewport: string; readings: Partial<Readings> } | null = null,
    infraViewport: string | null = null
): string {
    const walk: SurfaceWalk = {
        surface: SURFACE,
        status: "measured",
        measurements: VIEWPORT_IDS.filter((v) => v !== infraViewport).map(
            (viewport) => ({
                viewport,
                readings: {
                    ...zeroReadings(),
                    ...(over?.viewport === viewport ? over.readings : {}),
                },
            })
        ),
        ...(infraViewport
            ? {
                  infra: [
                      {
                          viewport: infraViewport,
                          signature: "unsettled" as const,
                          load: 9,
                          reason: "slow",
                      },
                  ],
              }
            : {}),
    };
    const ev = evaluateRun({
        knownSurfaceIds: [SURFACE],
        walks: [walk],
        definedSurfaceIds: SURFACE_IDS,
        viewportIds: VIEWPORT_IDS,
        unwalked: UNWALKED_SURFACES,
    });
    return verdictBlockLines(ev).join("\n");
}

describe("ui:calibrate — two receipts of one tip, cell by cell", () => {
    it("identical receipts → no divergent cell", () => {
        const a = parseReceipt(receipt());
        expect(a.size).toBe(VIEWPORT_IDS.length);
        expect(calibrate(a, parseReceipt(receipt()))).toEqual([]);
    });

    it("one Floor differs → exactly that surface × viewport × Floor, named", () => {
        const linux = receipt({
            viewport: V2,
            readings: { hOverflow: 2, cardsSoft: 1 },
        });
        const d = calibrate(parseReceipt(receipt()), parseReceipt(linux));
        expect(d).toEqual([
            {
                surface: SURFACE,
                viewport: V2,
                floor: "cardsSoft",
                a: "0",
                b: "1",
            },
            {
                surface: SURFACE,
                viewport: V2,
                floor: "hOverflow",
                a: "0",
                b: "2",
            },
        ]);
        expect(formatDivergence(d[0])).toContain(`${SURFACE}`);
        expect(formatDivergence(d[0])).toContain("cardsSoft: 0 ≠ 1");
    });

    it("the same Floor broken on both sides is not a divergence", () => {
        const both = receipt({ viewport: V1, readings: { cardsZero: 3 } });
        expect(calibrate(parseReceipt(both), parseReceipt(both))).toEqual([]);
    });

    it("a cell the machine cut short (INFRA) on one side is unproven, hence divergent", () => {
        const d = calibrate(
            parseReceipt(receipt()),
            parseReceipt(receipt(null, V1))
        );
        expect(d).toEqual([
            {
                surface: SURFACE,
                viewport: V1,
                floor: "measured",
                a: "PASS",
                b: "INFRA",
            },
        ]);
    });
});

describe("ui-walk.gating — whether the walk reaches the health verdict", () => {
    it("absent reads undefined; a non-boolean is an error", () => {
        expect(parseUiWalkGating("{}")).toBeUndefined();
        expect(parseUiWalkGating('{"ui-walk":{"gating":true}}')).toBe(true);
        expect(() => parseUiWalkGating('{"ui-walk":{"gating":"yes"}}')).toThrow(
            /must be a boolean/
        );
    });

    it("Linux is advisory unless promoted; any other platform always gates", () => {
        expect(uiWalkGating(undefined, "linux")).toBe(false);
        expect(uiWalkGating(false, "linux")).toBe(false);
        expect(uiWalkGating(true, "linux")).toBe(true);
        expect(uiWalkGating(false, "darwin")).toBe(true);
        expect(walkDisposition(false)).toBe("advisory");
        expect(walkDisposition(true)).toBe("gate");
    });

    it("a failed walk is red only when it ran and the environment is not to blame", () => {
        const base = { failed: true, walked: true, environmental: false };
        expect(walkOutcome({ ...base, failed: false })).toBe("green");
        expect(walkOutcome(base)).toBe("red");
        expect(walkOutcome({ ...base, environmental: true })).toBe("infra");
        expect(walkOutcome({ ...base, walked: false })).toBe("infra");
    });
});

describe("the walk's verdict is written under ui-walk, never health", () => {
    const verdict = {
        sha: "a".repeat(40),
        status: "red" as const,
        step: "check:ui --all",
        machine: "huawei",
    };

    it("github backend: one status, context=ui-walk, the machine in the description", () => {
        const calls: string[][] = [];
        const run: GhRunner = (args) => {
            calls.push(args);
            return { status: 0, stdout: "{}", stderr: "" };
        };
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "walk-gh-"));
        // originRepo reads the origin remote of `root`.
        const git = (...a: string[]) => spawnSync("git", a, { cwd: root });
        git("init");
        git("remote", "add", "origin", "git@github.com:o/r.git");
        writeWalkVerdict(root, verdict, { run });
        const post = calls.find((c) => c.includes("POST"))!;
        expect(post).toContain(`context=${UI_WALK_CONTEXT}`);
        expect(post).not.toContain(`context=${HEALTH_CONTEXT}`);
        expect(post.some((a) => a.includes("huawei"))).toBe(true);
    });
});
