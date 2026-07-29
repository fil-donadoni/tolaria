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
import { BAND_V_PAD, CARD_HEIGHT, CARD_WIDTH } from "~/lib/board-layout";
import {
    PORTRAIT_HAND_BAND_H,
    PORTRAIT_HAND_BAND_VAR,
    PORTRAIT_HAND_CARD_W_MAX,
    PORTRAIT_MIDLINE_VAR,
    PORTRAIT_NAMEPLATE_BAND_H,
    PORTRAIT_NAMEPLATE_BAND_VAR,
    PORTRAIT_NAMEPLATE_BOTTOM_VAR,
    PORTRAIT_NAMEPLATE_MAX_H,
    PORTRAIT_NAMEPLATE_SAFETY_PX,
    PORTRAIT_OPP_HAND_BAND_H,
    PORTRAIT_OPP_HAND_BAND_VAR,
    PORTRAIT_OPPONENT_BF_BOTTOM_VAR,
    PORTRAIT_VIEWER_BF_BOTTOM_VAR,
    portraitBandVars,
    portraitHandMetrics,
} from "~/lib/portrait-board-bands";

/** The battlefield's OWN scale-from-height math (`bandedRowsLayout`,
 *  `board-layout.ts`): two bands (the creature row + the split lands/other
 *  back row) share the battlefield's height equally, each capped to a
 *  `maxScale` so a full-height card fits its slice, and the card renders at
 *  `CARD_WIDTH * maxScale`. This is the SAME computation
 *  `board-battlefield.tsx`'s `layout()` calls — converting a row height to an
 *  on-screen card width via this function (rather than eyeballing row-height
 *  thresholds) is what makes the 44px touch-target assertions below a REAL
 *  check of tappability, not a proxy. */
function bandedCardWidth(bandHeightPx: number): number {
    const maxScale = Math.max(
        0.1,
        Math.min(1, (bandHeightPx - BAND_V_PAD) / CARD_HEIGHT)
    );
    return CARD_WIDTH * maxScale;
}

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
            new RegExp(`var\\(${PORTRAIT_OPP_HAND_BAND_VAR}\\)`, "g"),
            vars[PORTRAIT_OPP_HAND_BAND_VAR] as string
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
    const oppHandH = resolve(vars[PORTRAIT_OPP_HAND_BAND_VAR] as string, board);
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
        // The opponent's strip is its OWN, smaller band since #1875 —
        // backs only, so the viewer-sized band wasted board height on it.
        opponentHand: { top: 0, bottom: oppHandH },
        opponentBattlefield: {
            top: oppHandH,
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

    // #1814 round-2 review, finding 4: the original version of this check
    // filtered the 667px board out of the ">80px" sweep with a bare
    // `PHONE.filter(...)` and gave the excluded board a loose window — a
    // silent skip. The 667×106 phone then sat a few px under 80 as a
    // documented shortfall; #1875 (the smaller opponent hand band folds
    // ~half the freed space into each battlefield, ~+11.7px per row on this
    // board) lifted it to ~90px, so ALL PHONE combos now clear the target
    // and no board needs a carve-out here at all.
    it.each(PHONE)(
        "leaves the viewer battlefield a usable (>80px) band (h=$height bar=$barHeight)",
        (board) => {
            const b = bandBoxes(board);
            const rowHeight =
                (b.viewerBattlefield.bottom - b.viewerBattlefield.top) / 2;
            expect(rowHeight).toBeGreaterThan(80);
        }
    );

    it("the reserved band is at least the compact nameplate's OWN worst-case box, not merely self-consistent with the battlefield inset (#1814 round-2 review, finding 3)", () => {
        // The bug this closes: the OLD version of this suite defined
        // `viewerNameplate`'s box straight off the SAME `calc()` expression
        // the reservation itself publishes (battlefield bottom = nameplate
        // top, nameplate bottom = hand top), so every assertion about the
        // nameplate box reduced to comparing the reservation against
        // itself — it passed even with a 1px band. Nothing tied the
        // reservation's SIZE to what `PlayerNameplate`'s `compact` variant
        // actually renders. `PORTRAIT_NAMEPLATE_MAX_H` is that independent
        // tie: built from named sub-constants that mirror the component's
        // real classes (border width, `py-0.5` padding, the one content
        // row's `leading-none` line-height) — never derived from
        // `portraitBandVars()` or `bandBoxes()` at all.
        const bandHeightPx = parseFloat(PORTRAIT_NAMEPLATE_BAND_H) * 16;
        expect(bandHeightPx).toBeGreaterThanOrEqual(
            PORTRAIT_NAMEPLATE_MAX_H + PORTRAIT_NAMEPLATE_SAFETY_PX
        );
        // And the reservation isn't padded far beyond that real box either —
        // an oversized reservation would silently re-eat the card-width
        // headroom the compaction (this same review round) exists to win
        // back. Generous but not open-ended: at most a few px of slack.
        expect(bandHeightPx).toBeLessThan(
            PORTRAIT_NAMEPLATE_MAX_H + PORTRAIT_NAMEPLATE_SAFETY_PX + 4
        );
    });
});

describe("battlefield card width stays tappable (#1814 round-2 review — hard constraint)", () => {
    // Finding 1 of the round-2 review: a fixed WORST-CASE reservation sized
    // to the desktop nameplate (5.5rem/88px) shrank the viewer battlefield's
    // rows to ~63px on a 667×106 phone — a 120×168 card scaled down to
    // 35×49px, under the 44px touch-target floor. `bandedCardWidth` (above)
    // runs the SAME row-height → card-width math `board-battlefield.tsx`
    // does, so this is a real tappability check, not a row-height proxy.
    it.each(PHONE)(
        "renders battlefield cards >= 44px wide (h=$height bar=$barHeight)",
        (board) => {
            const b = bandBoxes(board);
            const bfHeight =
                b.viewerBattlefield.bottom - b.viewerBattlefield.top;
            // Two bands (creature row + the split lands/other back row)
            // share the battlefield equally — the same split
            // `board-battlefield.tsx`'s `bandedRowsLayout` call uses.
            const rowHeight = bfHeight / 2;
            expect(bandedCardWidth(rowHeight)).toBeGreaterThanOrEqual(44);
        }
    );
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

    it("publishes each seat's hand band as its own named constant (#1875 — the opponent's is deliberately smaller)", () => {
        // Pre-#1875 the two strips shared one band; the opponent's hand only
        // ever renders backs, so it now gets a smaller band of its own. Both
        // published values must be the module's exported constants (no
        // inline literal drift), and the opponent's must actually be the
        // smaller of the two — equal bands would silently undo the reclaim.
        const vars = portraitBandVars() as Record<string, string>;
        expect(vars[PORTRAIT_HAND_BAND_VAR]).toBe(PORTRAIT_HAND_BAND_H);
        expect(vars[PORTRAIT_OPP_HAND_BAND_VAR]).toBe(PORTRAIT_OPP_HAND_BAND_H);
        expect(parseFloat(PORTRAIT_OPP_HAND_BAND_H)).toBeLessThan(
            parseFloat(PORTRAIT_HAND_BAND_H)
        );
    });

    it("folds the hand-band difference into the midline split, so both battlefields stay equal (#1875)", () => {
        // Same shape as the nameplate-band fold below: the viewer's inset
        // alone carries the full (taller) viewer hand band, so the midline
        // must absorb half the DIFFERENCE between the two hand bands or the
        // viewer battlefield ends up shorter than the opponent's.
        const vars = portraitBandVars() as Record<string, string>;
        const midline = vars[PORTRAIT_MIDLINE_VAR] as string;
        expect(midline).toContain(`var(${PORTRAIT_HAND_BAND_VAR})`);
        expect(midline).toContain(`- var(${PORTRAIT_OPP_HAND_BAND_VAR})`);
        expect(midline).toContain("/ 2");
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

    it("derives the opponent seat's backs from its OWN smaller band (#1875)", () => {
        // Same math, the opponent's fraction: the card can never be taller
        // than the band that hosts it (#1790), which since #1875 is
        // `PORTRAIT_OPP_HAND_BAND_H` for the opponent's strip. On every
        // supported board the derived back is strictly smaller than the
        // viewer's card at the same height.
        for (const h of [844, 667, 600]) {
            const viewer = portraitHandMetrics(h);
            const opp = portraitHandMetrics(h, "opponent");
            const oppBandPx = h * (parseFloat(PORTRAIT_OPP_HAND_BAND_H) / 100);
            expect((opp.cardWidth * 7) / 5).toBeLessThanOrEqual(oppBandPx);
            expect(opp.cardWidth).toBeLessThan(viewer.cardWidth);
            expect(opp.cardWidth).toBeGreaterThan(0);
            expect(opp.overlap).toBe(Math.round(opp.cardWidth * (26 / 76)));
        }
    });

    it("the explicit viewer seat is the default (existing callers keep their sizing)", () => {
        expect(portraitHandMetrics(844, "viewer")).toEqual(
            portraitHandMetrics(844)
        );
    });
});

describe("short-viewport wrap combo (#1770 follow-up from #1790)", () => {
    // The one combo `PHONE` deliberately excludes: a 667px board (the
    // shortest phone this budget targets) combined with the bar's WRAPPED
    // two-line state (150px, e.g. mid DECLARE_ATTACKERS). Tiling still holds
    // — the bands are arithmetically FORCED to, whatever the absolute sizes
    // — but the battlefield row shrinks to ~79px (since #1875; ~67px
    // before), just under the ~80px legibility floor the PHONE combos clear.
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

    it("documents the accepted floor shortfall — battlefield rows still dip below 80px", () => {
        // The reserved nameplate band (`PORTRAIT_NAMEPLATE_BAND_H`) stacks on
        // top of the wrapped-bar shortfall this combo already accepted. The
        // #1875 hand-band reclaim lifted the row from ~67px to ~79px — a
        // hair under the ~80px floor every PHONE combo now clears. A
        // regression that pushed this back toward near-zero (or negative)
        // should still fail here.
        const b = bandBoxes(SHORT_WRAPPED);
        const rowHeight =
            (b.viewerBattlefield.bottom - b.viewerBattlefield.top) / 2;
        expect(rowHeight).toBeGreaterThan(40);
        expect(rowHeight).toBeLessThan(80);
    });

    it("clears the 44px card floor even on this combo since #1875 (previously the one documented ~38px shortfall)", () => {
        // This used to be the ONE combo under the 44px hard touch-target
        // floor (a two-line bar on the shortest supported phone, mid
        // `DECLARE_ATTACKERS`) — documented at ~38px rather than silently
        // filtered. The smaller opponent hand band (#1875) returns ~11.7px
        // to each battlefield row on this board, lifting the card to ~46px:
        // the floor now holds on EVERY supported combo, including this one.
        const b = bandBoxes(SHORT_WRAPPED);
        const bfHeight = b.viewerBattlefield.bottom - b.viewerBattlefield.top;
        const cardWidth = bandedCardWidth(bfHeight / 2);
        expect(cardWidth).toBeGreaterThanOrEqual(44);
    });
});
