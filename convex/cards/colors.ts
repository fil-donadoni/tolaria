// Color derivation from mana cost (CR 202.2). Lives outside the GRE so the
// card index, deck builder UI, and layer system can share one implementation.

// Imports from the dependency-free `gre/manaColors.ts` leaf, NOT
// `gre/constants.ts` (issue #927) — `gre/constants.ts` now imports
// `gre/layers.ts` for `getEffectivePower`/`getEffectiveToughness`, and
// `gre/layers.ts` imports THIS module (`getColorsFromCost`, CR 613.1d layer
// 5); importing back from `gre/constants.ts` here would close that cycle.
import { LAND_SUBTYPE_MANA, MANA_COLORS } from "../gre/manaColors";
import type { CardDefinition, Color, ManaCost } from "./types";

/** Returns the colors of a card derived from its mana cost (CR 202.2).
 *  Iterates the canonical color order, skips colorless `C`, and includes any
 *  color whose count is greater than zero. Cards with no mana cost (e.g. lands
 *  without `manaCost`) return an empty array. */
export function getColorsFromCost(cost?: ManaCost): Color[] {
    if (!cost) return [];
    const colors: Color[] = [];
    for (const c of MANA_COLORS) {
        if (c === "C") continue;
        // CR 105.2 — a Phyrexian mana symbol `{C/P}` is a coloured mana symbol,
        // so a card with `{U/P}` in its cost is blue even though it can be cast
        // for life (Gitaxian Probe, Phyrexian Metamorph). Count a colour when it
        // appears as a normal pip OR as a Phyrexian pip.
        if ((cost[c] ?? 0) > 0 || (cost.phyrexian?.[c] ?? 0) > 0) {
            colors.push(c);
        }
    }
    return colors;
}

const COLORED = MANA_COLORS.filter((c) => c !== "C");

/** Deck-builder color identity for a `CardDefinition`. Spells return the
 *  colors of their mana cost; lands (and other cards without a cost) return
 *  the colors of mana their tap-mana abilities can produce — derived from
 *  basic-land subtypes plus any `manaProduced` / `manaChoices` declared on
 *  activated abilities. Returned colors are deduped, in canonical WUBRG order. */
export function getCardColors(def: CardDefinition): Color[] {
    if (def.manaCost) return getColorsFromCost(def.manaCost);

    const set = new Set<Color>();
    for (const subtype of def.subtypes ?? []) {
        const c = LAND_SUBTYPE_MANA[subtype];
        if (c) set.add(c);
    }
    for (const ability of def.activatedAbilities ?? []) {
        if (ability.manaProduced) {
            for (const c of COLORED) {
                if ((ability.manaProduced[c] ?? 0) > 0) set.add(c);
            }
        }
        if (ability.manaChoices) {
            for (const choice of ability.manaChoices) {
                for (const c of COLORED) {
                    if ((choice[c] ?? 0) > 0) set.add(c);
                }
            }
        }
    }

    const out: Color[] = [];
    for (const c of COLORED) if (set.has(c)) out.push(c);
    return out;
}
