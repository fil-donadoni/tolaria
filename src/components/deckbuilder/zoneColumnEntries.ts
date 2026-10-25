import {
    canDeleteColumn,
    type ColumnId,
    type ResolvedColumn,
} from "@convex/deckLayout";

/** One row of the `Columns` sheet (issue #3677): a Column the player may
 *  manage, with the two verdicts the engine owns already computed. */
export interface ZoneColumnEntry {
    id: ColumnId;
    label: string;
    /** UNFILTERED card count — the same population `deletable` is judged on,
     *  so a row never reads `0` beside a Delete the engine refuses. */
    count: number;
    /** Manual Columns only: a generated Column's label comes from its
     *  Grouping and would be regenerated over on the next resolve. */
    renameable: boolean;
    deletable: boolean;
}

/**
 * The Columns the `Columns` sheet lists, from the Zone's UNFILTERED resolve.
 *
 * Same population the glyph path (`DeckColumnActions`) manages: a Column with
 * no `pinNamespace` — the Catch-All, and every Column under Grouping `none` —
 * is never renameable and never deletable, so it gets no row rather than a
 * row of two dead controls. Deletability is `canDeleteColumn` over the
 * unfiltered resolve, never re-derived: a Zone filter hides cards without
 * emptying a Column (ADR 0075 rationale §2).
 */
export function zoneColumnEntries(
    rawColumns: readonly ResolvedColumn<unknown>[]
): ZoneColumnEntry[] {
    return rawColumns
        .filter((column) => column.pinNamespace !== null)
        .map((column) => ({
            id: column.id,
            label: column.label,
            count: column.items.length,
            renameable: column.kind === "manual",
            deletable: canDeleteColumn(rawColumns, column.id),
        }));
}
