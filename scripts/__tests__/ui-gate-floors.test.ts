import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
    FLOORS,
    SHAPE_READINGS,
    UNWALKED_SURFACES,
    brokenFloors,
    readingsOf,
    type AxeCount,
    type ProbeResult,
    type Readings,
    type UnwalkedSurface,
} from "../ui-gate/floors.ts";
import {
    PASS_DETAIL,
    coverageLine,
    diagnosticLines,
    evaluateRun,
    receiptKindLine,
    receiptKindOf,
    verdictBlockLines,
    zeroReadings,
    type SurfaceWalk,
} from "../ui-gate/receipt.ts";
import { SURFACE_IDS } from "../ui-gate/surfaces.ts";

/**
 * `check:ui` is an invariant gate (ADR 0132, issue #3648): nine Floors held at
 * zero, four Shape Readings printed and never compared, and a surface the lane
 * could not measure never reported as green. The evaluation is a pure function
 * of (scope, walks, viewport matrix, declared-unwalked list), which is what
 * makes all of it testable without a browser.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const VIEWPORTS = ["1440x900x2", "390x844x3"];

function readings(over: Partial<Readings> = {}): Readings {
    return { ...zeroReadings(), ...over };
}

function measured(
    surface: string,
    at: Record<string, Readings> = Object.fromEntries(
        VIEWPORTS.map((v) => [v, readings()])
    )
): SurfaceWalk {
    return {
        surface,
        status: "measured",
        measurements: Object.entries(at).map(([viewport, r]) => ({
            viewport,
            readings: r,
        })),
    };
}

function evaluate(
    known: string[],
    walks: SurfaceWalk[],
    unwalked: UnwalkedSurface[] = [],
    defined: string[] = known
) {
    return evaluateRun({
        knownSurfaceIds: known,
        walks,
        definedSurfaceIds: defined,
        viewportIds: VIEWPORTS,
        unwalked,
    });
}

describe("Floors and Shape Readings", () => {
    it("are the nine Floors and four Shape Readings ADR 0132 names, disjoint", () => {
        expect([...FLOORS]).toEqual([
            "cardsZero",
            "cardsStranded",
            "cardsSquare",
            "cardsSoft",
            "ctrlsZero",
            "ctrlsStranded",
            "axeSerious",
            "axeCritical",
            "hOverflow",
        ]);
        expect([...SHAPE_READINGS]).toEqual([
            "cardsOcc",
            "ctrlsOcc",
            "small",
            "starved",
        ]);
    });

    it("brokenFloors names every nonzero Floor with its reading, in FLOORS order", () => {
        for (const floor of FLOORS) {
            expect(brokenFloors(readings({ [floor]: 2 }))).toEqual([
                { floor, reading: 2 },
            ]);
        }
        expect(brokenFloors(readings({ hOverflow: 14, cardsZero: 1 }))).toEqual(
            [
                { floor: "cardsZero", reading: 1 },
                { floor: "hOverflow", reading: 14 },
            ]
        );
    });

    it("brokenFloors never consults a Shape Reading, however large", () => {
        expect(
            brokenFloors(
                readings({ cardsOcc: 99, ctrlsOcc: 40, small: 57, starved: 8 })
            )
        ).toEqual([]);
    });
});

describe("readingsOf — probe/axe → Readings", () => {
    const probe: ProbeResult = {
        vp: "1440x900",
        cards: { n: 40, zero: 1, occ: 2, reachable: 3, stranded: 4 },
        cardsSquareN: 5,
        cardsSquare: [],
        cardsSoftN: 6,
        cardsSoft: [],
        cardsSoftPending: 50,
        cardsSoftUnknown: 7,
        ctrls: { n: 30, zero: 8, occ: 9, reachable: 10, stranded: 11 },
        starvedN: 12,
        starved: [],
        smallN: 13,
        shellBand: { mounted: false, excluded: 0 },
        tinyText: 60,
        hOverflow: 14,
        cardW: null,
    };
    const axe: AxeCount = { serious: 15, critical: 16, ids: [], exempt: 0 };

    it("maps every probe/axe field to its own reading", () => {
        expect(readingsOf(probe, axe)).toEqual({
            cardsZero: 1,
            cardsStranded: 4,
            cardsSquare: 5,
            cardsSoft: 13,
            ctrlsZero: 8,
            ctrlsStranded: 11,
            axeSerious: 15,
            axeCritical: 16,
            hOverflow: 14,
            cardsOcc: 2,
            ctrlsOcc: 9,
            small: 13,
            starved: 12,
        });
    });

    it("counts an unmeasurable card face into the cardsSoft Floor — a face it cannot prove sharp is a hole, not a pass", () => {
        const onlyUnknown = readingsOf(
            { ...probe, cardsSoftN: 0, cardsSoftUnknown: 1 },
            axe
        );
        expect(onlyUnknown.cardsSoft).toBe(1);
    });
});

describe("evaluateRun — a measured cell is judged on the Floors alone", () => {
    it("passes a cell with every Floor at zero, with the constant PASS detail", () => {
        const ev = evaluate(["lobby"], [measured("lobby")]);
        expect(ev.failures).toEqual([]);
        expect(ev.rows).toEqual(
            VIEWPORTS.map((viewport) => ({
                surface: "lobby",
                viewport,
                verdict: "PASS",
                detail: PASS_DETAIL,
            }))
        );
        expect(ev.measuredSurfaces).toBe(1);
    });

    it("fails a cell with a broken Floor, the reading on the line", () => {
        const ev = evaluate(
            ["lobby"],
            [
                measured("lobby", {
                    "1440x900x2": readings({ axeSerious: 1, hOverflow: 16 }),
                    "390x844x3": readings(),
                }),
            ]
        );
        expect(ev.rows[0]).toEqual({
            surface: "lobby",
            viewport: "1440x900x2",
            verdict: "FAIL",
            detail: "broken floor: axeSerious 1, hOverflow 16",
        });
        expect(ev.failures).toEqual([
            "lobby @ 1440x900x2: axeSerious 1, hOverflow 16",
        ]);
        expect(ev.measuredSurfaces).toBe(0);
    });

    it("passes a cell whose Shape Readings are high: they are printed, never compared", () => {
        const high = readings({
            cardsOcc: 9,
            ctrlsOcc: 4,
            small: 31,
            starved: 2,
        });
        const ev = evaluate(
            ["lobby"],
            [measured("lobby", { "1440x900x2": high, "390x844x3": high })]
        );
        expect(ev.failures).toEqual([]);
        expect(ev.rows.every((r) => r.verdict === "PASS")).toBe(true);
        expect(diagnosticLines(ev)[0]).toContain(
            "cardsOcc 9 ctrlsOcc 4 small 31 starved 2"
        );
    });
});

describe("evaluateRun — coverage is asserted, never assumed", () => {
    it("fails a surface the run could not reach, quoting the reason", () => {
        const ev = evaluate(
            ["lobby"],
            [{ surface: "lobby", status: "unreachable", reason: "no tile" }]
        );
        expect(ev.rows).toEqual([
            {
                surface: "lobby",
                viewport: null,
                verdict: "UNWALKED",
                detail: "unreachable: no tile",
            },
        ]);
        expect(ev.failures).toEqual(["lobby: could not be reached — no tile"]);
    });

    it("fails a surface the run never attempted", () => {
        const ev = evaluate(["lobby"], []);
        expect(ev.rows[0].verdict).toBe("UNWALKED");
        expect(ev.failures).toHaveLength(1);
    });

    it("fails a viewport that produced no measurement", () => {
        const ev = evaluate(
            ["lobby"],
            [measured("lobby", { "1440x900x2": readings() })]
        );
        expect(ev.rows[1]).toEqual({
            surface: "lobby",
            viewport: "390x844x3",
            verdict: "UNWALKED",
            detail: "no measurement at this viewport",
        });
        expect(ev.failures).toEqual(["lobby @ 390x844x3: not measured"]);
        expect(ev.measuredSurfaces).toBe(0);
    });

    it("skips a declared-unwalked surface without a row or a failure, and names it with its issue on the coverage line", () => {
        const declared = { surface: "game-board", reason: "why", issue: 3695 };
        const ev = evaluate(
            ["lobby", "game-board"],
            [measured("lobby")],
            [declared]
        );
        expect(ev.failures).toEqual([]);
        expect(ev.rows.some((r) => r.surface === "game-board")).toBe(false);
        expect(ev.declaredUnwalked).toEqual([declared]);
        expect(coverageLine(ev)).toBe(
            "coverage: 1/2 surfaces measured, 1 declared unwalked: game-board (issue #3695)"
        );
        expect(receiptKindLine(ev)).toBe(
            "RECEIPT — full lane run, 2 surface(s) in scope (1 measured, 1 declared unwalked)"
        );
    });

    it("counts a declared-unwalked surface only when the run's scope contains it", () => {
        const ev = evaluateRun({
            knownSurfaceIds: ["lobby"],
            walks: [measured("lobby")],
            definedSurfaceIds: ["lobby", "game-board"],
            viewportIds: VIEWPORTS,
            unwalked: [{ surface: "game-board", reason: "why", issue: 1 }],
            diffScope: { base: "origin/base", surfaces: ["lobby"] },
        });
        expect(coverageLine(ev)).toBe(
            "coverage: 1/1 surfaces measured, 0 declared unwalked"
        );
    });
});

describe("the verdict block is deterministic; the diagnostic block is not part of it", () => {
    it("two runs differing only in Shape Readings and infra load print identical verdict blocks", () => {
        const a = evaluate(
            ["lobby", "deck-builder"],
            [
                measured("lobby", {
                    "1440x900x2": readings({ cardsOcc: 1, small: 24 }),
                    "390x844x3": readings(),
                }),
                {
                    surface: "deck-builder",
                    status: "measured",
                    measurements: [
                        { viewport: "1440x900x2", readings: readings() },
                    ],
                    infra: [
                        {
                            viewport: "390x844x3",
                            signature: "function-timeout",
                            load: 23.4,
                            reason: "first attempt",
                        },
                    ],
                },
            ]
        );
        const b = evaluate(
            ["lobby", "deck-builder"],
            [
                measured("lobby", {
                    "1440x900x2": readings({ cardsOcc: 5, small: 26 }),
                    "390x844x3": readings({ starved: 3 }),
                }),
                {
                    surface: "deck-builder",
                    status: "measured",
                    measurements: [
                        {
                            viewport: "1440x900x2",
                            readings: readings({ ctrlsOcc: 2 }),
                        },
                    ],
                    infra: [
                        {
                            viewport: "390x844x3",
                            signature: "function-timeout",
                            load: 31.9,
                            reason: "another attempt",
                        },
                    ],
                },
            ]
        );
        expect(verdictBlockLines(a)).toEqual(verdictBlockLines(b));
        expect(diagnosticLines(a)).not.toEqual(diagnosticLines(b));
    });
});

describe("receiptKindOf — RECEIPT / SCOPED / DIAGNOSTIC is a pure function of the surface lists (issues #2742, #3628)", () => {
    const all = ["a", "b", "c"];

    it("is RECEIPT when the request names every defined surface, in any order", () => {
        expect(receiptKindOf(["c", "a", "b"], all)).toEqual({
            kind: "RECEIPT",
            unmeasuredSurfaces: [],
        });
    });

    it("is DIAGNOSTIC for a subset, naming what it did not measure", () => {
        expect(receiptKindOf(["a"], all)).toEqual({
            kind: "DIAGNOSTIC",
            unmeasuredSurfaces: ["b", "c"],
        });
    });

    it("is DIAGNOSTIC, never RECEIPT, when the lane defines nothing", () => {
        expect(receiptKindOf([], []).kind).toBe("DIAGNOSTIC");
    });

    it("is SCOPED only when the request equals the diff scope; the same subset with no diff scope is DIAGNOSTIC", () => {
        const scope = { base: "origin/base", surfaces: ["b", "a"] };
        expect(receiptKindOf(["a", "b"], all, scope).kind).toBe("SCOPED");
        expect(receiptKindOf(["a", "b"], all).kind).toBe("DIAGNOSTIC");
        expect(receiptKindOf(["a"], all, scope).kind).toBe("DIAGNOSTIC");
        expect(receiptKindOf(["a", "b", "c"], all, scope).kind).toBe("RECEIPT");
        expect(
            receiptKindOf([], all, { base: "origin/base", surfaces: [] }).kind
        ).toBe("SCOPED");
    });

    it("a SCOPED banner names the base and the surfaces; an empty scope says it walked nothing", () => {
        const scoped = evaluateRun({
            knownSurfaceIds: ["lobby"],
            walks: [measured("lobby")],
            definedSurfaceIds: ["lobby", "deck-builder"],
            viewportIds: VIEWPORTS,
            unwalked: [],
            diffScope: { base: "origin/base", surfaces: ["lobby"] },
        });
        expect(receiptKindLine(scoped)).toBe(
            "SCOPED — diff base origin/base, 1 surface(s) in scope: lobby (1 measured, 0 declared unwalked)"
        );
        const empty = evaluateRun({
            knownSurfaceIds: [],
            walks: [],
            definedSurfaceIds: ["lobby"],
            viewportIds: VIEWPORTS,
            unwalked: [],
            diffScope: { base: "origin/base", surfaces: [] },
        });
        expect(verdictBlockLines(empty)).toEqual([
            "SCOPED — diff base origin/base, 0 surface(s) in scope: nothing in this diff reaches a walked route",
            "coverage: 0/0 surfaces measured, 0 declared unwalked",
        ]);
    });
});

describe("UNWALKED_SURFACES — the declared-unwalked list lives in code (ADR 0132 §1)", () => {
    it("every entry names a defined surface, once, with a reason and an issue", () => {
        const seen = new Set<string>();
        for (const u of UNWALKED_SURFACES) {
            expect(
                SURFACE_IDS,
                `${u.surface} is not a defined surface`
            ).toContain(u.surface);
            expect(seen.has(u.surface), `${u.surface} listed twice`).toBe(
                false
            );
            seen.add(u.surface);
            expect(
                u.reason.trim().length,
                `${u.surface} has no reason`
            ).toBeGreaterThan(0);
            expect(
                Number.isInteger(u.issue) && u.issue > 0,
                `${u.surface} needs a real tracking issue number`
            ).toBe(true);
        }
    });
});

describe("the budget file is retired (ADR 0132)", () => {
    it("budgets.json and budgets.ts no longer exist", () => {
        expect(
            existsSync(resolve(REPO_ROOT, "scripts/ui-gate/budgets.json"))
        ).toBe(false);
        expect(
            existsSync(resolve(REPO_ROOT, "scripts/ui-gate/budgets.ts"))
        ).toBe(false);
    });

    it.each(["--record", "--accept=lobby.1440x900x2.cardsOcc"])(
        "check:ui refuses %s as an unknown flag, before any browser or deployment",
        (flag) => {
            const r = spawnSync(
                "bun",
                [resolve(REPO_ROOT, "scripts/ui-gate/index.ts"), flag],
                { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 }
            );
            expect(r.status).toBe(2);
            expect(r.stderr).toContain(`unknown flag ${flag}`);
        }
    );
});
