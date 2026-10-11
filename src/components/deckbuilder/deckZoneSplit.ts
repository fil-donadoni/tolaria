// "Split creatures" pile layout (PRD #5384, issue #5399) — a pure function of
// (resolved columns, split on/off, viewport class). It runs downstream of
// `resolveColumnLayout` and of the Zone filter, exactly like `deckZoneFilter.ts`
// (which is why it never changes WHICH columns exist): the group axis is
// whatever the engine already generated, the creature/non-creature
// segmented filter narrows each column's items before this sees them, so the
// two controls stay independent by construction.
//
// Phone classes (issue #5400): split off, portrait wraps the piles inside one
// pane and landscape lays them in one sideways row; split on, both cut the
// Zone into two bands (portrait: one tab each, landscape: side by side).

/** The three shapes the builder is laid out for. */
export type ZoneViewportClass =
    | "desktop"
    | "phone-portrait"
    | "phone-landscape";

/** The two halves "Split creatures" cuts a Zone into. */
export type ZoneBand = "creatures" | "others";

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

/** One band of a phone layout: the columns holding at least one of its
 *  cards, each narrowed to the band's tiles. */
export interface ZoneBandColumns<C extends SplitSourceColumn> {
    columns: C[];
    count: number;
}

export type ZonePileLayout<C extends SplitSourceColumn> =
    | { kind: "piles"; columns: C[] }
    /** Phone portrait, split off: the Zone's piles wrap inside one pane. */
    | { kind: "wrap"; columns: C[] }
    /** Phone landscape, split off: one sideways-scrolling row of piles. */
    | { kind: "row"; columns: C[] }
    /** Phone, split on: two bands. `tabs` (portrait) gives each its own pane
     *  behind a tab; `side-by-side` (landscape) draws them as two rows next to
     *  each other. */
    | {
          kind: "bands";
          arrangement: "tabs" | "side-by-side";
          creatures: ZoneBandColumns<C>;
          others: ZoneBandColumns<C>;
      }
    | {
          kind: "split";
          columns: SplitGridColumn<C>[];
          /** Tile count of the tallest creature stack — every creature cell
           *  reserves it, so the divider is one straight line. */
          creatureSlots: number;
          creatureCount: number;
          otherCount: number;
      };

function cutBand<C extends SplitSourceColumn>(
    columns: C[],
    keep: (cardId: string) => boolean
): ZoneBandColumns<C> {
    const cut = columns
        .map((column) => ({
            ...column,
            tiles: column.tiles.filter((t) => keep(t.cardId)),
        }))
        .filter((column) => column.tiles.length > 0);
    return {
        columns: cut,
        count: cut.reduce((n, c) => n + c.tiles.length, 0),
    };
}

export function layoutZonePiles<C extends SplitSourceColumn>(
    columns: C[],
    options: {
        split: boolean;
        viewport: ZoneViewportClass;
        isCreature: (cardId: string) => boolean;
    }
): ZonePileLayout<C> {
    const { split, viewport, isCreature } = options;
    if (viewport === "phone-portrait" || viewport === "phone-landscape") {
        if (!split) {
            return {
                kind: viewport === "phone-portrait" ? "wrap" : "row",
                columns,
            };
        }
        return {
            kind: "bands",
            arrangement:
                viewport === "phone-portrait" ? "tabs" : "side-by-side",
            creatures: cutBand(columns, isCreature),
            others: cutBand(columns, (cardId) => !isCreature(cardId)),
        };
    }
    if (!split) return { kind: "piles", columns };
    const cut = columns.map((column) => ({
        column,
        creatures: column.tiles.filter((t) => isCreature(t.cardId)),
        others: column.tiles.filter((t) => !isCreature(t.cardId)),
    }));
    return {
        kind: "split",
        columns: cut,
        creatureSlots: Math.max(0, ...cut.map((c) => c.creatures.length)),
        creatureCount: cut.reduce((n, c) => n + c.creatures.length, 0),
        otherCount: cut.reduce((n, c) => n + c.others.length, 0),
    };
}
