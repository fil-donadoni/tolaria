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
    /** Numeric column identity a manual override can target — `null` for the
     *  Lands column, which is never a drop target for a column override
     *  (ADR 0060, issue #1248: overriding a card'S column always names an
     *  explicit Mana Value; "pin this into Lands" is out of scope — a Land
     *  can still be overridden INTO a numbered column, just not the reverse). */
    column: number | null;
    entries: PoolColumnEntry[];
}

function isLandCard(card: LimitedPoolCard): boolean {
    return getDefinition(card.cardId).types.includes("Land");
}

function autoColumnFor(card: LimitedPoolCard): number {
    return Math.min(
        manaValue(getDefinition(card.cardId).manaCost),
        MAX_POOL_COLUMN
    );
}

/** Resolves ONE card's fixed display column (ADR 0060): a manual override
 *  (clamped into the fixed 0..MAX_POOL_COLUMN range) if the Arrangement
 *  records one, else `"lands"` for a Land card, else its own Mana Value
 *  (clamped the same way). Exported for the drag-resolution seam
 *  (`limitedDraftDrag.ts`) to compare a drop target against a card's OWN
 *  auto column. */
export function resolveDisplayColumn(
    card: LimitedPoolCard,
    columnOverride: number | undefined
): number | "lands" {
    if (columnOverride !== undefined) {
        return Math.min(Math.max(columnOverride, 0), MAX_POOL_COLUMN);
    }
    return isLandCard(card) ? "lands" : autoColumnFor(card);
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

    const columns: PoolColumn[] = [
        {
            key: "lands",
            label: "Lands",
            column: null,
            entries: sortEntries(byColumn.get("lands")!),
        },
    ];
    for (let n = 0; n <= MAX_POOL_COLUMN; n++) {
        columns.push({
            key: `mv-${n}`,
            label: n === MAX_POOL_COLUMN ? `MV ${n}+` : `MV ${n}`,
            column: n,
            entries: sortEntries(byColumn.get(n)!),
        });
    }
    return columns;
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
