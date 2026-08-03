import { getEffectiveColors } from "@convex/cards/effectiveColors";
import type { PermanentView } from "@convex/cards/types";
import type { CardInstance } from "~/types/game";

export type ColorOverrideDisplay = {
    name: string;
    solid: string;
    inner: string;
};

const SINGLE_COLOR: Record<string, ColorOverrideDisplay> = {
    W: { name: "White", solid: "#f0e6b8", inner: "rgba(240,230,184,0.60)" },
    U: { name: "Blue", solid: "#0a6faa", inner: "rgba(10,111,170,0.55)" },
    B: { name: "Black", solid: "#5c3d6e", inner: "rgba(92,61,110,0.60)" },
    R: { name: "Red", solid: "#c83c2e", inner: "rgba(200,60,46,0.55)" },
    G: { name: "Green", solid: "#1a734a", inner: "rgba(26,115,74,0.55)" },
};

const MULTICOLOR: ColorOverrideDisplay = {
    name: "Multicolor",
    solid: "#c9a84c",
    inner: "rgba(201,168,76,0.55)",
};

export function getColorOverrideDisplay(
    codes: string[]
): ColorOverrideDisplay | null {
    if (!codes || codes.length === 0) return null;
    if (codes.length === 1) return SINGLE_COLOR[codes[0]] ?? null;
    return {
        ...MULTICOLOR,
        name: codes.map((c) => SINGLE_COLOR[c]?.name ?? c).join(" / "),
    };
}

/** CR 613.1d layer 5 — the colour swatch to paint over a permanent whose
 *  CURRENT colour differs from the one its printed art conveys, or `null` when
 *  the permanent still reads as printed (the overwhelmingly common case).
 *
 *  Two layer-5 shapes drive it, and the overlay must honour BOTH: a colour SET
 *  (`colorOverride`, the lace instants) and a colour GRANT (`grantedColors` —
 *  Dralnu's Crusade "All Goblins are black", Sinister Strength). Only the SET
 *  used to paint, so a granted colour was invisible on the board even though
 *  the engine, targeting and the rules all treated the permanent as that
 *  colour. The swatch shows the EFFECTIVE colour set, so a red Goblin turned
 *  black renders as the Red / Black pair, not as black alone. */
export function getEffectiveColorDisplay(
    card: CardInstance
): ColorOverrideDisplay | null {
    const hasLayerFive =
        (card.colorOverride?.length ?? 0) > 0 ||
        (card.grantedColors?.length ?? 0) > 0;
    if (!hasLayerFive) return null;
    return getColorOverrideDisplay(
        getEffectiveColors(card as unknown as PermanentView)
    );
}
