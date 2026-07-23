// Visual grouping for a categorized reveal-and-keep pick (issue #1364, Atraxa /
// Niv-Mizzet Reborn). The `revealAndCategorize` choice carries a `categories`
// list (Atraxa: one per card type; Niv-Mizzet: one per exact colour pair), and
// the picker should PRESENT the revealed window grouped by that same category
// — one labelled section per category, in the choice's category order — so the
// player reads "here is the creature, here is the land, here is the instant"
// instead of an undifferentiated grid.
//
// A card that qualifies for several categories (an artifact creature under
// Atraxa's Artifact + Creature) is shown ONCE, under the FIRST category that
// lists it, so the sections stay disjoint and a card is never rendered twice.
// This is purely a DISPLAY partition; the keep LEGALITY is still the bipartite
// matching in `convex/gre/categorizedPick.ts` (a card displayed under Creature
// can still be legally kept for Artifact if that frees the Creature seat), so
// the display bucket never constrains what the player can actually pick.
//
// A revealed card matching NO category (Niv-Mizzet's monocolour/colourless
// cards) is hand-ineligible — it lands in `ungrouped`, rendered as its own
// trailing "not keepable" section.

import type { CardInstance } from "~/types/game";

export type PileCategory = { label: string; cardIds: string[] };

export type PileCategorySection = { label: string; cards: CardInstance[] };

/** Partition `cards` into one section per category (first-match wins, category
 *  order preserved) plus the trailing `ungrouped` cards that match no category.
 *  Empty sections are dropped so a category with no revealed member shows no
 *  header. Card order within a section follows the category's `cardIds` order
 *  (the reveal order the interpreter built it in). */
export function buildCategorySections(
    cards: CardInstance[],
    categories: PileCategory[]
): { sections: PileCategorySection[]; ungrouped: CardInstance[] } {
    const byId = new Map(cards.map((c) => [c.id, c]));
    const assigned = new Set<string>();
    const sections: PileCategorySection[] = [];
    for (const category of categories) {
        const sectionCards: CardInstance[] = [];
        for (const id of category.cardIds) {
            if (assigned.has(id)) continue;
            const card = byId.get(id);
            if (card === undefined) continue;
            assigned.add(id);
            sectionCards.push(card);
        }
        if (sectionCards.length > 0) {
            sections.push({ label: category.label, cards: sectionCards });
        }
    }
    const ungrouped = cards.filter((c) => !assigned.has(c.id));
    return { sections, ungrouped };
}
