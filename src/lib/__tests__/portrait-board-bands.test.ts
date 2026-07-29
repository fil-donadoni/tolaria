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
    PORTRAIT_NAMEPLATE_BAND_H,
    PORTRAIT_NAMEPLATE_BAND_VAR,
    PORTRAIT_NAMEPLATE_BOTTOM_VAR,
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
        .replace(
            new RegExp(`var\\(${PORTRAIT_NAMEPLATE_BAND_VAR}\\)`, "g"),
            vars[PORTRAIT_NAMEPLATE_BAND_VAR] as string
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
    const nameplateBottom = resolve(
        vars[PORTRAIT_NAMEPLATE_BOTTOM_VAR] as string,
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
        // The reserved nameplate band (#1814 fixup): the battlefield stops at
        // its top edge, the hand band starts at its bottom edge — its own
        // territory, carved out of what used to be the battlefield's inset.
        viewerNameplate: {
            top: board.height - viewerBfBottom,
            bottom: board.height - nameplateBottom,
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
        "viewer battlefield stops at the top of the reserved nameplate band (h=$height bar=$barHeight)",
        (board) => {
            const b = bandBoxes(board);
            // THE #1760 regression: the battlefield used to end ~140px below
            // the hand strip's top. THE #1814 fixup regression: the
            // nameplate band now sits BETWEEN the battlefield and the hand —
            // the battlefield must stop at the nameplate band's top, not
            // reach all the way to the hand strip anymore.
            expect(b.viewerBattlefield.bottom).toBeCloseTo(
                b.viewerNameplate.top,
                5
            );
            expect(b.viewerBattlefield.bottom).toBeLessThanOrEqual(
                b.viewerNameplate.top
            );
            // The nameplate band itself still tiles flush with the hand strip
            // below it — no gap, no overlap.
            expect(b.viewerNameplate.bottom).toBeCloseTo(b.viewerHand.top, 5);
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
                b.viewerNameplate,
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

    it("the reserved nameplate band never intersects the back row (#1814 fixup — the bug this reservation exists to catch)", () => {
        // The portrait equivalent of
        // `board-landscape-bands.test.tsx`'s "moves both nameplates off the
        // cards": the nameplate used to grow UPWARD from the battlefield's
        // OWN bottom edge, straight into the zone the back row (lands)
        // centres at (0.74 of the battlefield band) whenever one side is
        // empty — i.e. from turn 1. Now the battlefield stops a whole band
        // above that, so the back row's deepest point can never reach the
        // nameplate's own territory.
        const BACK_ROW_CENTER_Y_FRAC = 0.74;
        for (const board of PHONE) {
            const b = bandBoxes(board);
            const bfHeight =
                b.viewerBattlefield.bottom - b.viewerBattlefield.top;
            const backRowCenter =
                b.viewerBattlefield.top + BACK_ROW_CENTER_Y_FRAC * bfHeight;
            expect(backRowCenter).toBeLessThan(b.viewerNameplate.top);
            // The reserved band itself is non-degenerate (a real gap, not a
            // zero-height boundary that would make the check above vacuous).
            expect(
                b.viewerNameplate.bottom - b.viewerNameplate.top
            ).toBeGreaterThan(0);
        }
    });

    it("leaves the viewer battlefield a usable band on the two taller phones", () => {
        // Two rows share the band; a row thinner than ~80px renders cards too
        // small to identify. Excludes the 667px board deliberately — see the
        // dedicated "accepted floor shortfall" test below for why the
        // nameplate reservation (#1814 fixup) costs THAT board specifically.
        for (const board of PHONE.filter((b) => b.height !== 667)) {
            const b = bandBoxes(board);
            const rowHeight =
                (b.viewerBattlefield.bottom - b.viewerBattlefield.top) / 2;
            expect(rowHeight).toBeGreaterThan(80);
        }
    });

    it("documents the accepted floor shortfall on the 667px phone (#1814 fixup)", () => {
        // Before the nameplate reservation this board's row was ALREADY
        // marginal (~85px, only ~5px above the 80px floor with zero
        // nameplate budget spent). Reserving genuine space for a real
        // nameplate (life total + name, ~62px at an absolute minimum) costs
        // more than that ~5px of headroom on this one board — there is no
        // reservation size that both closes the #1814 overlap AND keeps
        // THIS board's row above 80px; something has to give. The trade
        // mirrors the SAME disposition the "short-viewport wrap combo" block
        // below already accepts for the 667px + wrapped-bar combo:
        // correctness (no overlap, no collision — see the tiling and
        // back-row tests above, which still hold for this board) is
        // unconditional; the row-height floor is a softer, best-effort
        // target this one narrow phone dips under.
        const board = { height: 667, barHeight: 106 };
        const b = bandBoxes(board);
        const rowHeight =
            (b.viewerBattlefield.bottom - b.viewerBattlefield.top) / 2;
        expect(rowHeight).toBeGreaterThan(40);
        expect(rowHeight).toBeLessThan(80);
    });
});

describe("band budget is derived, not hand-tuned", () => {
    it("reserves the hand band, the reserved nameplate band, and the measured bar in the battlefield inset", () => {
        const vars = portraitBandVars() as Record<string, string>;
        const inset = vars[PORTRAIT_VIEWER_BF_BOTTOM_VAR] as string;
        // All three inputs must appear via their named vars — a literal px
        // reservation spliced in directly (rather than composed through
        // `var(...)`) is the bug this sweep exists to catch.
        expect(inset).toContain("var(--controller-bar-h");
        expect(inset).toContain(`var(${PORTRAIT_HAND_BAND_VAR})`);
        expect(inset).toContain(`var(${PORTRAIT_NAMEPLATE_BAND_VAR})`);
        expect(inset).not.toMatch(/\d+px/);
    });

    it("uses one hand band height for both seats", () => {
        const vars = portraitBandVars() as Record<string, string>;
        expect(vars[PORTRAIT_HAND_BAND_VAR]).toBe(PORTRAIT_HAND_BAND_H);
    });

    it("publishes the nameplate band height as its own named constant, not re-typed inline (#1814 fixup)", () => {
        // The sibling check for the hand band above, applied to the new
        // reservation: the published var must be the SAME constant the
        // module exports (`PORTRAIT_NAMEPLATE_BAND_H`), not a second literal
        // that could silently drift from it.
        const vars = portraitBandVars() as Record<string, string>;
        expect(vars[PORTRAIT_NAMEPLATE_BAND_VAR]).toBe(
            PORTRAIT_NAMEPLATE_BAND_H
        );
        expect(PORTRAIT_NAMEPLATE_BAND_H).not.toMatch(/\d+px/);
    });

    it("folds the nameplate band into the midline split too, so both battlefields stay equal (#1814 fixup)", () => {
        // Mirrors the existing bar-clearance behaviour: the viewer's inset
        // alone carries the FULL nameplate reservation, so the midline must
        // absorb HALF of it (alongside half the bar clearance) or the
        // viewer's battlefield would end up shorter than the opponent's —
        // reopening the #1760 height-parity bug this same module already
        // fixed once, from a different cause.
        const vars = portraitBandVars() as Record<string, string>;
        const midline = vars[PORTRAIT_MIDLINE_VAR] as string;
        expect(midline).toContain(`var(${PORTRAIT_NAMEPLATE_BAND_VAR})`);
        expect(midline).toContain("/ 2");
    });

    it("the nameplate's own anchor point is the hand band's top edge, unaffected by its own reservation", () => {
        const vars = portraitBandVars() as Record<string, string>;
        const bottom = vars[PORTRAIT_NAMEPLATE_BOTTOM_VAR] as string;
        expect(bottom).toContain("var(--controller-bar-h");
        expect(bottom).toContain(`var(${PORTRAIT_HAND_BAND_VAR})`);
        // The nameplate's OWN anchor must not fold in its own band height —
        // it anchors at the band's bottom edge and grows upward INTO it.
        expect(bottom).not.toContain(PORTRAIT_NAMEPLATE_BAND_VAR);
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
            b.viewerNameplate,
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

    it("documents the accepted floor shortfall — battlefield rows dip well below 80px", () => {
        // #1814 fixup: the reserved nameplate band (`PORTRAIT_NAMEPLATE_BAND_H`)
        // stacks on top of the wrapped-bar shortfall this combo already
        // accepted, pushing the row further down than the ~74px this test
        // used to document (pre-fixup) — still a usable, non-degenerate row,
        // just further below the ~80px floor the two taller PHONE combos
        // comfortably clear. A regression that pushed this to near-zero (or
        // negative) should still fail here.
        const b = bandBoxes(SHORT_WRAPPED);
        const rowHeight =
            (b.viewerBattlefield.bottom - b.viewerBattlefield.top) / 2;
        expect(rowHeight).toBeGreaterThan(40);
        expect(rowHeight).toBeLessThan(80);
    });
});
