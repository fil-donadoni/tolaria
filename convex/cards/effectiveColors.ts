// CR 105.2 / 202.2 / 613.1d — the ONE derivation of a permanent's CURRENT
// colours, layer 5 included.
//
// A card's printed colour comes from its mana cost (`getColorsFromCost`,
// `./colors`), but layer 5 (CR 613.1d) can change it two ways, and both live on
// the instance rather than the definition:
//
//   * `colorOverride` — a colour SET (Purelace-style lace instants, Painter's
//     Servant): it REPLACES every other colour derivation.
//   * `grantedColors` — a colour GRANT (Dralnu's Crusade "All Goblins are
//     black", Sinister Strength): additive, UNIONED with the printed colours.
//
// Lives under `convex/cards/` (NOT `convex/gre/`) so the React client can call
// it directly — it is a leaf over `./colors` + the card registry, importing
// nothing from `gre/`.
//
// It exists because the derivation had been hand-copied FOUR times — the
// engine's layer context (`gre/layers.ts`), `ATTACK_RESTRICTION_CTX`
// (`./attackRestrictions.ts`), `CAST_RESTRICTION_CTX` (`./castRestrictions.ts`)
// and three inline client copies (`src/lib/card-utils.ts`,
// `src/lib/ai/bot-view.ts`) — and only the engine's copy folded in
// `grantedColors`. Every other consumer read a Goblin under Dralnu's Crusade as
// red-only: colour-filtered targeting highlighted the wrong permanents on the
// board, and the client-side Brain evaluated the wrong colours. Single
// authority, so the copies cannot drift again.

import { tryGetDefinition } from ".";
import { getColorsFromCost } from "./colors";
import type { Color, ManaCost, PermanentView } from "./types";

/** The instance-side layer-5 fields. Declared structurally rather than
 *  importing `CardInstanceState` (which lives in `gre/`) so this module stays
 *  frontend-safe and free of engine imports. Both the fat server instance and
 *  the slim wire `CardInstance` satisfy it — `slimCard` forwards both fields. */
type ColorLayerFields = {
    colorOverride?: readonly string[];
    grantedColors?: readonly { color: string }[];
};

/** CR 202.2 / 613.1d — the permanent's effective colours.
 *
 *  Resolution order:
 *    1. `colorOverride` (layer-5 colour SET) wins outright — it replaces every
 *       other derivation, so a laced permanent is EXACTLY those colours.
 *    2. otherwise, the printed cost's colours (embedded `card.manaCost` when
 *       present, else the registry definition) UNIONED with `grantedColors`.
 *
 *  A permanent with no cost and no grant (a land) is colourless: an empty
 *  array. Never returns duplicates. */
export function getEffectiveColors(card: PermanentView): Color[] {
    const layers = card as unknown as ColorLayerFields;
    const override = layers.colorOverride;
    if (override) return [...override] as Color[];
    const embedded = (card.card as { manaCost?: ManaCost }).manaCost;
    const cardId = (card.card as { id?: string }).id;
    const cost =
        embedded ?? (cardId ? tryGetDefinition(cardId)?.manaCost : undefined);
    const base = getColorsFromCost(cost);
    const granted = layers.grantedColors;
    if (!granted?.length) return base;
    const all = new Set<Color>(base);
    for (const g of granted) all.add(g.color as Color);
    return [...all];
}
