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
 * and `elementFromPoint` — with numbers browser-measured on the real surfaces
 * (see the comments in `probe.js`). That is the point: these are the shapes the
 * lane cannot tell apart from counts alone, pinned as a table rather than
 * re-argued from a screenshot.
 *
 * The table is deliberately symmetric — a probe change proven only in the
 * direction that REMOVES a count is how the instrument rots, since a probe that
 * reports nothing passes every budget:
 *
 *   1. straddling a port's clip edge, band below      -> not occluded  (#2582)
 *   2. entirely outside the port's box                -> reachable     (#2582)
 *   3. fully inside the port, under a fixed overlay   -> occluded
 *   4. PARTLY clipped by the port, under that overlay -> occluded      (#2619 r3)
 *   5. covered from within its own scroller           -> occluded
 *   6. `position: fixed`, no port, under the overlay  -> occluded      (#2619 r3)
 *   7. off-screen with nothing able to scroll it      -> stranded
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
    it("does not score a control straddling <main>'s clip edge as occluded when a band sits below it", () => {
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
            // Positional, because the whole finding is WHERE the probe tests.
            // The raw centre (123, 795) lands in the nav's band, which is why
            // the pre-#2582 viewport-only test called this occluded; the
            // button's visible strip inside `<main>` is y 773-787, and its
            // intersection centre (123, 780) is the button itself.
            hit: (_x, y) => (y >= 788 ? "nav" : "btn"),
        });
        expect(ctrls.occ).toBe(0);
        expect(ctrls.reachable).toBe(0);
        expect(ctrls.stranded).toBe(0);
    });

    it("scores a control lying entirely outside its scroller's box as reachable", () => {
        // The deck-builder half of the same false positive: the `Delete column
        // MV n` buttons sit past the RIGHT edge of the horizontal card-pile
        // strip (browser-measured @1180x820x2: button left 1153, port right
        // 1080). Nothing of the button is painted, so there is nothing to
        // occlude — one horizontal gesture brings it back, which is what
        // `reachable` means.
        const ctrls = probeCtrls({
            vw: 1180,
            vh: 820,
            html: `
                <div id="root">
                    <div id="port" style="overflow-x:auto;overflow-y:auto">
                        <div id="strip"><button id="btn">Delete column MV 3</button></div>
                    </div>
                </div>
            `,
            rects: {
                port: { left: 0, top: 200, width: 1080, height: 300 },
                btn: { left: 1153, top: 260, width: 40, height: 40 },
            },
            scrollers: { port: [300, 900] },
            // Never consulted: with an empty intersection the probe must not
            // hit-test at all. Returning the port would score `occ` if it did.
            hit: () => "port",
        });
        expect(ctrls.reachable).toBe(1);
        expect(ctrls.occ).toBe(0);
        expect(ctrls.stranded).toBe(0);
    });

    it("still scores a control as occluded when something genuinely paints over it", () => {
        // The overlay shape: a `position: fixed` scrim does NOT shrink
        // `<main>`'s box, so the button is fully inside the port's window and
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

    it("scores a control PARTIALLY clipped by its port and covered by an overlay as occluded", () => {
        // The shape a raw-centre port clip loses, and the reason the hit test
        // uses the centre of the VISIBLE INTERSECTION instead. Browser-measured
        // on `design-system-dialog` @1440x900x2 with the GameDialog demo open:
        // `<main>` starts at y=92, Cancel is [543,76,606,106] and Confirm is
        // [614,76,687,106] — 14px of each is painted below the port's top edge
        // and covered by the modal scrim (`elementFromPoint` there returns
        // `DIV.z-modal fixed inset-0`), while their raw centres (y=91) sit 1px
        // ABOVE the port. Raw-centre scores both `reachable`; the intersection
        // centre (y=99) lands on the painted strip and scores both `occ`.
        //
        // It is not a `ctrlsOcc` nicety: the identical geometry on a card image
        // — half-clipped by its scroll port, covered by an overlay — is exactly
        // what `cardsOcc 0`, a HARD floor of this lane, exists to catch.
        const ctrls = probeCtrls({
            vw: 1440,
            vh: 900,
            html: `
                <div id="root">
                    <main id="port" style="overflow-y:auto">
                        <div id="page">
                            <button id="cancel">Cancel</button>
                            <button id="confirm">Confirm</button>
                        </div>
                    </main>
                    <div id="scrim"></div>
                </div>
            `,
            rects: {
                port: { left: 0, top: 92, width: 1440, height: 808 },
                scrim: { left: 0, top: 0, width: 1440, height: 900 },
                cancel: { left: 543, top: 76, width: 63, height: 30 },
                confirm: { left: 614, top: 76, width: 73, height: 30 },
            },
            scrollers: { port: [808, 2400] },
            // Nothing paints above y=92 except the scrim, and the scrim covers
            // the whole viewport: any point either button still shows through
            // hits the scrim.
            hit: () => "scrim",
        });
        expect(ctrls.occ).toBe(2);
        expect(ctrls.reachable).toBe(0);
    });

    it("scores a control covered WITHIN its own scroller as occluded", () => {
        // Occlusion that has nothing to do with the port's edges: a sticky
        // header painting over a row of the very scroller it lives in. The
        // geometric branch covers it, but it is the case the port clip could
        // most plausibly have broken, so it is written down rather than
        // assumed.
        const ctrls = probeCtrls({
            vw: 390,
            vh: 844,
            html: `
                <div id="root">
                    <main id="port" style="overflow-y:auto">
                        <div id="sticky"></div>
                        <div id="page"><button id="btn">Row action</button></div>
                    </main>
                </div>
            `,
            rects: {
                port: { left: 0, top: 0, width: 390, height: 844 },
                sticky: { left: 0, top: 0, width: 390, height: 120 },
                // Fully inside the port, fully inside the viewport — and
                // entirely under the sticky header.
                btn: { left: 49, top: 60, width: 148, height: 44 },
            },
            scrollers: { port: [844, 2184] },
            hit: () => "sticky",
        });
        expect(ctrls.occ).toBe(1);
        expect(ctrls.reachable).toBe(0);
        expect(ctrls.stranded).toBe(0);
    });

    it("gives a position:fixed control no scroll port, so an overlay over it still scores occluded", () => {
        // `scrollPort` walks `parentElement`, and a fixed control can be nested
        // inside a scroller it is not laid out in — it is positioned against
        // the VIEWPORT, so the scroller's box neither clips it nor moves it.
        // Taking that box as its window would clip the hit test to a rectangle
        // the control does not live in and score it `reachable` while it is
        // painted in plain sight under an overlay. `Report a bug` is the app's
        // one fixed control today; this pins the rule before a second one
        // lands.
        const ctrls = probeCtrls({
            vw: 390,
            vh: 844,
            html: `
                <div id="root">
                    <main id="port" style="overflow-y:auto">
                        <div id="page">
                            <button id="btn" style="position:fixed">Report a bug</button>
                        </div>
                    </main>
                    <div id="scrim"></div>
                </div>
            `,
            rects: {
                // The scroller's box stops at 300; the fixed button paints at
                // 780-824, well outside it, and the scrim covers everything.
                port: { left: 0, top: 0, width: 390, height: 300 },
                scrim: { left: 0, top: 0, width: 390, height: 844 },
                btn: { left: 300, top: 780, width: 80, height: 44 },
            },
            scrollers: { port: [300, 2184] },
            hit: () => "scrim",
        });
        expect(ctrls.occ).toBe(1);
        expect(ctrls.reachable).toBe(0);
        expect(ctrls.stranded).toBe(0);
    });

    it("gives a control inside a position:fixed OVERLAY no scroll port either", () => {
        // The ancestor form of the case above, and the one that is live rather
        // than hypothetical: every modal in this app is a
        // `div.z-modal.fixed.inset-0` rendered INSIDE `<main>`, and `<main>` is
        // the scroller. The dialog's own buttons are static children of that
        // fixed wrapper, so `parentElement` walks straight past it into a
        // scroller whose box does not clip them.
        const ctrls = probeCtrls({
            vw: 390,
            vh: 844,
            html: `
                <div id="root">
                    <main id="port" style="overflow-y:auto">
                        <div id="modal" style="position:fixed">
                            <div id="panel"><button id="btn">Confirm</button></div>
                        </div>
                    </main>
                    <div id="over"></div>
                </div>
            `,
            rects: {
                port: { left: 0, top: 0, width: 390, height: 300 },
                modal: { left: 0, top: 0, width: 390, height: 844 },
                over: { left: 0, top: 0, width: 390, height: 844 },
                // Painted at 500-544 — far outside the scroller's 0-300 box,
                // and not clipped by it, because the wrapper is fixed.
                btn: { left: 49, top: 500, width: 148, height: 44 },
            },
            scrollers: { port: [300, 2184] },
            hit: () => "over",
        });
        expect(ctrls.occ).toBe(1);
        expect(ctrls.reachable).toBe(0);
        expect(ctrls.stranded).toBe(0);
    });

    it("still uses a scroller nested INSIDE a fixed overlay as the port", () => {
        // The stopping rule must not overshoot: a scroller below the fixed box
        // (a modal with its own scrolling body) does clip its descendants, and
        // the walk returns it before ever reaching the fixed wrapper.
        const ctrls = probeCtrls({
            vw: 390,
            vh: 844,
            html: `
                <div id="root">
                    <div id="modal" style="position:fixed">
                        <div id="body" style="overflow-y:auto">
                            <div id="list"><button id="btn">Row 40</button></div>
                        </div>
                    </div>
                </div>
            `,
            rects: {
                modal: { left: 0, top: 100, width: 390, height: 400 },
                body: { left: 0, top: 140, width: 390, height: 300 },
                // Scrolled below the modal body's own fold: still on the
                // viewport, but the body's box does not show it.
                btn: { left: 49, top: 460, width: 148, height: 44 },
            },
            scrollers: { body: [300, 1200] },
            hit: () => "modal",
        });
        expect(ctrls.reachable).toBe(1);
        expect(ctrls.occ).toBe(0);
        expect(ctrls.stranded).toBe(0);
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
