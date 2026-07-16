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

/** Where a drag landed — the Sideboard, or a specific numbered Mana-Value
 *  column (ADR 0060: a committed non-drag Pick lands in its own MV column
 *  by default; landing via a drag onto a SPECIFIC column always names that
 *  exact column explicitly, whether or not it happens to equal the card's
 *  own auto MV). */
export type DraftDropTarget =
    | { kind: "sideboard" }
    | { kind: "column"; column: number };

/** What a resolved drop MEANS — `limited-draft-table.tsx` maps this to the
 *  actual mutation call(s) (`submitPick` / `setPoolArrangementEntry`). */
export type DraftDragAction =
    | { type: "commitPick"; pickId: string; target: DraftDropTarget }
    | { type: "moveArrangement"; poolIndex: number; target: DraftDropTarget };

/** Drop-target id for a fixed Mana-Value column (`null` = the Lands
 *  column, which the Lands pile registers but is never a valid column-
 *  override TARGET — see `resolveDraftDragAction`). */
export function columnDropId(column: number | null): string {
    return `${COLUMN_PREFIX}${column === null ? "lands" : String(column)}`;
}

/** Parses a column drop-target id back to its numeric column, or `null` for
 *  the Lands column / any unrecognized id (both treated as "not a valid
 *  column-override target" by `resolveDraftDragAction`). */
function parseColumnDropTarget(dest: string): number | null {
    if (!dest.startsWith(COLUMN_PREFIX)) return null;
    const raw = dest.slice(COLUMN_PREFIX.length);
    if (raw === "lands") return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : null;
}

/** Resolves a completed drag into the action it represents, or `null` for a
 *  cancelled/no-op drop (missing data/target, or a target this surface
 *  doesn't recognize — e.g. the Lands pile, which is display-only for a
 *  drop). Pure — no side effects, no mutation calls. */
export function resolveDraftDragAction(
    data: DraftDragData | undefined,
    dest: string | undefined
): DraftDragAction | null {
    if (!data || !dest) return null;

    let target: DraftDropTarget | null = null;
    if (dest === SIDEBOARD_DROP_ID) {
        target = { kind: "sideboard" };
    } else {
        const column = parseColumnDropTarget(dest);
        if (column !== null) target = { kind: "column", column };
    }
    if (target === null) return null;

    return data.kind === "booster"
        ? { type: "commitPick", pickId: data.pickId, target }
        : { type: "moveArrangement", poolIndex: data.poolIndex, target };
}
