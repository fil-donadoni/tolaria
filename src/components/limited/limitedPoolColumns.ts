// Draft-time Pool column adapter (ADR 0060; rewired onto the Column Layout
// engine in issue #1622).
//
// The generic fixed-column ladder that used to live here — `MAX_POOL_COLUMN`,
// `resolveDisplayColumn`, `fixedColumnDescriptors`, `FixedColumn<T>`,
// `groupIntoFixedColumns<T>` — is GONE. It existed to be shared with the
// Limited deckbuilder's Maindeck (`groupDeckIntoFixedColumns`), and both that
// helper and the Constructed dynamic Mana-Value piles (`groupDeckIntoPiles`)
// are subsumed by `convex/deckLayout.ts`, the single authority on column
// identity, claiming order and Card Pin resolution (ADR 0075, issue #1618).
// What remains here is the thin adapter that reshapes the engine's answer into
// the `PoolColumn` vocabulary the draft-time Pool surface still speaks; ADR
// 0075 §6 moves that surface onto the shared zone surface in a later slice.
import { tryGetDefinition } from "@convex/cards";
import {
    CATCH_ALL_COLUMN_ID,
    createColumnLayout,
    parseColumnId,
    resolveColumnLayout,
    type CardLookup,
    type CardPins,
} from "@convex/deckLayout";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import type { ResolvedPlacement } from "@convex/limited/poolArrangement";

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

/** Catalogue lookup that NEVER fails. A Pool card the registry doesn't know
 *  used to throw out of `getDefinition` and take the whole Pool view down;
 *  resolving it to a nameless, costless, typeless definition puts it in the
 *  `MV 0` column instead. This is also what makes dropping the Catch-All
 *  Column below sound: with every card resolvable, the `mv` Grouping's
 *  generated ladder (Lands + MV 0..7+) claims all of them, so the Catch-All is
 *  provably always empty on this surface. */
const poolCardLookup: CardLookup = (cardId) =>
    tryGetDefinition(cardId) ?? {
        id: cardId,
        name: cardId,
        rarity: "common",
        types: [],
    };

/** The `mv`-namespace Column id read back as the draft Pool's own column
 *  vocabulary. `null` for the Catch-All and for any id outside the `mv`
 *  ladder — neither can occur here (see {@link poolCardLookup}), so a `null`
 *  simply drops the column rather than inventing an identity for it. */
function poolColumnIdentity(columnId: string): number | "lands" | null {
    if (columnId === CATCH_ALL_COLUMN_ID) return null;
    const parsed = parseColumnId(columnId);
    if (!parsed || parsed.namespace !== "mv") return null;
    if (parsed.key === "lands") return "lands";
    const n = Number(parsed.key);
    return Number.isInteger(n) ? n : null;
}

/** Groups every MAINDECK placement (`sideboard: false`) into the Column Layout
 *  engine's `mv` ladder — Lands plus MV 0..7+ — ADR 0060's "fixed Mana-Value
 *  columns": every column always renders, even empty, so a column with no card
 *  in it today is still a valid drop target for a manual override. Card Pins
 *  come from the placement itself (`ResolvedPlacement.pins`, already
 *  normalised out of whichever shape the Arrangement entry is stored in, issue
 *  #1621) and are keyed by `poolIndex`, the per-copy identity the Pool keeps
 *  (ADR 0075 §4). */
export function groupPoolIntoColumns(
    placements: readonly ResolvedPlacement[]
): PoolColumn[] {
    const maindeck = placements.filter((p) => !p.sideboard);
    const pins: Record<string, CardPins> = {};
    for (const placement of maindeck) {
        if (Object.keys(placement.pins).length > 0) {
            pins[String(placement.poolIndex)] = placement.pins;
        }
    }

    const columns = resolveColumnLayout<ResolvedPlacement>({
        layout: createColumnLayout({ pins }),
        items: maindeck,
        adapter: {
            cardId: (p) => p.card.cardId,
            pinKey: (p) => String(p.poolIndex),
            tiebreak: (a, b) => a.poolIndex - b.poolIndex,
        },
        lookup: poolCardLookup,
    });

    const out: PoolColumn[] = [];
    for (const column of columns) {
        const identity = poolColumnIdentity(column.id);
        if (identity === null) continue;
        out.push({
            key: column.id,
            label: column.label,
            column: identity,
            entries: column.items.map((p) => ({
                poolIndex: p.poolIndex,
                card: p.card,
            })),
        });
    }
    return out;
}

/** Every SIDEBOARD placement (`sideboard: true`), sorted for stable display —
 *  the draft Pool's Sideboard column is one flat pile, never bucketed by Mana
 *  Value. */
export function sideboardEntries(
    placements: readonly ResolvedPlacement[]
): PoolColumnEntry[] {
    return placements
        .filter((p) => p.sideboard)
        .map((p) => ({ poolIndex: p.poolIndex, card: p.card }))
        .sort(
            (a, b) =>
                a.card.cardName.localeCompare(b.card.cardName) ||
                a.poolIndex - b.poolIndex
        );
}
