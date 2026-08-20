/**
 * Duplicate collapsing for the phone MV ROWS (issue #2584, PRD #2405 slice 5).
 *
 * In portrait a Column is drawn as a horizontal ROW rather than an overlaid
 * pile, and a row of four identical Lightning Bolts is four tiles of pure
 * noise on a 390px screen. The row shows ONE tile per distinct card with a
 * `×N` badge instead.
 *
 * **Collapsing is presentational only — it never merges the copies.** The
 * surviving tile keeps the FIRST copy's whole identity (its drag id, its drag
 * payload including that copy's `pinKey`, its click handler, its tooltip), so
 * a tap or a drag on a `×4` tile acts on exactly one copy — the same copy the
 * uncollapsed pile's topmost tile would have acted on. That is the issue's
 * "select/move acts on one copy" clause, true by construction rather than by
 * a check at the call site.
 */
import type { DeckPileTile } from "./deck-column-pile";

/** A collapsed row tile: a pile tile plus how many copies it stands for. */
export interface DeckRowTile extends DeckPileTile {
    /** ≥ 1. `1` renders no badge. */
    count: number;
}

/**
 * One tile per distinct `cardId`, in first-appearance order, each carrying the
 * number of copies it replaced.
 */
export function collapseDuplicateTiles(
    tiles: readonly DeckPileTile[]
): DeckRowTile[] {
    const byCardId = new Map<string, DeckRowTile>();
    const order: string[] = [];
    for (const tile of tiles) {
        const existing = byCardId.get(tile.cardId);
        if (existing) {
            existing.count += 1;
            continue;
        }
        // `stackIndex` is dropped deliberately: a row lays its tiles out side
        // by side, so the staggered absolute `top` of a pile would push every
        // tile but the first out of the row's box.
        byCardId.set(tile.cardId, {
            ...tile,
            stackIndex: undefined,
            count: 1,
        });
        order.push(tile.cardId);
    }
    return order.map((cardId) => byCardId.get(cardId)!);
}
