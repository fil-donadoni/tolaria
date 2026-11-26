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
    // CR 105.2 / 202.2 — a guild-hybrid pip `{B/G}` is BOTH a black and a green
    // mana symbol, so a card with `{B/G}` is both black and green (issue #1338,
    // Hogaak). Collect every colour that appears in any hybrid pip.
    const hybridColors = new Set<Color>();
    const pipList = cost.hybrid ?? [];
    for (let i = 0; i < pipList.length; i++) {
        const pip = pipList[i];
        for (let j = 0; j < pip.length; j++) {
            const c = pip[j];
            hybridColors.add(c);
        }
    }
    // CR 105.2 — a monocolour hybrid pip `{2/W}` is a white mana symbol.
    const pipList2 = cost.hybridGeneric ?? [];
    for (let i = 0; i < pipList2.length; i++) {
        const pip = pipList2[i];
        hybridColors.add(pip.color);
    }
    const colors: Color[] = [];
    const cList = MANA_COLORS;
    for (let i = 0; i < cList.length; i++) {
        const c = cList[i];
        if (c === "C") continue;
        // CR 105.2 — a Phyrexian mana symbol `{C/P}` is a coloured mana symbol,
        // so a card with `{U/P}` in its cost is blue even though it can be cast
        // for life (Gitaxian Probe, Phyrexian Metamorph). Count a colour when it
        // appears as a normal pip, a Phyrexian pip, OR a hybrid pip.
        if (
            (cost[c] ?? 0) > 0 ||
            (cost.phyrexian?.[c] ?? 0) > 0 ||
            hybridColors.has(c)
        ) {
            colors.push(c);
        }
    }
    return colors;
}

/** CR 702.114a — devoid: "This object is colorless." A characteristic-defining
 *  ability (CR 604.3), so it holds in every zone and outside the game, and it
 *  overrides the cost's colours without touching the cost: the card still costs
 *  its coloured pips ({@link getColorsFromCost} stays the reader for the mana a
 *  card DEMANDS). Read off the DEFINITION, the copiable values (CR 707.2a), and
 *  not off a live ability list: colour is layer 5, ability removal layer 6, so
 *  an effect that strips abilities leaves the object colourless (CR 613.6). */
export function hasDevoid(
    def: Pick<CardDefinition, "staticAbilities">
): boolean {
    return def.staticAbilities?.includes("devoid") ?? false;
}

/** Coloured pip COUNTS in a mana cost (CR 202.2) — the counting twin of
 *  {@link getColorsFromCost}'s presence-only colours: `{U}{U}` returns
 *  `{ U: 2 }`, `{4}{U}` returns `{ U: 1 }`. Colour Commitment
 *  (`convex/limited/botDrafter.ts`, ADR 0073) needs exactly this
 *  distinction — "`{U}{U}` commits twice as hard as `{4}{U}`" — which plain
 *  presence can't express. A Phyrexian pip (`{U/P}`, CR 105.2) counts toward
 *  its colour the same as a normal pip: it is still a coloured mana symbol
 *  even though it can be paid with life. Omits any colour with zero pips, so
 *  `Object.keys(...)` on the result gives exactly the card's coloured pip
 *  colours — the same set {@link getColorsFromCost} returns, now with counts
 *  attached. */
export function getPipCountsFromCost(
    cost?: ManaCost
): Partial<Record<Color, number>> {
    if (!cost) return {};
    const pips: Partial<Record<Color, number>> = {};
    const cList = MANA_COLORS;
    for (let i = 0; i < cList.length; i++) {
        const c = cList[i];
        if (c === "C") continue;
        // CR 105.2 — a monocolour hybrid pip `{2/W}` counts once toward its
        // colour, like a Phyrexian pip.
        const count =
            (cost[c] ?? 0) +
            (cost.phyrexian?.[c] ?? 0) +
            (cost.hybridGeneric ?? []).filter((p) => p.color === c).length;
        if (count > 0) pips[c] = count;
    }
    return pips;
}

/** CR 105.2 / 202.2 — the card's actual printed COLOUR(s): the colours of its
 *  mana cost plus those its colour indicator denotes (CR 202.2e,
 *  `CardDefinition.colorIndicator` — Living End is black with no mana cost). A
 *  card with neither is COLOURLESS (CR 105.2c) even when it TAPS for coloured
 *  mana — a basic Island is colourless, an artifact with a generic cost is
 *  colourless, a devoid card is colourless whatever it costs ({@link
 *  hasDevoid}). This is the gameplay authority for every "a <colour> card"
 *  cost / filter (Flash of Insight, Force of Will, flashback exile). For the
 *  deck-builder / draft notion — which folds a land's PRODUCED mana in so an
 *  Island groups under blue — use {@link getCardColorIdentity} instead. */
export function getCardColors(def: CardDefinition): Color[] {
    return printedCardColors(def, def.manaCost);
}

/** CR 202.2 / 202.2e — the printed colours of `def` when its mana cost is
 *  `cost` (an instance can carry a cost other than the definition's, CR 707.2:
 *  `getInstanceManaCost`): the cost's colours UNIONED with the colour
 *  indicator's, in WUBRG order. A devoid definition has none (CR 702.114a). */
export function printedCardColors(
    def: Pick<CardDefinition, "staticAbilities" | "colorIndicator">,
    cost: ManaCost | undefined
): Color[] {
    if (hasDevoid(def)) return [];
    const fromCost = getColorsFromCost(cost);
    const indicator = def.colorIndicator;
    if (!indicator?.length) return fromCost;
    return MANA_COLORS.filter(
        (c) => c !== "C" && (fromCost.includes(c) || indicator.includes(c))
    );
}

/** CR 105.2 / 202.2 — true iff the card's actual printed COLOUR (its
 *  {@link getCardColors}) includes `color`. Convenience wrapper: an Island is
 *  never blue here (it is colourless), which is exactly what a gameplay
 *  "exile a blue card" cost needs. NOT colour identity — see
 *  {@link getCardColorIdentity}. */
export function cardHasColor(def: CardDefinition, color: Color): boolean {
    return getCardColors(def).includes(color);
}

const COLORED = MANA_COLORS.filter((c) => c !== "C");

/** Basic land name for each color (CR 305.6 intrinsic mana). */
const BASIC_BY_COLOR: Record<Color, string> = {
    W: "Plains",
    U: "Island",
    B: "Swamp",
    R: "Mountain",
    G: "Forest",
    C: "Plains", // colourless has no basic; callers fall back to Plains
};

/**
 * The ordered list of basic lands to seed for a set of colours, in canonical
 * WUBRG order — a mono-red board → `["Mountain"]`, a UW board →
 * `["Plains", "Island"]`. An empty/colourless set falls back to `["Plains"]`
 * (the historical debug behaviour). Used by the debug scenario builder to seed
 * `landCount`/`libraryCount` lands that actually cast the placed cards.
 */
export function basicLandsForColors(colors: Iterable<Color>): string[] {
    const set = new Set<Color>(colors);
    const cycle = COLORED.filter((c) => set.has(c)).map(
        (c) => BASIC_BY_COLOR[c]
    );
    return cycle.length > 0 ? cycle : ["Plains"];
}

/** Deck-builder / draft colour IDENTITY for a `CardDefinition` — deliberately
 *  NOT the card's CR colour (use {@link getCardColors} / {@link cardHasColor}
 *  for gameplay "a <colour> card" tests). Spells return the colours of their
 *  mana cost; lands (and other cards without a cost) return the colours of mana
 *  their tap-mana abilities can produce — derived from basic-land subtypes plus
 *  any `manaProduced` / `manaChoices` declared on activated abilities. So a
 *  basic Island's identity is blue even though the card itself is colourless.
 *  This is the right notion for grouping / searching a deck or draft pool by
 *  colour. Limitation vs. full CR 903.4 identity: a card WITH a mana cost
 *  short-circuits to its cost colours, so a Talisman of Creativity ({2} with a
 *  "{T}: Add {U} or {R}" ability) reads as colourless here rather than its true
 *  Izzet ({U}{R}) identity — mana symbols in rules text are not scanned.
 *  A devoid card keeps its cost's colours here: CR 903.4 counts the mana symbols
 *  in its cost, whatever colour the card is.
 *  Returned colours are deduped, in canonical WUBRG order. */
export function getCardColorIdentity(def: CardDefinition): Color[] {
    if (def.manaCost) return getColorsFromCost(def.manaCost);

    const set = new Set<Color>();
    const subtypeList = def.subtypes ?? [];
    for (let i = 0; i < subtypeList.length; i++) {
        const subtype = subtypeList[i];
        const c = LAND_SUBTYPE_MANA[subtype];
        if (c) set.add(c);
    }
    const abilityList = def.activatedAbilities ?? [];
    for (let i = 0; i < abilityList.length; i++) {
        const ability = abilityList[i];
        if (ability.manaProduced) {
            for (let j = 0; j < COLORED.length; j++) {
                const c = COLORED[j];
                if ((ability.manaProduced[c] ?? 0) > 0) set.add(c);
            }
        }
        if (ability.manaChoices) {
            const choiceList = ability.manaChoices;
            for (let j = 0; j < choiceList.length; j++) {
                const choice = choiceList[j];
                for (let k = 0; k < COLORED.length; k++) {
                    const c = COLORED[k];
                    if ((choice[c] ?? 0) > 0) set.add(c);
                }
            }
        }
    }

    const out: Color[] = [];
    for (let i = 0; i < COLORED.length; i++) {
        const c = COLORED[i];
        if (set.has(c)) out.push(c);
    }
    return out;
}

const WUBRG_ORDER = ["W", "U", "B", "R", "G"] as const;

/** A deck's colours: the union of its NONLAND cards' colour identities, in
 *  WUBRG order (issue #9994). A land's identity is the mana it taps for, not a
 *  colour the deck is — a Ziatora's Proving Ground (B/R/G) in an R/G deck does
 *  not add B. The ONE answer to "what colours is this deck?", shared by the
 *  client builders (`src/lib/deckColors.ts`) and the Limited standings
 *  (`convex/limitedEvents.ts`). Pure over `{ isLand, colors }` so each caller
 *  resolves its own cards (registry definition or catalogue row). */
export function deckColorsOfNonlands(
    cards: Iterable<{ isLand: boolean; colors: readonly string[] }>
): string[] {
    const set = new Set<string>();
    // eslint-disable-next-line no-restricted-syntax -- an iterable or generator, not an array (issue #10126)
    for (const card of cards) {
        if (card.isLand) continue;
        const cList = card.colors;
        for (let i = 0; i < cList.length; i++) {
            const c = cList[i];
            set.add(c);
        }
    }
    return WUBRG_ORDER.filter((c) => set.has(c));
}
