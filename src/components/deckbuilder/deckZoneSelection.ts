/**
 * The SELECTED CARD of a deckbuilder zone pair (issue #2584, PRD #2405 D16).
 *
 * With the per-card overlay buttons removed, a tap on a touch surface no
 * longer MOVES the card — it selects it, and the Peek Panel supplies the CTAs
 * that used to be crammed onto the tile ("→ Side", "Move to…", "Inspect",
 * "★ Featured"). This is the record a zone hands its parent when that happens.
 *
 * It carries the Column list because only the zone knows it: the pin targets
 * come out of `resolveColumnLayout` inside `DeckZoneSurface`, and a parent
 * re-deriving them would be a second grouper (the exact drift ADR 0075 closed).
 */
import type { ColumnId, DeckZone } from "@convex/deckLayout";

/** One Column offered as a "Move to…" destination — the exact `id`/`label`
 *  pair the surface renders that Column with. Columns that are not PIN
 *  TARGETS (the Catch-All, Grouping `none`'s single Column) never appear:
 *  `pinCardToColumn` returns the layout unchanged for them, so listing one
 *  would be an entry that silently does nothing (PR #2333 review, B1). */
export interface DeckColumnChoice {
    id: ColumnId;
    label: string;
}

export interface DeckZoneSelection {
    zone: DeckZone;
    cardId: string;
    cardName: string;
    /** The key this COPY's Card Pin is recorded under (issue #1626). */
    pinKey: string;
    /** The rendered tile's React key — what the surface compares against to
     *  draw the selection ring, so the ring follows the copy that was tapped
     *  rather than every copy of the same card. */
    tileKey: string;
    /** Pin targets in this Zone. Empty under the `"pane"` drop model. */
    columns: readonly DeckColumnChoice[];
}
