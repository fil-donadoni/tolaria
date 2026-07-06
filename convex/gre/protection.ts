// Protection keyword ability primitives (CR 702.16).
//
// Protection is stored on a card as `staticAbilities[]` entries of the form
// `"protection from <color-name>"`, including the colorless variant
// (`"protection from colorless"`, issue #684/#928 — Giver of Runes). Colors
// and colorless are supported; protection from everything, from a player, or
// from a non-color quality (CR 702.16h-k) are not yet implemented.
//
// Callers:
//   - targeting (CR 702.16b): rules.ts::getLegalTargets, game.ts target check
//   - damage    (CR 702.16e): state.ts::dealDamage, phases.ts::applyAllCombatDamage
//   - blocking  (CR 702.16f): combat.ts::validateBlockerEligibility
//
// Aura (702.16c) and Equipment (702.16d) clauses are deferred until the first
// Aura/Equipment card lands — see memory "protection-aura-equip-todo".

import type { CardInstanceState } from "./state";
import type { Color } from "../cards/types";
import { STATIC_EFFECT_CTX } from "./layers";
import { applySubstitution } from "./textChanges";

const PROTECTION_FROM_COLOR_REGEX =
    /^protection from (white|blue|black|red|green|colorless)$/;
const PROTECTION_COLOR_NAME_TO_CODE: Record<string, Color> = {
    white: "W",
    blue: "U",
    black: "B",
    red: "R",
    green: "G",
    colorless: "C",
};

/** Parses "protection from [color]" static-ability strings (CR 702.16a).
 *  Returns the color code for recognized color variants (including `"C"` for
 *  colorless — CR 105.2c: an object/source is colorless when it has no
 *  colors at all), null otherwise. */
export function parseProtectionFromColor(ability: string): Color | null {
    const match = PROTECTION_FROM_COLOR_REGEX.exec(ability);
    return match ? PROTECTION_COLOR_NAME_TO_CODE[match[1]] : null;
}

/** Colors this card has protection from (CR 702.16). Parsed from its
 *  `staticAbilities[]`, read through any active color-word text changes
 *  (CR 612.6 — Sleight of Mind turns "protection from white" into "protection
 *  from blue"). Duplicates collapse (CR 702.16m). */
export function getProtectedColors(
    card: Pick<CardInstanceState, "staticAbilities"> &
        Partial<Pick<CardInstanceState, "subtypes" | "textChanges">>
): Color[] {
    // Fast path: no text changes → parse the raw abilities (zero-copy).
    const abilities = card.textChanges?.length
        ? applySubstitution({
              subtypes: card.subtypes ?? [],
              staticAbilities: card.staticAbilities,
              textChanges: card.textChanges,
          }).staticAbilities
        : card.staticAbilities;
    const result: Color[] = [];
    for (const ability of abilities) {
        const color = parseProtectionFromColor(ability);
        if (color && !result.includes(color)) result.push(color);
    }
    return result;
}

/** True if `target` has protection from any color in `sourceColors`, or from
 *  colorless when `sourceColors` is empty (CR 702.16b/e/f; CR 105.2c — a
 *  source with no colors at all is colorless, so "protection from colorless"
 *  matches an empty `sourceColors`, never a colored one). */
export function isProtectedFromColors(
    target: Pick<CardInstanceState, "staticAbilities"> &
        Partial<Pick<CardInstanceState, "subtypes" | "textChanges">>,
    sourceColors: readonly Color[]
): boolean {
    const protectedFrom = getProtectedColors(target);
    if (protectedFrom.length === 0) return false;
    if (sourceColors.length === 0) return protectedFrom.includes("C");
    return sourceColors.some((c) => protectedFrom.includes(c));
}

/** True if `target` has protection from any color of `source` (CR 702.16).
 *  Source color is derived from its mana cost (CR 202.2) and works uniformly
 *  for battlefield permanents and for stack items (spells, activated
 *  abilities, triggered abilities) — ability stack items are cloned from
 *  their source permanent, so their colors match. */
export function isProtectedFromSource(
    target: CardInstanceState,
    source: CardInstanceState
): boolean {
    return isProtectedFromColors(target, STATIC_EFFECT_CTX.getColors(source));
}
