// CR 105.2 / 202.2 / 613.1e — the ONE derivation of a permanent's CURRENT
// colours, layer 5 included.
//
// A card's printed colour comes from its mana cost (`getColorsFromCost`,
// `./colors`), but layer 5 (CR 613.1e) can change it two ways, and both live on
// the instance rather than the definition:
//
//   * a colour SET — `colorSet`, the layer-5 walk's answer (`gre/layers2to5.ts`)
//     over a static `color-set` (Shifting Sky) and the timestamped
//     `colorOverride` a resolving spell left (Purelace-style lace instants): it
//     REPLACES the printed colours;
//   * `grantedColors` — a colour GRANT (Dralnu's Crusade "All Goblins are
//     black", Sinister Strength): additive, UNIONED on top.
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

// `./registry`, not the `.` barrel: `compiledTriggers.ts` (which `registry.ts`
// itself imports) reads colours through this module, and the barrel would
// evaluate the catalogue before the registry it preloads into exists.
import { getInstanceManaCost, tryGetDefinition } from "./registry";
import { getColorsFromCost, hasDevoid } from "./colors";
import type { Color, PermanentView } from "./types";

/** The instance-side layer-5 fields. Declared structurally rather than
 *  importing `CardInstanceState` (which lives in `gre/`) so this module stays
 *  frontend-safe and free of engine imports. Both the fat server instance and
 *  the slim wire `CardInstance` satisfy it — `slimCard` forwards both fields. */
type ColorLayerFields = {
    colorOverride?: readonly string[];
    grantedColors?: readonly { color: string }[];
    colorSet?: {
        readonly colors: readonly string[];
        readonly sourceId?: string;
    };
};

/** The `colorSet.sourceId` the layer-5 walk (`gre/layers2to5.ts`) writes when
 *  the set it ended on is the instance's own `colorOverride` ledger rather than
 *  a static ability. Lets this module tell a walk answer from a ledger that
 *  changed after it (a copy's colour exception written or removed, a timed row
 *  expiring) without a board. */
export const COLOR_OVERRIDE_SOURCE_ID = "color-override";

/** CR 202.2 / 613.1e — the permanent's effective colours.
 *
 *  Resolution order:
 *    1. `colorSet` — the layer-5 walk's CR 613.7 answer, which has already
 *       ordered every colour set by timestamp (a resolved `colorOverride` is
 *       one of its entries) and kept only the grants applied after it — UNIONED
 *       with `grantedColors`. A set the walk took from the ledger counts only
 *       while the ledger still holds it.
 *    2. otherwise `colorOverride` alone: a colour set the walk has not seen yet
 *       (written since the last `syncLayers2to5` — it is the newest layer-5
 *       effect, CR 613.7), or one on an object the walk never derives. It is
 *       EXACTLY those colours.
 *    3. otherwise the printed cost's colours (embedded `card.manaCost` when
 *       present, else the registry definition) UNIONED with `grantedColors`.
 *       A devoid definition contributes no printed colour (CR 702.114a), and a
 *       grant still paints on top of it (CR 613.3: CDAs apply first in a layer).
 *
 *  A permanent with no cost and no grant (a land) is colourless: an empty
 *  array. Never returns duplicates. */
export function getEffectiveColors(card: PermanentView): Color[] {
    const layers = card as unknown as ColorLayerFields;
    // CR 105.3 / 613.7 — the walk's colour SET (`colorSet`, derived in
    // timestamp order by `gre/layers2to5.ts`) replaces the printed colours;
    // only the grants applied AFTER it are still in `grantedColors`.
    const override = layers.colorOverride;
    const set =
        layers.colorSet?.sourceId === COLOR_OVERRIDE_SOURCE_ID &&
        !(override && sameColors(override, layers.colorSet.colors))
            ? undefined
            : layers.colorSet;
    if (!set && override) return [...override] as Color[];
    const base = set ? ([...set.colors] as Color[]) : printedColors(card);
    const granted = layers.grantedColors;
    if (!granted?.length) return base;
    const all = new Set<Color>(base);
    for (const g of granted) all.add(g.color as Color);
    return [...all];
}

/** CR 202.2 — the colours the instance's mana cost gives it. Single authority
 *  (`cards/registry.ts`): instance `manaCostOverride` (CR 707.2 "except it has
 *  no mana cost" — an Eternalize token, whose cost therefore contributes NO
 *  colour) → embedded fixture cost → registry definition. A devoid definition
 *  contributes none (CR 702.114a). */
function printedColors(card: PermanentView): Color[] {
    const id = (card.card as { id?: string }).id;
    const def = id ? tryGetDefinition(id) : undefined;
    return def && hasDevoid(def)
        ? []
        : getColorsFromCost(getInstanceManaCost(card));
}

/** Same colours, any order — the walk de-duplicates the set it copies. */
function sameColors(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((c) => b.includes(c));
}
