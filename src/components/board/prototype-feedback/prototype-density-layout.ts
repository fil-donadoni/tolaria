// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-density=A|B|C`).
// "Board cards are too small, but a full board must stay playable."
//
// Every variant goes through the REAL `rowLayout` / `splitRowLayout`: a variant
// only raises the base card size (the `cap`) and re-cuts the zone's height
// between the two rows. The production shrink ladder (step floor → card shrink
// → legibility floor) then runs unchanged from that bigger base, so a full
// board degrades exactly as it does today.
import {
    BAND_V_PAD,
    CARD_HEIGHT,
    CARD_WIDTH,
    rowLayout,
    splitRowLayout,
    type Placement,
} from "~/lib/board-layout";

export type PrototypeDensityVariant = "A" | "B" | "C";

export function isPrototypeDensityVariant(
    v: string | null
): v is PrototypeDensityVariant {
    return v === "A" || v === "B" || v === "C";
}

/** Focus band (C): the creature row's share of the zone height. */
export const PROTOTYPE_FOCUS_SHARE_COLLAPSED = 0.74;
export const PROTOTYPE_FOCUS_SHARE_EXPANDED = 0.42;

export type PrototypeDensityInput = {
    variant: PrototypeDensityVariant;
    width: number;
    height: number;
    cardWidth?: number;
    cardHeight?: number;
    bandPad?: number;
    rightGutter: number;
    creatureWidths: number[];
    landWidths: number[];
    otherWidths: number[];
    /** C only: the pointer is over the back strip. */
    backExpanded: boolean;
};

type BandPlan = {
    /** Creature row's fraction of the zone height (viewer orientation: top). */
    creatureShare: number;
    /** Max card scale per row, relative to the zone's base footprint. */
    creatureCap: number;
    backCap: number;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Largest scale (≤ cap) at which a row still fits with its full resting gap. */
function comfortableScale(widths: number[], usable: number, cap: number) {
    if (widths.length === 0) return 0;
    const gaps = 12 * (widths.length - 1);
    return Math.max(0.5, Math.min(cap, (usable - gaps) / sum(widths)));
}

/** A — grow-to-fill: each row asks for the size it could comfortably show
 *  (up to 1.5×) and the height is split in proportion to what was asked. */
function planGrowToFill(
    i: PrototypeDensityInput,
    usable: number,
    cardH: number,
    pad: number
): BandPlan {
    const cap = 1.5;
    const c = comfortableScale(i.creatureWidths, usable, cap);
    const b = comfortableScale(
        [...i.landWidths, ...i.otherWidths],
        usable,
        cap
    );
    const want = (s: number) => (s > 0 ? s * cardH + pad : 0);
    const wc = want(c);
    const wb = want(b);
    // An empty row keeps a sliver so the other row does not swallow the zone
    // and jump when the first card of the empty row arrives.
    const raw = wc + wb > 0 ? wc / (wc + wb) : 0.5;
    const creatureShare =
        wc === 0 ? 0.2 : wb === 0 ? 0.8 : Math.min(0.68, Math.max(0.32, raw));
    return { creatureShare, creatureCap: cap, backCap: cap };
}

/** B — density tiers: three discrete sizes picked by how many footprints the
 *  side holds; the land row always sits one step below the creature row. */
function planTiers(i: PrototypeDensityInput): BandPlan {
    const total =
        i.creatureWidths.length + i.landWidths.length + i.otherWidths.length;
    const creatureCap = total <= 5 ? 1.45 : total <= 10 ? 1.1 : 0.85;
    const backCap = creatureCap * 0.7;
    return {
        creatureShare: creatureCap / (creatureCap + backCap),
        creatureCap,
        backCap,
    };
}

/** C — focus band: creatures own the zone; the back row is a slim strip that
 *  trades places with them while the pointer is over it. */
function planFocus(i: PrototypeDensityInput): BandPlan {
    return i.backExpanded
        ? {
              creatureShare: PROTOTYPE_FOCUS_SHARE_EXPANDED,
              creatureCap: 1,
              backCap: 1.3,
          }
        : {
              creatureShare: PROTOTYPE_FOCUS_SHARE_COLLAPSED,
              creatureCap: 1.7,
              backCap: 0.6,
          };
}

export function prototypeDensityLayout(i: PrototypeDensityInput): Placement[] {
    const cardW = i.cardWidth ?? CARD_WIDTH;
    const cardH = i.cardHeight ?? CARD_HEIGHT;
    const pad = i.bandPad ?? BAND_V_PAD;
    if (i.height <= 0) return [];
    const usable = Math.max(cardW, i.width - i.rightGutter);
    const plan =
        i.variant === "A"
            ? planGrowToFill(i, usable, cardH, pad)
            : i.variant === "B"
              ? planTiers(i)
              : planFocus(i);

    const creatureH = i.height * plan.creatureShare;
    const backH = i.height - creatureH;
    // A row never exceeds its height slice — same rule as `bandedRowsLayout`,
    // minus its hard `≤ 1` ceiling.
    const heightCap = (sliceH: number, cap: number) =>
        Math.max(0.1, Math.min(cap, (sliceH - pad) / cardH));

    // Lay the row out as if the base card were `cap` times bigger, then fold
    // `cap` back into the returned scale: the slot keeps its real base box.
    const grown = (cap: number, sliceH: number, widths: number[]) => ({
        cardWidth: cardW * cap,
        maxScale: heightCap(sliceH, cap) / cap,
        widths: widths.map((w) => w * cap),
    });
    const fold = (ps: Placement[], cap: number) =>
        ps.map((p) => ({ ...p, scale: p.scale * cap }));

    const c = grown(plan.creatureCap, creatureH, i.creatureWidths);
    const creatures = fold(
        rowLayout({
            count: i.creatureWidths.length,
            width: usable,
            centerY: creatureH / 2,
            cardWidth: c.cardWidth,
            maxScale: c.maxScale,
            widths: c.widths,
        }),
        plan.creatureCap
    );
    const bl = grown(plan.backCap, backH, i.landWidths);
    const br = grown(plan.backCap, backH, i.otherWidths);
    const back = fold(
        splitRowLayout({
            left: i.landWidths.length,
            right: i.otherWidths.length,
            width: usable,
            centerY: creatureH + backH / 2,
            cardWidth: bl.cardWidth,
            maxScale: bl.maxScale,
            leftWidths: bl.widths,
            rightWidths: br.widths,
        }),
        plan.backCap
    );
    return [...creatures, ...back];
}
