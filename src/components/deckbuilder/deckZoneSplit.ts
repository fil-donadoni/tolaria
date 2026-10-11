// "Split creatures" pile layout (PRD #5384, issue #5399) — a pure function of
// (resolved columns, split on/off, viewport class). It runs downstream of
// `resolveColumnLayout` and of the Zone filter, exactly like `deckZoneFilter.ts`
// (which is why it never changes WHICH columns exist): the group axis is
// whatever the engine already generated, the creature/non-creature
// segmented filter narrows each column's items before this sees them, so the
// two controls stay independent by construction.

/** The three shapes the builder is laid out for. Only `desktop` has a split
 *  grid so far; the phone rungs keep their piles/rows whatever the toggle says. */
export type ZoneViewportClass =
    | "desktop"
    | "phone-portrait"
    | "phone-landscape";

/** What the split layout needs of a column: tiles, classifiable by card. */
export interface SplitSourceColumn {
    tiles: { cardId: string }[];
}

/** One column of the split grid: the same column, its tiles cut in two. */
export interface SplitGridColumn<C extends SplitSourceColumn> {
    column: C;
    creatures: C["tiles"];
    others: C["tiles"];
}

export type ZonePileLayout<C extends SplitSourceColumn> =
    | { kind: "piles"; columns: C[] }
    | {
          kind: "split";
          columns: SplitGridColumn<C>[];
          /** Tile count of the tallest creature stack — every creature cell
           *  reserves it, so the divider is one straight line. */
          creatureSlots: number;
          creatureCount: number;
          otherCount: number;
      };

export function layoutZonePiles<C extends SplitSourceColumn>(
    columns: C[],
    options: {
        split: boolean;
        viewport: ZoneViewportClass;
        isCreature: (cardId: string) => boolean;
    }
): ZonePileLayout<C> {
    if (!options.split || options.viewport !== "desktop") {
        return { kind: "piles", columns };
    }
    const cut = columns.map((column) => ({
        column,
        creatures: column.tiles.filter((t) => options.isCreature(t.cardId)),
        others: column.tiles.filter((t) => !options.isCreature(t.cardId)),
    }));
    return {
        kind: "split",
        columns: cut,
        creatureSlots: Math.max(0, ...cut.map((c) => c.creatures.length)),
        creatureCount: cut.reduce((n, c) => n + c.creatures.length, 0),
        otherCount: cut.reduce((n, c) => n + c.others.length, 0),
    };
}
