import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { Window } from "happy-dom";
import type { AssertResult } from "../ui-gate/assertions";
import {
    assertAndShoot,
    outlineSpec,
    shotFileName,
    type OutlineSpec,
} from "../ui-gate/failure-shot";
import type { AxeCount, Offender, ProbeResult } from "../ui-gate/floors";

/**
 * Failure shots (issue #6145): a passing cell writes no PNG, a failing cell
 * writes exactly one — before the Named Assertions when a Floor broke (they
 * scroll, and would move what was measured), after them when only an
 * assertion failed. The page work is stubbed; the shot is a real file, so the
 * test counts PNGs the way the acceptance criterion states them.
 */

function probeOf(
    over: Partial<ProbeResult> = {},
    offenders: Offender[] = []
): ProbeResult {
    return {
        vp: "390x844",
        cards: { n: 4, zero: 0, occ: 0, reachable: 0, stranded: 0 },
        cardsSquareN: 0,
        cardsSquare: [],
        cardsSoftN: 0,
        cardsSoft: [],
        cardsSoftPending: 0,
        cardsSoftUnknown: 0,
        ctrls: { n: 9, zero: 0, occ: 3, reachable: 0, stranded: 0 },
        starvedN: 2,
        starved: [],
        smallN: 7,
        shellBand: { mounted: false, excluded: 0 },
        tinyText: 0,
        hOverflow: 0,
        cardW: null,
        offenders,
        ...over,
    };
}

const CLEAN_AXE: AxeCount = {
    serious: 0,
    critical: 0,
    ids: [],
    exempt: 0,
    offenders: [],
};

const ZERO_CARD: Offender = {
    floor: "cardsZero",
    sel: "img.card",
    t: "Mountain",
    x: 10,
    y: 20,
    w: 0,
    h: 0,
    why: "",
};

let dir: string;
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** One cell's tail with a real file for a shot, recording the call order. */
async function runCell(opts: {
    probe: ProbeResult;
    axe?: AxeCount;
    asserts: AssertResult[];
}) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-gate-shot-"));
    const order: string[] = [];
    const specs: OutlineSpec[] = [];
    const result = await assertAndShoot({
        probe: opts.probe,
        axe: opts.axe ?? CLEAN_AXE,
        shoot: async (spec) => {
            order.push("shoot");
            specs.push(spec);
            fs.writeFileSync(
                path.join(dir, shotFileName("lobby", "390x844x3")),
                "png"
            );
        },
        assertions: async () => {
            order.push("assertions");
            return opts.asserts;
        },
    });
    const pngs = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
    return { result, order, specs, pngs };
}

const PASS: AssertResult = { label: "hand reachable", ok: true, detail: "" };
const FAIL: AssertResult = {
    label: "hand reachable",
    ok: false,
    detail: "0 of 7 cards in view",
};

describe("check:ui failure shots — when a cell is shot (issue #6145)", () => {
    it("a passing cell writes no PNG", async () => {
        const { result, pngs, order } = await runCell({
            probe: probeOf(),
            asserts: [PASS],
        });
        expect(pngs).toEqual([]);
        expect(result.shot).toBe(false);
        expect(order).toEqual(["assertions"]);
    });

    it("Shape Readings alone are no failure: no PNG", async () => {
        // `occ`, `small`, `starved` are nonzero in every fixture above.
        const { pngs } = await runCell({
            probe: probeOf({
                cards: { n: 4, zero: 0, occ: 9, reachable: 2, stranded: 0 },
            }),
            asserts: [PASS],
        });
        expect(pngs).toEqual([]);
    });

    it("a broken Floor writes exactly one PNG, BEFORE the assertions", async () => {
        const { result, pngs, order } = await runCell({
            probe: probeOf(
                { cards: { n: 4, zero: 1, occ: 0, reachable: 0, stranded: 0 } },
                [ZERO_CARD]
            ),
            asserts: [PASS],
        });
        expect(pngs).toEqual(["lobby__390x844x3.png"]);
        expect(result.shot).toBe(true);
        expect(order).toEqual(["shoot", "assertions"]);
    });

    it("an assertion failure alone writes exactly one PNG, AFTER the assertions", async () => {
        const { pngs, order, specs } = await runCell({
            probe: probeOf(),
            asserts: [FAIL],
        });
        expect(pngs).toEqual(["lobby__390x844x3.png"]);
        expect(order).toEqual(["assertions", "shoot"]);
        expect(specs[0].banner).toEqual([
            "ASSERT FAIL hand reachable — 0 of 7 cards in view",
        ]);
    });

    it("a broken Floor AND a failed assertion still write one PNG", async () => {
        const { order } = await runCell({
            probe: probeOf({ hOverflow: 12 }),
            axe: { ...CLEAN_AXE, serious: 1 },
            asserts: [FAIL],
        });
        expect(order.filter((s) => s === "shoot")).toHaveLength(1);
    });
});

describe("check:ui failure shots — what the overlay outlines", () => {
    it("names an unlocated axe target on the banner instead of drawing it at the origin", () => {
        const spec = outlineSpec(
            probeOf(),
            {
                ...CLEAN_AXE,
                critical: 1,
                offenders: [
                    {
                        floor: "axeCritical",
                        sel: "iframe,#x",
                        t: "",
                        x: -1,
                        y: -1,
                        w: -1,
                        h: -1,
                        why: "button-name",
                    },
                ],
            },
            [{ floor: "axeCritical", reading: 1 }],
            []
        );
        expect(spec.boxes).toEqual([]);
        expect(spec.banner).toEqual([
            "axeCritical 1",
            "axeCritical iframe,#x — button-name (not located)",
        ]);
    });

    it("outlines only the offenders of BROKEN Floors, labelled with the Floor", () => {
        const spec = outlineSpec(
            probeOf({}, [
                ZERO_CARD,
                {
                    ...ZERO_CARD,
                    floor: "hOverflow",
                    sel: "div#wide",
                    t: "",
                    why: "right edge 640",
                },
            ]),
            {
                ...CLEAN_AXE,
                serious: 1,
                offenders: [
                    {
                        floor: "axeSerious",
                        sel: "#cta",
                        t: "",
                        x: 1,
                        y: 2,
                        w: 30,
                        h: 10,
                        why: "color-contrast",
                    },
                ],
            },
            [
                { floor: "cardsZero", reading: 1 },
                { floor: "axeSerious", reading: 1 },
            ],
            []
        );
        expect(spec.boxes.map((b) => b.label)).toEqual([
            "cardsZero Mountain",
            "axeSerious #cta — color-contrast",
        ]);
        expect(spec.banner).toEqual(["cardsZero 1", "axeSerious 1"]);
    });
});

/** `overlay.js`, the real file, in happy-dom. */
function overlayPage() {
    const window = new Window({ url: "http://localhost/" });
    Object.defineProperty(window, "innerWidth", { value: 400 });
    Object.defineProperty(window, "innerHeight", { value: 800 });
    const context = createContext(window as unknown as object);
    runInContext(
        fs.readFileSync(path.join(__dirname, "../ui-gate/overlay.js"), "utf8"),
        context
    );
    const call = (src: string) => runInContext(src, context);
    return { doc: window.document, call };
}

describe("check:ui failure shots — overlay.js", () => {
    it("draws a box per offender, pins an off-screen one to the edge, and clears", () => {
        const { doc, call } = overlayPage();
        const spec: OutlineSpec = {
            boxes: [
                { x: 10, y: 20, w: 80, h: 40, label: "cardsSoft Opt" },
                {
                    x: 20,
                    y: 2000,
                    w: 78,
                    h: 109,
                    label: "cardsStranded Mountain",
                },
                { x: 5, y: 5, w: 0, h: 0, label: "ctrlsZero button" },
            ],
            banner: ["ASSERT FAIL hand reachable — 0 of 7"],
        };
        call(`window.__tolariaOutline(${JSON.stringify(spec)})`);
        const boxes = [
            ...doc.querySelectorAll("[data-ui-gate-box]"),
        ] as unknown as HTMLElement[];
        expect(boxes).toHaveLength(3);
        // Off-screen: pinned inside the 800px viewport, dashed, said so.
        expect(boxes[1].style.top).toBe("788px");
        expect(boxes[1].style.border).toContain("dashed");
        expect(doc.body.textContent).toContain(
            "off-screen cardsStranded Mountain"
        );
        // Zero-size: grown to be seen.
        expect(boxes[2].style.width).toBe("12px");
        expect(doc.querySelector("[data-ui-gate-banner]")!.textContent).toBe(
            "ASSERT FAIL hand reachable — 0 of 7"
        );
        // Inert, and gone before the assertions read the page.
        const root = doc.querySelector(
            "[data-ui-gate-overlay]"
        ) as unknown as HTMLElement;
        expect(root.style.pointerEvents).toBe("none");
        call("window.__tolariaOutlineClear()");
        expect(doc.querySelector("[data-ui-gate-overlay]")).toBeNull();
    });
});
