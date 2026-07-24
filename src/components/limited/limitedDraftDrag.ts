// Drag-and-drop resolution for the continuous draft→build surface (ADR 0060,
// issue #1248). dnd-kit's real pointer-based collision detection can't be
// meaningfully exercised in jsdom (no real layout), so — mirroring the
// project's convention for GRE/engine logic — the "what does this drop
// MEAN" decision is a small PURE function, independently unit-testable by
// constructing the drag payload/target directly. `limited-draft-table.tsx`'s
// `onDragEnd` is a thin shell that reads the real `DragEndEvent` and calls
// this.

const COLUMN_PREFIX = "pool-col-";
export const SIDEBOARD_DROP_ID = "pool-sideboard";

/** A booster card being dragged (Booster → Pool column / Sideboard commits
 *  the Pick — ADR 0060). */
export interface BoosterDragData {
    kind: "booster";
    pickId: string;
    cardId: string;
    cardName: string;
}

/** An already-picked Pool card being dragged (Pool ⇄ Sideboard, or between
 *  Mana-Value columns — a manual column override). */
export interface PoolDragData {
    kind: "pool";
    poolIndex: number;
    cardId: string;
    cardName: string;
}

export type DraftDragData = BoosterDragData | PoolDragData;

/** Where a drag landed — the Sideboard, or a specific column: a numbered
 *  Mana-Value column, or `"lands"` (ADR 0060, issue #1573: a committed
 *  non-drag Pick lands in its own MV column by default; landing via a drag
 *  onto a SPECIFIC column always names that exact column explicitly,
 *  whether or not it happens to equal the card's own auto column — Lands
 *  included, any card type can be manually pinned there). */
export type DraftDropTarget =
    | { kind: "sideboard" }
    | { kind: "column"; column: number | "lands" };

/** What a resolved drop MEANS — `limited-draft-table.tsx` maps this to the
 *  actual mutation call(s) (`submitPick` / `setPoolArrangementEntry`). */
export type DraftDragAction =
    | { type: "commitPick"; pickId: string; target: DraftDropTarget }
    | { type: "moveArrangement"; poolIndex: number; target: DraftDropTarget };

/** Drop-target id for a fixed column — a numbered Mana-Value column, or
 *  `"lands"` for the Lands column. */
export function columnDropId(column: number | "lands"): string {
    return `${COLUMN_PREFIX}${column === "lands" ? "lands" : String(column)}`;
}

/** Parses a column drop-target id back to its column identity (a numeric
 *  Mana-Value column, or the literal `"lands"`), or `null` for any
 *  unrecognized id (not a valid column-override target). Exported so the
 *  limited deckbuilder's own drag resolver (`deckbuilderColumnDrag.ts`, issue
 *  #1575) parses column drop ids through the SAME code as the draft Pool —
 *  the two surfaces never fork column-id parsing (issue #1581 unifies them). */
export function parseColumnDropId(dest: string): number | "lands" | null {
    if (!dest.startsWith(COLUMN_PREFIX)) return null;
    const raw = dest.slice(COLUMN_PREFIX.length);
    if (raw === "lands") return "lands";
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : null;
}

/** Resolves a completed drag into the action it represents, or `null` for a
 *  cancelled/no-op drop (missing data/target, or a target this surface
 *  doesn't recognize). Pure — no side effects, no mutation calls. */
export function resolveDraftDragAction(
    data: DraftDragData | undefined,
    dest: string | undefined
): DraftDragAction | null {
    if (!data || !dest) return null;

    let target: DraftDropTarget | null = null;
    if (dest === SIDEBOARD_DROP_ID) {
        target = { kind: "sideboard" };
    } else {
        const column = parseColumnDropId(dest);
        if (column !== null) target = { kind: "column", column };
    }
    if (target === null) return null;

    return data.kind === "booster"
        ? { type: "commitPick", pickId: data.pickId, target }
        : { type: "moveArrangement", poolIndex: data.poolIndex, target };
}
