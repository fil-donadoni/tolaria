import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { Window } from "happy-dom";

/**
 * The occlusion probe's card selector (`scripts/ui-gate/probe.js`) — the
 * `cards` count that feeds `bun run check:ui` and its budgets.
 *
 * Regression for the decorative-art false positive: `img[src*="scryfall"]`
 * also matched `AmbientPageGround`'s random full-bleed background art
 * (`data-ambient-art`, `aria-hidden`) and `FeaturedDeckArt`'s hero splash
 * (`aria-hidden`) — both draw real `cards.scryfall.io` URLs, so every
 * `cards`/`cardsOcc` reading on a surface mounting either component was a
 * coin flip on what the random draw happened to pick that run. Excluding
 * `aria-hidden="true"` (and, redundantly but explicitly, `[data-ambient-art]`)
 * fixes the selector's SEMANTICS — a decorative image is never a card,
 * independent of whether the draw is made deterministic.
 *
 * This runs the actual `probe.js` source (no copy/paraphrase) against a
 * `happy-dom` document via `vm` — the same trick `vitest-environment-happy-dom`
 * uses internally, done by hand here so this file can stay in the `scripts`
 * node project rather than pull the whole file into the `dom` project.
 */

const PROBE_SOURCE = readFileSync(
    path.join(__dirname, "../ui-gate/probe.js"),
    "utf8"
);

/** Evaluate `probe.js` in a fresh happy-dom document and return
 *  `window.__tolariaProbe().cards` for the given `<body>` markup. */
function probeCards(bodyHtml: string) {
    const window = new Window({ url: "http://localhost/" });
    const context = createContext(window as unknown as object);
    window.document.body.innerHTML = bodyHtml;
    runInContext(PROBE_SOURCE, context);
    runInContext("globalThis.__result = window.__tolariaProbe();", context);
    return (window as unknown as { __result: { cards: { n: number } } })
        .__result.cards;
}

describe("check:ui probe — card selector excludes decorative art", () => {
    it("does not count AmbientPageGround's random background art as a card", () => {
        // The exact shape `ambient-page-ground.tsx` renders: `data-ambient-art`
        // AND `aria-hidden="true"` on an `<img>` whose `src` is a genuine
        // `cards.scryfall.io` URL (the rotation pool mixes local frames with
        // hand-picked card art — see `ambient-backgrounds.ts`).
        const cards = probeCards(`
            <div data-ambient-ground aria-hidden="true">
                <img data-ambient-art aria-hidden="true" alt=""
                     src="https://cards.scryfall.io/art_crop/front/a/a/aaaa.jpg?1" />
            </div>
        `);
        expect(cards.n).toBe(0);
    });

    it("does not count FeaturedDeckArt's hero splash as a card", () => {
        // `featured-deck-art.tsx`: `aria-hidden` WITHOUT `data-ambient-art` —
        // the decorative marker the fix must not rely on exclusively.
        const cards = probeCards(`
            <img aria-hidden="true" alt=""
                 src="https://cards.scryfall.io/art_crop/front/b/b/bbbb.jpg?1" />
        `);
        expect(cards.n).toBe(0);
    });

    it("still counts a real card image (no aria-hidden, no data-ambient-art)", () => {
        // The exact shape `card-image.tsx` renders for a real board/hand card:
        // a plain `<img>` with a non-empty `alt` (the card name) and no
        // decorative marker.
        const cards = probeCards(`
            <img alt="Lightning Bolt"
                 src="https://cards.scryfall.io/normal/front/c/c/cccc.jpg?1" />
        `);
        expect(cards.n).toBe(1);
    });

    it("still counts a real card image nested under a non-hidden ancestor", () => {
        // `closest` must not over-match plain ancestors — only ones that are
        // themselves decorative.
        const cards = probeCards(`
            <div class="battlefield">
                <div class="card-slot">
                    <img alt="Grizzly Bears"
                         src="https://cards.scryfall.io/normal/front/d/d/dddd.jpg?1" />
                </div>
            </div>
        `);
        expect(cards.n).toBe(1);
    });

    it("counts a real card alongside decorative art without conflating them", () => {
        const cards = probeCards(`
            <img data-ambient-art aria-hidden="true" alt=""
                 src="https://cards.scryfall.io/art_crop/front/e/e/eeee.jpg?1" />
            <img alt="Counterspell"
                 src="https://cards.scryfall.io/normal/front/f/f/ffff.jpg?1" />
        `);
        expect(cards.n).toBe(1);
    });
});

/**
 * The `occ` vs `reachable` classification (`probe.js`'s `probe()`).
 *
 * happy-dom computes no layout, so the geometry every branch below turns on is
 * stubbed EXPLICITLY — `getBoundingClientRect`, `clientHeight`/`scrollHeight`
 * and `elementFromPoint` — with the numbers browser-measured on the real lobby
 * at 390x844x3 (see the comment in `probe.js`). That is the point: these are
 * the two shapes the lane cannot tell apart from counts alone, pinned as a
 * table rather than re-argued from a screenshot.
 */
interface StubRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

function fullRect(r: StubRect) {
    return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        right: r.left + r.width,
        bottom: r.top + r.height,
        x: r.left,
        y: r.top,
        toJSON() {},
    };
}

function probeCtrls(opts: {
    vw: number;
    vh: number;
    html: string;
    rects: Record<string, StubRect>;
    /** Elements whose own box is a scroll port: id → [clientHeight, scrollHeight]. */
    scrollers?: Record<string, [number, number]>;
    /** What `elementFromPoint` returns, as an element id (`null` = nothing). */
    hit: (x: number, y: number) => string | null;
}) {
    const window = new Window({ url: "http://localhost/" });
    const context = createContext(window as unknown as object);
    const doc = window.document;
    doc.body.innerHTML = opts.html;

    Object.defineProperty(window, "innerWidth", { value: opts.vw });
    Object.defineProperty(window, "innerHeight", { value: opts.vh });

    for (const [id, r] of Object.entries(opts.rects)) {
        const el = doc.getElementById(id)!;
        el.getBoundingClientRect = () => fullRect(r) as never;
    }
    for (const [id, [clientHeight, scrollHeight]] of Object.entries(
        opts.scrollers ?? {}
    )) {
        const el = doc.getElementById(id)!;
        Object.defineProperty(el, "clientHeight", {
            value: clientHeight,
            configurable: true,
        });
        Object.defineProperty(el, "scrollHeight", {
            value: scrollHeight,
            configurable: true,
        });
    }
    doc.elementFromPoint = ((x: number, y: number) => {
        const id = opts.hit(x, y);
        return id === null ? null : doc.getElementById(id);
    }) as never;

    runInContext(PROBE_SOURCE, context);
    runInContext("globalThis.__result = window.__tolariaProbe();", context);
    return (
        window as unknown as {
            __result: {
                ctrls: { occ: number; reachable: number; stranded: number };
            };
        }
    ).__result.ctrls;
}

/** The lobby's shape at 390x844x3 with issue #2582's bottom nav mounted:
 *  `<main>` 0-788 (scrolls, 2184 of content), the nav 788-844, and a control
 *  straddling `<main>`'s clip edge — browser-measured `Your Events (all)`,
 *  y 773-817, centre 795. */
const BOTTOM_NAV_HTML = `
    <div id="root">
        <main id="port" style="overflow-y:auto">
            <div id="page"><button id="btn">Your Events (all)</button></div>
        </main>
        <nav id="nav"></nav>
    </div>
`;

describe("check:ui probe — occ vs reachable across a scroll port's edge", () => {
    it("scores a control clipped by <main> as reachable, not occluded, when a band sits below it", () => {
        const ctrls = probeCtrls({
            vw: 390,
            vh: 844,
            html: BOTTOM_NAV_HTML,
            rects: {
                port: { left: 0, top: 0, width: 390, height: 788 },
                nav: { left: 0, top: 788, width: 390, height: 56 },
                btn: { left: 49, top: 773, width: 148, height: 44 },
            },
            scrollers: { port: [788, 2184] },
            // The centre (123, 795) lands in the nav's band — `<main>` does not
            // paint there, so the raw viewport test called this occluded.
            hit: () => "nav",
        });
        expect(ctrls.occ).toBe(0);
        expect(ctrls.reachable).toBe(1);
    });

    it("still scores a control as occluded when something genuinely paints over it", () => {
        // The overlay shape: a `position: fixed` scrim does NOT shrink
        // `<main>`'s box, so the same centre is inside the port's window and
        // the hit test still runs. This is the assertion that keeps the fix
        // above from being a blanket amnesty for anything in a scroller.
        const ctrls = probeCtrls({
            vw: 390,
            vh: 844,
            html: `
                <div id="root">
                    <main id="port" style="overflow-y:auto">
                        <div id="page"><button id="btn">Confirm</button></div>
                    </main>
                    <div id="scrim"></div>
                </div>
            `,
            rects: {
                port: { left: 0, top: 0, width: 390, height: 844 },
                scrim: { left: 0, top: 0, width: 390, height: 844 },
                btn: { left: 49, top: 400, width: 148, height: 44 },
            },
            scrollers: { port: [844, 2184] },
            hit: () => "scrim",
        });
        expect(ctrls.occ).toBe(1);
        expect(ctrls.reachable).toBe(0);
    });

    it("still scores a control with no scrollable ancestor as stranded", () => {
        // Off-screen with nothing that can scroll it back: unreachable by any
        // gesture, the floor the lane holds at 0.
        const ctrls = probeCtrls({
            vw: 390,
            vh: 844,
            html: `<div id="root"><button id="btn">Ghost</button></div>`,
            rects: { btn: { left: 49, top: 1200, width: 148, height: 44 } },
            hit: () => null,
        });
        expect(ctrls.stranded).toBe(1);
        expect(ctrls.reachable).toBe(0);
        expect(ctrls.occ).toBe(0);
    });
});
