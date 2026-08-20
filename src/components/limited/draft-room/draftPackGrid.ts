/**
 * The Booster grid's DENSITY on a phone (issue #2588, PRD #2405 slice 9,
 * ADR 0101 §6: "pack grid 3×5 portrait / 8×2 landscape with a density
 * toggle").
 *
 * Pure, because the numbers ARE the specification: the grid is a fixed column
 * count per orientation, not the `auto-fill` track the desktop grid uses. A
 * 15-card Booster then falls out as exactly the shapes the acceptance
 * criteria name — 3×5, 8×2, 4×4 — and {@link draftPackGridLabel} derives the
 * toggle's own label from the same two numbers rather than hard-coding a
 * string that could disagree with the grid it names.
 */
import type { DraftPhoneOrientation } from "./draftSnapStops";

/** `"fit"` shows the whole Booster at once; `"dense"` trades tile size for a
 *  shorter grid and scrolls if the pack does not fit. */
export type DraftPackDensity = "fit" | "dense";

export const DRAFT_PACK_DENSITIES: readonly DraftPackDensity[] = [
    "fit",
    "dense",
];

/** Columns per orientation and rung. Landscape is the wide axis, so `"fit"`
 *  lays the pack out in two long rows; portrait has height to spend and
 *  three columns keep the tile legible. Both `"dense"` rungs are 4 — the
 *  acceptance criteria's "4×4". */
const COLUMNS: Record<
    DraftPhoneOrientation,
    Record<DraftPackDensity, number>
> = {
    portrait: { fit: 3, dense: 4 },
    landscape: { fit: 8, dense: 4 },
};

export function draftPackColumns(
    orientation: DraftPhoneOrientation,
    density: DraftPackDensity
): number {
    return COLUMNS[orientation][density];
}

/** The other rung — what the toggle switches to. Two rungs today; written as
 *  a rotation so a third never needs a second opinion about the order. */
export function nextDraftPackDensity(
    density: DraftPackDensity
): DraftPackDensity {
    const at = DRAFT_PACK_DENSITIES.indexOf(density);
    return DRAFT_PACK_DENSITIES[(at + 1) % DRAFT_PACK_DENSITIES.length]!;
}

/** `"3×5"` — the grid a pack of `packSize` actually draws at this rung. Rows
 *  are derived, never declared, so the label cannot drift from the columns
 *  above (and an 8-card pack at the end of a Booster reads honestly as
 *  `3×3` rather than claiming a fifth row that is not there). */
export function draftPackGridLabel(
    orientation: DraftPhoneOrientation,
    density: DraftPackDensity,
    packSize: number
): string {
    const columns = draftPackColumns(orientation, density);
    return `${columns}×${Math.max(1, Math.ceil(packSize / columns))}`;
}
