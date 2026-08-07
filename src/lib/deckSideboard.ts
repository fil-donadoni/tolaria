import type { ZoneCard } from "~/types/game";

/** Soft size limit for the Sideboard (issue #391). The Sideboard may hold
 *  0–15 cards. Above this the UI shows a soft warning but never blocks saving —
 *  consistent with the engine's no-hard-deck-size stance. */
export const SIDEBOARD_LIMIT = 15;

/** A deck split into its two editable piles. The Maindeck (`cards`) builds the
 *  starting Library; the Sideboard holds cards swapped in between Games. */
export interface SideboardSplit {
    cards: ZoneCard[];
    sideboard: ZoneCard[];
}

/** Locates ONE copy to move. `pinKey` names a specific physical copy (issue
 *  #1626) — the Limited builder's `String(poolIndex)`; when it is omitted, or
 *  when no entry in this zone carries it, the pre-#1626 "first copy of this
 *  card" rule applies. Falling back rather than no-op'ing keeps a stale UI
 *  handle (a concurrent update already moved that copy) a working gesture
 *  instead of a dead click, and is exactly what a Constructed zone — whose
 *  entries carry no `pinKey` at all — takes every time.
 *
 *  The FOUND ENTRY ITSELF is moved, never a reconstruction of it, so whatever
 *  per-copy identity it carries survives the move. */
function removeCopy(
    list: ZoneCard[],
    cardId: string,
    pinKey?: string
): { found: ZoneCard | null; rest: ZoneCard[] } {
    const keyed =
        pinKey === undefined
            ? -1
            : list.findIndex((c) => c.cardId === cardId && c.pinKey === pinKey);
    const idx = keyed >= 0 ? keyed : list.findIndex((c) => c.cardId === cardId);
    if (idx < 0) return { found: null, rest: list };
    const rest = [...list];
    const [found] = rest.splice(idx, 1);
    return { found, rest };
}

/** Move a single copy of `cardId` from the Maindeck to the Sideboard —
 *  the copy named by `pinKey` when given (see {@link removeCopy}). If no
 *  matching copy exists in the Maindeck the split is returned unchanged. The
 *  combined pool (Maindeck + Sideboard) is preserved. */
export function moveToSideboard(
    split: SideboardSplit,
    cardId: string,
    pinKey?: string
): SideboardSplit {
    const { found, rest } = removeCopy(split.cards, cardId, pinKey);
    if (!found) return split;
    return { cards: rest, sideboard: [...split.sideboard, found] };
}

/** Move a single copy of `cardId` from the Sideboard to the Maindeck —
 *  the copy named by `pinKey` when given (see {@link removeCopy}). If no
 *  matching copy exists in the Sideboard the split is returned unchanged. The
 *  combined pool (Maindeck + Sideboard) is preserved. */
export function moveToMaindeck(
    split: SideboardSplit,
    cardId: string,
    pinKey?: string
): SideboardSplit {
    const { found, rest } = removeCopy(split.sideboard, cardId, pinKey);
    if (!found) return split;
    return { cards: [...split.cards, found], sideboard: rest };
}

/** Move ALL copies of `cardId` from the Maindeck to the Sideboard (QA
 *  sideboard revamp: the move-all CTA). Pool preserved. */
export function moveAllToSideboard(
    split: SideboardSplit,
    cardId: string
): SideboardSplit {
    const moving = split.cards.filter((c) => c.cardId === cardId);
    if (moving.length === 0) return split;
    return {
        cards: split.cards.filter((c) => c.cardId !== cardId),
        sideboard: [...split.sideboard, ...moving],
    };
}

/** Move ALL copies of `cardId` from the Sideboard to the Maindeck. Pool
 *  preserved. */
export function moveAllToMaindeck(
    split: SideboardSplit,
    cardId: string
): SideboardSplit {
    const moving = split.sideboard.filter((c) => c.cardId === cardId);
    if (moving.length === 0) return split;
    return {
        cards: [...split.cards, ...moving],
        sideboard: split.sideboard.filter((c) => c.cardId !== cardId),
    };
}
