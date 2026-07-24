import { getDefinition } from "@convex/cards";
import { manaValue } from "@convex/gre/constants";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import type { ResolvedPlacement } from "@convex/limited/poolArrangement";

/** Highest numbered Mana-Value column — every card of this value or higher
 *  shares one "MV 7+" bucket, mirroring the curve convention used elsewhere
 *  in the app (a real Pool rarely needs a dedicated column per value above
 *  this). */
export const MAX_POOL_COLUMN = 7;

export interface PoolColumnEntry {
    poolIndex: number;
    card: LimitedPoolCard;
}

export interface PoolColumn {
    /** Stable React key AND the column's drag-drop identity suffix — see
     *  `columnDropId` (`limitedDraftDrag.ts`). */
    key: string;
    label: string;
    /** Column identity a manual override can target — a numbered Mana-Value
     *  column, or `"lands"` for the Lands column (issue #1573: any card can
     *  be manually pinned into Lands, symmetric with a Land card being
     *  overridden into a numbered column). */
    column: number | "lands";
    entries: PoolColumnEntry[];
}

/** Any card identifiable by its Card ID — a `LimitedPoolCard` or a plain
 *  `DeckCard` alike. The column model only ever needs the id to look the
 *  card up in the registry, so the deckbuilder (`DeckCard[]`, no `scryfallId`)
 *  reuses `resolveDisplayColumn` unchanged (issue #1575). */
interface CardIdentifiable {
    cardId: string;
}

function isLandCard(card: CardIdentifiable): boolean {
    return getDefinition(card.cardId).types.includes("Land");
}

function autoColumnFor(card: CardIdentifiable): number {
    return Math.min(
        manaValue(getDefinition(card.cardId).manaCost),
        MAX_POOL_COLUMN
    );
}

/** Resolves ONE card's fixed display column (ADR 0060, issue #1573): a
 *  manual override if the Arrangement records one — `"lands"` verbatim, or a
 *  numeric override clamped into the fixed 0..MAX_POOL_COLUMN range — else
 *  `"lands"` for a Land card, else its own Mana Value (clamped the same
 *  way). Exported for the drag-resolution seam (`limitedDraftDrag.ts`) to
 *  compare a drop target against a card's OWN auto column, and reused by the
 *  limited deckbuilder's fixed-column grouping (issue #1575). */
export function resolveDisplayColumn(
    card: CardIdentifiable,
    columnOverride: number | "lands" | undefined
): number | "lands" {
    if (columnOverride !== undefined) {
        if (columnOverride === "lands") return "lands";
        return Math.min(Math.max(columnOverride, 0), MAX_POOL_COLUMN);
    }
    return isLandCard(card) ? "lands" : autoColumnFor(card);
}

/** The fixed column set — Lands first, then MV 0..MAX_POOL_COLUMN — as
 *  `{ key, label, column }` descriptors, in render order. The single
 *  authority both `groupPoolIntoColumns` (draft Pool) and the limited
 *  deckbuilder's `groupDeckIntoFixedColumns` (issue #1575) build their
 *  columns from, so the two surfaces never fork the column identities /
 *  labels (issue #1581 unifies them fully later). */
export function fixedColumnDescriptors(): {
    key: string;
    label: string;
    column: number | "lands";
}[] {
    const descriptors: { key: string; label: string; column: number | "lands" }[] =
        [{ key: "lands", label: "Lands", column: "lands" }];
    for (let n = 0; n <= MAX_POOL_COLUMN; n++) {
        descriptors.push({
            key: `mv-${n}`,
            label: n === MAX_POOL_COLUMN ? `MV ${n}+` : `MV ${n}`,
            column: n,
        });
    }
    return descriptors;
}

function sortEntries(entries: PoolColumnEntry[]): PoolColumnEntry[] {
    return entries.sort(
        (a, b) =>
            a.card.cardName.localeCompare(b.card.cardName) ||
            a.poolIndex - b.poolIndex
    );
}

/** Groups every MAINDECK placement (`sideboard: false`) into the fixed
 *  column set — Lands plus MV 0..MAX_POOL_COLUMN — ADR 0060's "fixed
 *  Mana-Value columns": every column always renders, even empty, so a
 *  column with no card in it today is still a valid drop target for a
 *  manual override. */
export function groupPoolIntoColumns(
    placements: readonly ResolvedPlacement[]
): PoolColumn[] {
    const byColumn = new Map<number | "lands", PoolColumnEntry[]>();
    byColumn.set("lands", []);
    for (let n = 0; n <= MAX_POOL_COLUMN; n++) byColumn.set(n, []);

    for (const placement of placements) {
        if (placement.sideboard) continue;
        const key = resolveDisplayColumn(
            placement.card,
            placement.columnOverride
        );
        byColumn.get(key)!.push({
            poolIndex: placement.poolIndex,
            card: placement.card,
        });
    }

    return fixedColumnDescriptors().map((descriptor) => ({
        ...descriptor,
        entries: sortEntries(byColumn.get(descriptor.column)!),
    }));
}

/** Every SIDEBOARD placement (`sideboard: true`), sorted for stable display —
 *  the Sideboard column is one flat pile, never bucketed by Mana Value
 *  (mirrors the pre-#1248 `PoolDeckbuilderSurface` Sideboard column). */
export function sideboardEntries(
    placements: readonly ResolvedPlacement[]
): PoolColumnEntry[] {
    return sortEntries(
        placements
            .filter((p) => p.sideboard)
            .map((p) => ({ poolIndex: p.poolIndex, card: p.card }))
    );
}
