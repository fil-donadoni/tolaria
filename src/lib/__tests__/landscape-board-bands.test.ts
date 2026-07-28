// The landscape-compact board budget (#1768). Pure arithmetic — no renderer:
// the bands must tile, the hand band and a battlefield ROW must be the same
// height (that equality is what lets ONE card scale serve both zones), and the
// derived card footprint must actually FIT both zones when pushed through the
// real layout math (`bandedRowsLayout`), i.e. no clipped 35×49 permanents and
// no oversized hand fan next to them.
//
// The CONTRACT through the real Board (which band class each slot gets, that
// hand and battlefield receive the identical footprint, that desktop/portrait
// are untouched) lives in
// `src/components/board/__tests__/board-landscape-bands.test.tsx`.
import { describe, it, expect } from "vitest";
import {
    BESIDE_CONTROLLER_STRIP,
    CONTROLLER_STRIP_CLEARANCE_EXPR,
} from "~/lib/controller-bar-metrics";
import { bandedRowsLayout, BAND_V_PAD } from "~/lib/board-layout";
import {
    LANDSCAPE_BATTLEFIELD_FRAC,
    LANDSCAPE_BATTLEFIELD_ROWS,
    LANDSCAPE_CARD_H_VAR,
    LANDSCAPE_CARD_W_VAR,
    LANDSCAPE_HAND_BAND_VAR,
    LANDSCAPE_MAX_CARD_H,
    LANDSCAPE_MIDLINE_FRAC,
    LANDSCAPE_MIDLINE_VAR,
    LANDSCAPE_MIN_CARD_H,
    LANDSCAPE_OPP_BF_BOTTOM_VAR,
    LANDSCAPE_OPPONENT_PILES_ANCHOR,
    LANDSCAPE_OPP_HAND_BAND_VAR,
    LANDSCAPE_OPP_HAND_FRAC,
    LANDSCAPE_PILE_SCALE,
    LANDSCAPE_PILE_TILE_VAR,
    LANDSCAPE_RIGHT_RAIL_VAR,
    LANDSCAPE_SIDE_GUTTER,
    LANDSCAPE_SIDE_GUTTER_VAR,
    LANDSCAPE_VIEWER_HAND_FRAC,
    LANDSCAPE_VIEWER_PILES_ANCHOR,
    landscapeBandVars,
    landscapeCardMetrics,
    landscapePileVars,
    makeLandscapeHandLayout,
} from "~/lib/landscape-board-bands";

/** The ticket's representative compact viewport (iPhone 14/15 landscape). */
const PHONE_H = 390;
/** The shortest phone still in range, and the mode's own height ceiling. */
const SHORT_H = 320;
const TALL_H = 500;

const vars = (h: number) => landscapeBandVars(h) as Record<string, string>;

describe("landscape-compact band budget (#1768)", () => {
    it("tiles the board height exactly — no gap, no overlap", () => {
        const total =
            LANDSCAPE_OPP_HAND_FRAC +
            LANDSCAPE_VIEWER_HAND_FRAC +
            LANDSCAPE_BATTLEFIELD_FRAC * LANDSCAPE_BATTLEFIELD_ROWS;
        expect(total).toBeCloseTo(1, 10);
    });

    it("gives both seats the SAME battlefield height", () => {
        // The midline is where the opponent's band ends; the viewer's runs from
        // there to the top of its hand strip. Both are one battlefield frac.
        expect(LANDSCAPE_MIDLINE_FRAC - LANDSCAPE_OPP_HAND_FRAC).toBeCloseTo(
            LANDSCAPE_BATTLEFIELD_FRAC,
            10
        );
        expect(
            1 - LANDSCAPE_VIEWER_HAND_FRAC - LANDSCAPE_MIDLINE_FRAC
        ).toBeCloseTo(LANDSCAPE_BATTLEFIELD_FRAC, 10);
    });

    it("makes a battlefield ROW exactly as tall as the hand band", () => {
        // THE invariant behind "one card scale for hand and battlefield": if
        // these two diverge, a single footprint can only fit one of them and the
        // other clips (or wastes) — which is the #1758 audit finding.
        expect(
            LANDSCAPE_BATTLEFIELD_FRAC / LANDSCAPE_BATTLEFIELD_ROWS
        ).toBeCloseTo(LANDSCAPE_VIEWER_HAND_FRAC, 10);
    });
});

describe("shared card footprint (#1768)", () => {
    it("derives one 5:7 footprint from the board height", () => {
        const { cardWidth, cardHeight } = landscapeCardMetrics(PHONE_H);
        expect(cardHeight).toBe(64);
        expect(cardWidth).toBe(46);
        expect(cardWidth / cardHeight).toBeCloseTo(5 / 7, 2);
    });

    it("is bigger than the desktop board's clipped permanent on the same phone", () => {
        // Baseline: the desktop bands (32% of the board, two rows, BAND_V_PAD)
        // capped a permanent at ~49px tall — the audit's "49×35" cards.
        const desktopRow = (PHONE_H * 0.32) / 2 - BAND_V_PAD;
        expect(landscapeCardMetrics(PHONE_H).cardHeight).toBeGreaterThan(
            desktopRow
        );
    });

    it("clamps to the readability window across the whole phone range", () => {
        expect(landscapeCardMetrics(SHORT_H).cardHeight).toBe(51);
        expect(landscapeCardMetrics(TALL_H).cardHeight).toBe(84);
        // Degenerate boards never produce an unusable or a desktop-sized card.
        expect(landscapeCardMetrics(0).cardHeight).toBe(LANDSCAPE_MIN_CARD_H);
        expect(landscapeCardMetrics(5000).cardHeight).toBe(
            LANDSCAPE_MAX_CARD_H
        );
    });

    it("fits a battlefield row at FULL scale — nothing is clipped or shrunk", () => {
        for (const h of [SHORT_H, PHONE_H, TALL_H]) {
            const { cardWidth, cardHeight, bandPad } = landscapeCardMetrics(h);
            const placements = bandedRowsLayout({
                bands: [
                    { count: 3, centerYFrac: 0.28 },
                    { split: { left: 3, right: 1 }, centerYFrac: 0.74 },
                ],
                width: 600,
                height: h * LANDSCAPE_BATTLEFIELD_FRAC,
                cardWidth,
                cardHeight,
                bandPad,
            });
            expect(placements).toHaveLength(7);
            // scale 1 = the card renders at exactly the shared footprint. Any
            // value below 1 means the band forced it smaller than the hand's.
            for (const p of placements) expect(p.scale).toBe(1);
        }
    });

    it("leaves the desktop band padding untouched", () => {
        // `bandPad` is an opt-in; omitting it must reproduce the desktop math.
        const opts = {
            bands: [{ count: 4, centerYFrac: 0.5 }],
            width: 900,
            height: 300,
        };
        expect(bandedRowsLayout(opts)).toEqual(
            bandedRowsLayout({ ...opts, bandPad: BAND_V_PAD })
        );
    });
});

describe("published landscape custom properties (#1768)", () => {
    it("publishes the band percentages", () => {
        const v = vars(PHONE_H);
        expect(v[LANDSCAPE_OPP_HAND_BAND_VAR]).toBe("10%");
        expect(v[LANDSCAPE_HAND_BAND_VAR]).toBe("18%");
        expect(v[LANDSCAPE_MIDLINE_VAR]).toBe("46%");
        expect(v[LANDSCAPE_OPP_BF_BOTTOM_VAR]).toBe("54%");
        expect(v[LANDSCAPE_SIDE_GUTTER_VAR]).toBe(LANDSCAPE_SIDE_GUTTER);
    });

    it("publishes the shared card footprint in px", () => {
        const v = vars(PHONE_H);
        const { cardWidth, cardHeight } = landscapeCardMetrics(PHONE_H);
        expect(v[LANDSCAPE_CARD_W_VAR]).toBe(`${cardWidth}px`);
        expect(v[LANDSCAPE_CARD_H_VAR]).toBe(`${cardHeight}px`);
    });

    it("derives the right rail from the strip's MEASURED width, not a literal", () => {
        const v = vars(PHONE_H);
        expect(v[LANDSCAPE_RIGHT_RAIL_VAR]).toContain(
            "var(--controller-strip-w"
        );
        expect(v[LANDSCAPE_RIGHT_RAIL_VAR]).toContain(
            `var(${LANDSCAPE_PILE_TILE_VAR})`
        );
        // The pile tile is a fraction of the shared card, so one scale drives
        // the board AND the rail.
        expect(v[LANDSCAPE_PILE_TILE_VAR]).toContain(
            `var(${LANDSCAPE_CARD_W_VAR})`
        );
    });

    it("pins the composable strip clearance to its class spelling", () => {
        // Same guard `portrait-board-bands.test.ts` puts on the bar clearance:
        // the two spellings of "clear the strip" must not drift.
        expect(BESIDE_CONTROLLER_STRIP).toBe(
            `right-[calc${CONTROLLER_STRIP_CLEARANCE_EXPR.replace(/\s/g, "")}]`
        );
    });

    it("re-points the pile rail's tile width at the compact tile", () => {
        expect(
            (landscapePileVars() as Record<string, string>)["--card-w-sm"]
        ).toBe(`var(${LANDSCAPE_PILE_TILE_VAR})`);
    });
});

describe("pile columns are capped at the midline (#1768)", () => {
    /** `gap-1` between tiles, and the `0.5rem` edge offset + `0.5rem` clearance
     *  the cap subtracts, at the browser default root size. */
    const PILE_GAP = 4;
    const REM = 16;

    /** One pile tile's rendered height: `--card-w-sm` (the compact tile width)
     *  at the shared 5:7 box. */
    const tileHeight = (boardH: number) =>
        (landscapeCardMetrics(boardH).cardWidth * LANDSCAPE_PILE_SCALE * 7) / 5;
    /** An UNCAPPED column of `n` tiles, in px. */
    const columnHeight = (n: number, boardH: number) =>
        n * tileHeight(boardH) + (n - 1) * PILE_GAP;
    /** What the `max-h` cap evaluates to for a seat owning `frac` of the board. */
    const capPx = (frac: number, boardH: number) => frac * boardH - REM;

    it("caps each column at its OWN half of the board", () => {
        // The opponent's column owns everything above the midline; the viewer's
        // owns the complement. Both minus the edge offset + clearance.
        expect(LANDSCAPE_OPPONENT_PILES_ANCHOR).toContain(
            `max-h-[calc(var(${LANDSCAPE_MIDLINE_VAR})-1rem)]`
        );
        expect(LANDSCAPE_VIEWER_PILES_ANCHOR).toContain(
            `max-h-[calc(100%-var(${LANDSCAPE_MIDLINE_VAR})-1rem)]`
        );
    });

    it("scrolls the overflow instead of invading the other seat", () => {
        // Without this the 4th tile simply paints past the cap — the cap alone
        // would clip the tile, not make it reachable.
        expect(LANDSCAPE_OPPONENT_PILES_ANCHOR).toContain("overflow-y-auto");
        expect(LANDSCAPE_VIEWER_PILES_ANCHOR).toContain("overflow-y-auto");
    });

    it("keeps the two columns arithmetically disjoint", () => {
        // The whole point: the caps are the two sides of the midline, so their
        // sum can never exceed the board — whatever the tile count.
        const opp = capPx(LANDSCAPE_MIDLINE_FRAC, PHONE_H);
        const viewer = capPx(1 - LANDSCAPE_MIDLINE_FRAC, PHONE_H);
        expect(opp + viewer).toBeLessThan(PHONE_H);
        for (const h of [SHORT_H, PHONE_H, TALL_H]) {
            expect(
                capPx(LANDSCAPE_MIDLINE_FRAC, h) +
                    capPx(1 - LANDSCAPE_MIDLINE_FRAC, h)
            ).toBeLessThan(h);
        }
    });

    it("is the FOURTH tile that needed the cap", () => {
        // The regression's arithmetic: graveyard + library + exile fit inside a
        // seat's half, but a 4th conditional tile (companion / emblems /
        // monarch / city's blessing) crosses the midline — that overlap is what
        // the cap + scroll replaces.
        const cap = capPx(LANDSCAPE_MIDLINE_FRAC, PHONE_H);
        expect(columnHeight(3, PHONE_H)).toBeLessThan(cap);
        expect(columnHeight(4, PHONE_H)).toBeGreaterThan(cap);
    });
});

describe("flat landscape hand (#1768)", () => {
    const layout = makeLandscapeHandLayout(
        landscapeCardMetrics(PHONE_H).cardWidth
    );

    it("is FLAT — no rotation, no dome lift", () => {
        const placements = layout(7, 600, 70);
        expect(placements).toHaveLength(7);
        for (const p of placements) {
            expect(p.rotation).toBe(0);
            // Every card on one baseline: the desktop fan lifts its edges by a
            // fraction of CARD HEIGHT, which a 70px band has none of to spare.
            expect(p.y).toBe(35);
        }
    });

    it("keeps the row inside the band and in left-to-right order", () => {
        const placements = layout(7, 600, 70);
        const xs = placements.map((p) => p.x);
        expect([...xs].sort((a, b) => a - b)).toEqual(xs);
        const { cardWidth } = landscapeCardMetrics(PHONE_H);
        expect(xs[0] - cardWidth / 2).toBeGreaterThanOrEqual(0);
        expect(xs[xs.length - 1] + cardWidth / 2).toBeLessThanOrEqual(600);
    });

    it("stays one card tall however large the hand gets", () => {
        for (const count of [1, 7, 20]) {
            for (const p of layout(count, 600, 70)) {
                expect(p.rotation).toBe(0);
                expect(p.y).toBe(35);
            }
        }
    });
});
