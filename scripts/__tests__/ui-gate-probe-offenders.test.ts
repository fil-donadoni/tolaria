import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { Window } from "happy-dom";
import {
    FLOORS,
    readingsOf,
    type AxeCount,
    type ProbeResult,
} from "../ui-gate/floors";

/**
 * The probe's offender boxes (issue #6145): every Floor bucket that reads
 * nonzero names at least one box — selector and viewport rect — so a failing
 * cell's screenshot can outline WHAT broke. Before, only the square and soft
 * buckets named offenders, and the zero-size, stranded and overflow Floors
 * were bare counts.
 *
 * Runs the real `probe.js` in happy-dom with the geometry stubbed, as
 * `ui-gate-probe.test.ts` does (happy-dom computes no layout).
 */

const PROBE_SOURCE = readFileSync(
    path.join(__dirname, "../ui-gate/probe.js"),
    "utf8"
);

interface StubRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

function fullRect(r: StubRect) {
    return {
        ...r,
        right: r.left + r.width,
        bottom: r.top + r.height,
        x: r.left,
        y: r.top,
        toJSON() {},
    };
}

const cdn = (variant: string) =>
    `https://cards.scryfall.io/${variant}/front/b/d/bd.webp`;

function probeWith(opts: {
    html: string;
    rects: Record<string, StubRect>;
    current?: Record<string, string>;
    scrollWidth?: number;
}): ProbeResult {
    const window = new Window({ url: "http://localhost/" });
    const context = createContext(window as unknown as object);
    const doc = window.document;
    doc.body.innerHTML = opts.html;
    Object.defineProperty(window, "innerWidth", { value: 400 });
    Object.defineProperty(window, "innerHeight", { value: 800 });
    Object.defineProperty(window, "devicePixelRatio", { value: 2 });
    Object.defineProperty(doc.documentElement, "scrollWidth", {
        value: opts.scrollWidth ?? 400,
    });
    for (const [id, r] of Object.entries(opts.rects)) {
        const el = doc.getElementById(id)!;
        el.getBoundingClientRect = () => fullRect(r) as never;
        Object.defineProperty(el, "offsetWidth", { value: r.width });
    }
    for (const [id, url] of Object.entries(opts.current ?? {})) {
        Object.defineProperty(doc.getElementById(id)!, "currentSrc", {
            value: url,
        });
    }
    doc.elementFromPoint = (() => null) as never;
    runInContext(PROBE_SOURCE, context);
    runInContext("globalThis.__result = window.__tolariaProbe();", context);
    return (window as unknown as { __result: ProbeResult }).__result;
}

const NO_AXE: AxeCount = {
    serious: 0,
    critical: 0,
    ids: [],
    exempt: 0,
    offenders: [],
};

/** The Floors `probe.js` owns — every one but axe's. */
const PROBE_FLOORS = FLOORS.filter((f) => !f.startsWith("axe"));

describe("check:ui probe — every Floor bucket names its offenders (issue #6145)", () => {
    // One page breaking every probe-owned Floor at once: a zero-size card, a
    // card and a control stranded below the fold with nothing to scroll
    // them, a printed face resolving a rendition too small for its slot, one
    // resolving a rendition the probe does not know, a zero-size control,
    // and a banner wider than the viewport.
    const broken = () =>
        probeWith({
            html: `
                <img id="cz" alt="Zero" src="${cdn("normal")}" />
                <img id="cs" alt="Stranded" style="border-radius:10px" src="${cdn("normal")}" />
                <img id="soft" alt="Brainstorm" data-card-face="printed" src="${cdn("grid")}" />
                <img id="unk" alt="Opt" data-card-face="printed" src="${cdn("grid")}" />
                <button id="bz">Zero</button>
                <button id="bs">Stranded</button>
                <div id="wide">banner</div>
            `,
            rects: {
                cz: { left: 10, top: 10, width: 0, height: 0 },
                cs: { left: 20, top: 2000, width: 78, height: 109 },
                soft: { left: 100, top: 100, width: 200, height: 279 },
                unk: { left: 100, top: 400, width: 100, height: 140 },
                bz: { left: 5, top: 5, width: 2, height: 2 },
                bs: { left: 5, top: 3000, width: 80, height: 44 },
                wide: { left: 0, top: 700, width: 640, height: 40 },
            },
            current: { soft: cdn("small"), unk: cdn("mystery") },
            scrollWidth: 640,
        });

    it("the fixture breaks every probe-owned Floor", () => {
        const readings = readingsOf(broken(), NO_AXE);
        for (const floor of PROBE_FLOORS)
            expect(readings[floor], floor).toBeGreaterThan(0);
    });

    it("names at least one offender rect for every nonzero bucket", () => {
        const probe = broken();
        const readings = readingsOf(probe, NO_AXE);
        for (const floor of PROBE_FLOORS) {
            if (readings[floor] === 0) continue;
            expect(
                probe.offenders.some((o) => o.floor === floor),
                `${floor} reads ${readings[floor]} with no offender`
            ).toBe(true);
        }
    });

    it("reports each box where it was measured, named by selector", () => {
        const probe = broken();
        const at = (floor: string) =>
            probe.offenders.filter((o) => o.floor === floor);
        expect(at("cardsStranded")).toContainEqual(
            expect.objectContaining({
                sel: "img#cs",
                x: 20,
                y: 2000,
                w: 78,
                h: 109,
            })
        );
        expect(at("cardsZero")).toContainEqual(
            expect.objectContaining({ sel: "img#cz", w: 0, h: 0 })
        );
        expect(at("ctrlsZero")).toContainEqual(
            expect.objectContaining({ sel: "button#bz" })
        );
        expect(at("ctrlsStranded")).toContainEqual(
            expect.objectContaining({ sel: "button#bs", y: 3000 })
        );
        expect(
            at("cardsSoft")
                .map((o) => o.sel)
                .sort()
        ).toEqual(["img#soft", "img#unk"]);
        expect(at("hOverflow")).toEqual([
            expect.objectContaining({ sel: "div#wide", w: 640 }),
        ]);
    });

    it("stands the document in for a sideways scroll no box explains", () => {
        const probe = probeWith({
            html: `<div id="a">a</div>`,
            rects: { a: { left: 0, top: 0, width: 400, height: 20 } },
            scrollWidth: 430,
        });
        expect(probe.hOverflow).toBe(30);
        expect(probe.offenders).toEqual([
            expect.objectContaining({
                floor: "hOverflow",
                sel: "html",
                w: 430,
            }),
        ]);
    });

    it("names nothing on a page that breaks no Floor", () => {
        const probe = probeWith({
            html: `<button id="ok">Fine</button>`,
            rects: { ok: { left: 10, top: 10, width: 80, height: 44 } },
        });
        expect(probe.offenders).toEqual([]);
    });
});
