import type { DeckCard } from "~/types/game";
import { tryGetDefinition } from "@convex/cards";
import { getPipCountsFromCost } from "@convex/cards/colors";
import type { CardDefinition, Color, ManaCost } from "@convex/cards/types";
import {
    getDefinitionProducibleColors,
    isLandDefinition,
    manaValue,
} from "@convex/gre/constants";

/** Resolves a `DeckCard` to its `CardDefinition`, or `null` when the registry
 *  doesn't know it. Same seam shape as `computeDeckColors`'s `resolve` param
 *  (`deckColors.ts`) — registry-only by default, swappable in tests. Unlike
 *  colour identity, pip counts / producible colours / type-subtype maps have
 *  no catalogue-row equivalent (a `FullCatalogueRow` carries no
 *  `activatedAbilities`/`subtypes` mana data), so — unlike `deckColors.ts` —
 *  there is no Tabletop (catalogue-backed) fallback here; an unresolvable
 *  card contributes nothing rather than throwing. */
export type DeckCardDefinitionResolver = (
    cardId: string
) => CardDefinition | null;

/** Curve buckets: index 0..6 = mana value 0..6 exactly, index 7 ("7+")
 *  collects everything at or above 7 (CR 202.3 printed mana value). */
export const CURVE_BUCKET_COUNT = 8;

/** Display labels for `DeckStats.curve`, one per index. */
export const CURVE_LABELS: readonly string[] = [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7+",
];

/** Colour source counts (CR 106.4 "could produce"), split by permanent shape
 *  so the Stats dialog can stack lands separately from rocks/dorks. Keyed by
 *  `Color`, omitting `"C"` — colourless is not a colour (CR 202.2). */
export interface ManaSourceCounts {
    lands: Partial<Record<Color, number>>;
    nonlands: Partial<Record<Color, number>>;
}

/** Every Maindeck statistic the Stats dialog shows (PRD #1617). Pure — no
 *  React, no Convex context, no I/O; `computeDeckStats` is the only entry
 *  point. */
export interface DeckStats {
    /** Mana curve of non-land Maindeck cards, `{X}` counted at its printed
     *  mana value (CR 202.3b — an unpaid variable `{X}` is 0). Length
     *  {@link CURVE_BUCKET_COUNT}, indices labelled by {@link CURVE_LABELS}. */
    curve: number[];
    /** Coloured pip counts across every Maindeck card's mana cost (CR 202.2).
     *  A guild-hybrid pip (`{W/U}`) contributes 1 to EACH of its colours — it
     *  is payable either way, so halving it would understate both
     *  requirements. A monocolour-hybrid (`{2/W}`) or Phyrexian (`{W/P}`) pip
     *  is still a coloured pip and counts once toward its one colour.
     *  Generic mana and `{X}` contribute nothing; activation costs are not
     *  read (only the card's own casting cost). */
    pips: Partial<Record<Color, number>>;
    /** Colour source counts — every card that COULD produce a colour (CR
     *  106.4), lands and non-lands (rocks, dorks) alike, split so the dialog
     *  can show them stacked. A dual land / dual-producing rock counts on
     *  both of its colours. */
    sources: ManaSourceCounts;
    /** Card type counts (CR 300). A card with several types (an Artifact
     *  Creature) is counted once in EACH of its types, so the sum can exceed
     *  the card count. */
    types: Record<string, number>;
    /** Subtype counts (CR 300), including land subtypes (Mountain, Swamp,
     *  …) alongside creature types. */
    subtypes: Record<string, number>;
}

function emptyStats(): DeckStats {
    return {
        curve: new Array<number>(CURVE_BUCKET_COUNT).fill(0),
        pips: {},
        sources: { lands: {}, nonlands: {} },
        types: {},
        subtypes: {},
    };
}

function curveBucket(mv: number): number {
    return Math.min(Math.max(mv, 0), CURVE_BUCKET_COUNT - 1);
}

function bump(map: Record<string, number>, key: string): void {
    map[key] = (map[key] ?? 0) + 1;
}

/** Coloured pip counts for ONE mana cost (CR 202.2), the counting twin of
 *  {@link getDefinitionProducibleColors}'s presence-only reads elsewhere.
 *  Starts from `getPipCountsFromCost` (normal pips + Phyrexian, already
 *  excluding `{C}` and generic/`{X}`) and adds guild-hybrid pips on top —
 *  `getPipCountsFromCost` deliberately does not fold `cost.hybrid` in (it
 *  serves Colour Commitment, `convex/limited/botDrafter.ts`, where a hybrid
 *  pip is weighted differently), but a deck's colour-pip CURVE needs the
 *  full CR 202.2 read: a hybrid pip `{W/U}` is BOTH a white and a blue mana
 *  symbol, so it contributes 1 to each (not 0.5 to each, not 1 to a single
 *  "first" colour — halving or picking one would understate the other
 *  colour's real requirement). */
function pipCountsForCost(
    cost: ManaCost | undefined
): Partial<Record<Color, number>> {
    const pips: Partial<Record<Color, number>> = {
        ...getPipCountsFromCost(cost),
    };
    for (const [a, b] of cost?.hybrid ?? []) {
        pips[a] = (pips[a] ?? 0) + 1;
        pips[b] = (pips[b] ?? 0) + 1;
    }
    return pips;
}

/**
 * Computes every Maindeck statistic the Stats dialog shows (PRD #1617, §
 * "Stats dialog"): mana curve, coloured pip counts, colour source counts
 * (lands vs non-lands), and type/subtype counts. Pure and synchronous — no
 * React, no Convex context, no I/O.
 *
 * `cards` is the deck's MAINDECK list only (`LobbyDeckBase.cards`, never
 * `sideboard`) — the caller picks which list to pass, this module doesn't
 * know about sideboarding.
 *
 * `resolve` is the registry seam (mirrors `computeDeckColors`'s `resolve`
 * param in `deckColors.ts`), registry-only by default. An unresolvable card
 * id contributes nothing rather than throwing.
 */
export function computeDeckStats(
    cards: readonly DeckCard[],
    resolve: DeckCardDefinitionResolver = tryGetDefinition
): DeckStats {
    const stats = emptyStats();

    for (const card of cards) {
        const def = resolve(card.cardId);
        if (!def) continue;

        const land = isLandDefinition(def);

        if (!land) {
            stats.curve[curveBucket(manaValue(def.manaCost))]++;
        }

        for (const [color, count] of Object.entries(
            pipCountsForCost(def.manaCost)
        ) as [Color, number][]) {
            stats.pips[color] = (stats.pips[color] ?? 0) + count;
        }

        const producible = getDefinitionProducibleColors(def);
        const sourceBucket = land
            ? stats.sources.lands
            : stats.sources.nonlands;
        for (const color of producible) {
            sourceBucket[color] = (sourceBucket[color] ?? 0) + 1;
        }

        for (const type of def.types) bump(stats.types, type);
        for (const subtype of def.subtypes ?? []) bump(stats.subtypes, subtype);
    }

    return stats;
}
