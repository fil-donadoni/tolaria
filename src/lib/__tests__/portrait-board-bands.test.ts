// The portrait vertical budget (#1760) must TILE: no band may overlap the one
// below it, and in particular the viewer battlefield must stop at the TOP of
// the hand strip — the regression that hid the lands/noncreatures back row
// under a full hand, making those lands untappable.
//
// jsdom has no layout engine, so the assertions below resolve the published
// `calc()` expressions themselves against a phone-sized board and a range of
// bar heights (the bar's command row wraps, so its height is state-dependent).
// That is a real geometry check, not a string comparison.
import { describe, it, expect } from "vitest";
import {
    ABOVE_CONTROLLER_BAR,
    CONTROLLER_BAR_CLEARANCE_EXPR,
} from "~/lib/controller-bar-metrics";
import {
    PORTRAIT_HAND_BAND_H,
    PORTRAIT_HAND_BAND_VAR,
    PORTRAIT_HAND_CARD_W_MAX,
    PORTRAIT_MIDLINE_VAR,
    PORTRAIT_OPPONENT_BF_BOTTOM_VAR,
    PORTRAIT_VIEWER_BF_BOTTOM_VAR,
    portraitBandVars,
    portraitHandMetrics,
} from "~/lib/portrait-board-bands";

// ── A minimal CSS length evaluator ────────────────────────────────────────────
// Handles exactly the grammar this module emits: calc(), parentheses, + - * /,
// px / rem / % lengths, and the two custom properties involved.

function tokenize(expr: string): string[] {
    return expr.match(/[\d.]+(?:px|rem|%)?|[()+\-*/]/g) ?? [];
}

/** Recursive-descent evaluator over `tokens`, returning px. */
function evaluate(tokens: string[], boardHeight: number): number {
    let i = 0;
    const literal = (t: string): number => {
        if (t.endsWith("rem")) return parseFloat(t) * 16;
        if (t.endsWith("%")) return (parseFloat(t) / 100) * boardHeight;
        return parseFloat(t);
    };
    const factor = (): number => {
        const t = tokens[i++];
        if (t === "(") {
            const v = sum();
            i++; // ")"
            return v;
        }
        if (t === "-") return -factor();
        return literal(t as string);
    };
    const product = (): number => {
        let v = factor();
        while (tokens[i] === "*" || tokens[i] === "/") {
            const op = tokens[i++];
            const rhs = factor();
            v = op === "*" ? v * rhs : v / rhs;
        }
        return v;
    };
    const sum = (): number => {
        let v = product();
        while (tokens[i] === "+" || tokens[i] === "-") {
            const op = tokens[i++];
            const rhs = product();
            v = op === "+" ? v + rhs : v - rhs;
        }
        return v;
    };
    return sum();
}

type Board = { height: number; barHeight: number };

/** Resolve one published band value to px, substituting the custom properties
 *  the same way the browser's cascade would. */
function resolve(value: string, board: Board): number {
    const vars = portraitBandVars() as Record<string, string>;
    const substituted = value
        .replace(/var\(--controller-bar-h,\s*8rem\)/g, `${board.barHeight}px`)
        .replace(
            new RegExp(`var\\(${PORTRAIT_HAND_BAND_VAR}\\)`, "g"),
            vars[PORTRAIT_HAND_BAND_VAR] as string
        )
        .replace(/calc/g, "");
    return evaluate(tokenize(substituted), board.height);
}

/** Every band's top/bottom edge, measured from the TOP of the board (px). */
function bandBoxes(board: Board) {
    const vars = portraitBandVars() as Record<string, string>;
    const handH = resolve(vars[PORTRAIT_HAND_BAND_VAR] as string, board);
    const midline = resolve(vars[PORTRAIT_MIDLINE_VAR] as string, board);
    const oppBfBottom = resolve(
        vars[PORTRAIT_OPPONENT_BF_BOTTOM_VAR] as string,
        board
    );
    const viewerBfBottom = resolve(
        vars[PORTRAIT_VIEWER_BF_BOTTOM_VAR] as string,
        board
    );
    const clearance = resolve(`calc${CONTROLLER_BAR_CLEARANCE_EXPR}`, board);
    return {
        opponentHand: { top: 0, bottom: handH },
        opponentBattlefield: {
            top: handH,
            bottom: board.height - oppBfBottom,
        },
        viewerBattlefield: {
            top: midline,
            bottom: board.height - viewerBfBottom,
        },
        viewerHand: {
            top: board.height - clearance - handH,
            bottom: board.height - clearance,
        },
        bar: { top: board.height - clearance, bottom: board.height },
    };
}

// A 390×844 phone: `main` is the viewport, the bar measures ~106px on one line
// and ~150px once its command row wraps (DECLARE_ATTACKERS).
const PHONE: Board[] = [
    { height: 844, barHeight: 106 },
    { height: 844, barHeight: 150 },
    { height: 667, barHeight: 106 },
];

describe("portrait band budget tiles without overlap (#1760)", () => {
    it.each(PHONE)(
        "viewer battlefield stops at the top of the hand strip (h=$height bar=$barHeight)",
        (board) => {
            const b = bandBoxes(board);
            // THE regression: the battlefield used to end ~140px below this.
            expect(b.viewerBattlefield.bottom).toBeCloseTo(b.viewerHand.top, 5);
            expect(b.viewerBattlefield.bottom).toBeLessThanOrEqual(
                b.viewerHand.top
            );
        }
    );

    it.each(PHONE)(
        "no band overlaps its neighbour, top to bottom (h=$height bar=$barHeight)",
        (board) => {
            const b = bandBoxes(board);
            const order = [
                b.opponentHand,
                b.opponentBattlefield,
                b.viewerBattlefield,
                b.viewerHand,
                b.bar,
            ];
            for (let i = 0; i + 1 < order.length; i++) {
                expect(order[i]!.bottom).toBeLessThanOrEqual(
                    order[i + 1]!.top + 1e-6
                );
                expect(order[i]!.bottom).toBeGreaterThan(order[i]!.top);
            }
            expect(order.at(-1)!.bottom).toBeCloseTo(board.height, 5);
        }
    );

    it.each(PHONE)(
        "both battlefields get the same height (h=$height bar=$barHeight)",
        (board) => {
            const b = bandBoxes(board);
            const opp =
                b.opponentBattlefield.bottom - b.opponentBattlefield.top;
            const viewer = b.viewerBattlefield.bottom - b.viewerBattlefield.top;
            expect(viewer).toBeCloseTo(opp, 5);
            expect(viewer).toBeGreaterThan(0);
        }
    );

    it("keeps the whole viewer battlefield clear of the hand for a 7-card hand", () => {
        // The hand strip is a fixed band: past the scroll threshold the portrait
        // hand scrolls horizontally instead of getting taller, so a 7-card hand
        // occupies exactly the band the battlefield already reserves. The back
        // row (lands + other noncreatures) is centred at 0.74 of the
        // battlefield band — the deepest point any permanent reaches.
        const BACK_ROW_CENTER_Y_FRAC = 0.74;
        for (const board of PHONE) {
            const b = bandBoxes(board);
            const height = b.viewerBattlefield.bottom - b.viewerBattlefield.top;
            const backRowCenter =
                b.viewerBattlefield.top + BACK_ROW_CENTER_Y_FRAC * height;
            expect(backRowCenter).toBeLessThan(b.viewerHand.top);
            // and its row slice (half the band) also clears the hand
            expect(b.viewerBattlefield.top + height).toBeLessThanOrEqual(
                b.viewerHand.top
            );
        }
    });

    it("leaves the viewer battlefield a usable band on a phone", () => {
        // Two rows share the band; a row thinner than ~80px renders cards too
        // small to identify, which would fail the ticket a different way.
        for (const board of PHONE) {
            const b = bandBoxes(board);
            const rowHeight =
                (b.viewerBattlefield.bottom - b.viewerBattlefield.top) / 2;
            expect(rowHeight).toBeGreaterThan(80);
        }
    });
});

describe("band budget is derived, not hand-tuned", () => {
    it("reserves the hand band and the measured bar in the battlefield inset", () => {
        const vars = portraitBandVars() as Record<string, string>;
        const inset = vars[PORTRAIT_VIEWER_BF_BOTTOM_VAR] as string;
        // Both inputs must appear — a literal px reservation is the bug.
        expect(inset).toContain("var(--controller-bar-h");
        expect(inset).toContain(`var(${PORTRAIT_HAND_BAND_VAR})`);
        expect(inset).not.toMatch(/\d+px/);
    });

    it("uses one hand band height for both seats", () => {
        const vars = portraitBandVars() as Record<string, string>;
        expect(vars[PORTRAIT_HAND_BAND_VAR]).toBe(PORTRAIT_HAND_BAND_H);
    });

    it("pins the composable clearance to the class spelling (#1759 seam)", () => {
        expect(ABOVE_CONTROLLER_BAR).toBe(
            `bottom-[calc${CONTROLLER_BAR_CLEARANCE_EXPR.replace(/\s+/g, "")}]`
        );
    });
});

describe("portrait hand card metrics (#1770 follow-up from #1790)", () => {
    it("stays at the historical max on a tall-enough board", () => {
        // 844 / 667 (the two boards this budget targets that clear the
        // overflow threshold below) both leave the fixed card unclamped.
        expect(portraitHandMetrics(844).cardWidth).toBe(
            PORTRAIT_HAND_CARD_W_MAX
        );
        expect(portraitHandMetrics(667).cardWidth).toBe(
            PORTRAIT_HAND_CARD_W_MAX
        );
    });

    it("clamps below the 665px threshold — 106.4/0.16 — where the fixed card overflowed the band", () => {
        // The regression: a 76px-wide (106.4px-tall) card on a 16% band
        // shorter than 106.4px overflows the band's TOP edge. 665px is exact:
        // 0.16 * 665 = 106.4.
        const { cardWidth } = portraitHandMetrics(600);
        expect(cardWidth).toBeLessThan(PORTRAIT_HAND_CARD_W_MAX);
        // The derived card's height never exceeds the ACTUAL band height.
        const bandHeightPx = 600 * 0.16;
        expect((cardWidth * 7) / 5).toBeLessThanOrEqual(bandHeightPx);
    });

    it("scales the overlap with the derived width, keeping the historical ratio", () => {
        const { cardWidth, overlap } = portraitHandMetrics(500);
        expect(cardWidth).toBeLessThan(PORTRAIT_HAND_CARD_W_MAX);
        expect(overlap).toBe(Math.round(cardWidth * (26 / 76)));
    });

    it("never produces a degenerate (zero or negative) card on a very short board", () => {
        const { cardWidth, overlap } = portraitHandMetrics(50);
        expect(cardWidth).toBeGreaterThan(0);
        expect(overlap).toBeGreaterThanOrEqual(0);
        expect(overlap).toBeLessThan(cardWidth);
    });
});

describe("short-viewport wrap combo (#1770 follow-up from #1790)", () => {
    // The one combo `PHONE` deliberately excludes: a 667px board (the
    // shortest phone this budget targets) combined with the bar's WRAPPED
    // two-line state (150px, e.g. mid DECLARE_ATTACKERS). Tiling still holds
    // — the bands are arithmetically FORCED to, whatever the absolute sizes
    // — but the battlefield row shrinks to ~74px, under the ~80px legibility
    // floor the other three PHONE combos clear.
    //
    // Properly restoring the floor here means shrinking the hand band below
    // its flat `PORTRAIT_HAND_BAND_H` fraction for this one state, which in
    // turn requires the hand CARD (`portraitHandMetrics`, boardHeight-only by
    // design) to also know the bar's MEASURED height — a value this codebase
    // deliberately keeps CSS-only (`--controller-bar-h`, see
    // controller-bar-metrics.ts) so the hand strip never re-renders on every
    // bar-height tick. Threading it into JS would cross that boundary for one
    // rare, transient state (a two-line bar on the shortest supported phone).
    // Accepted and documented here rather than widening this sweep into that
    // coupling — same "accept + document" disposition the #1802 review used
    // for the landscape 320px card-footprint hit-target note.
    const SHORT_WRAPPED: Board = { height: 667, barHeight: 150 };

    it("still tiles without overlap", () => {
        const b = bandBoxes(SHORT_WRAPPED);
        const order = [
            b.opponentHand,
            b.opponentBattlefield,
            b.viewerBattlefield,
            b.viewerHand,
            b.bar,
        ];
        for (let i = 0; i + 1 < order.length; i++) {
            expect(order[i]!.bottom).toBeLessThanOrEqual(
                order[i + 1]!.top + 1e-6
            );
            expect(order[i]!.bottom).toBeGreaterThan(order[i]!.top);
        }
        expect(order.at(-1)!.bottom).toBeCloseTo(SHORT_WRAPPED.height, 5);
    });

    it("documents the accepted floor shortfall — battlefield rows dip below 80px", () => {
        const b = bandBoxes(SHORT_WRAPPED);
        const rowHeight =
            (b.viewerBattlefield.bottom - b.viewerBattlefield.top) / 2;
        // Still a usable, non-degenerate row — just below the ~80px floor
        // the other three PHONE combos comfortably clear. A regression that
        // pushed this lower (or to <=0) should still fail here.
        expect(rowHeight).toBeGreaterThan(60);
        expect(rowHeight).toBeLessThan(80);
    });
});
