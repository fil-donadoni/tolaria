import type { DeckCard } from "~/types/game";

/** Soft size limit for the Sideboard (issue #391). The Sideboard may hold
 *  0–15 cards. Above this the UI shows a soft warning but never blocks saving —
 *  consistent with the engine's no-hard-deck-size stance. */
export const SIDEBOARD_LIMIT = 15;

/** A deck split into its two editable piles. The Maindeck (`cards`) builds the
 *  starting Library; the Sideboard holds cards swapped in between Games. */
export interface SideboardSplit {
    cards: DeckCard[];
    sideboard: DeckCard[];
}

function removeFirst(
    list: DeckCard[],
    cardId: string
): { found: DeckCard | null; rest: DeckCard[] } {
    const idx = list.findIndex((c) => c.cardId === cardId);
    if (idx < 0) return { found: null, rest: list };
    const rest = [...list];
    const [found] = rest.splice(idx, 1);
    return { found, rest };
}

/** Move a single copy of `cardId` from the Maindeck to the Sideboard. If no
 *  matching copy exists in the Maindeck the split is returned unchanged. The
 *  combined pool (Maindeck + Sideboard) is preserved. */
export function moveToSideboard(
    split: SideboardSplit,
    cardId: string
): SideboardSplit {
    const { found, rest } = removeFirst(split.cards, cardId);
    if (!found) return split;
    return { cards: rest, sideboard: [...split.sideboard, found] };
}

/** Move a single copy of `cardId` from the Sideboard to the Maindeck. If no
 *  matching copy exists in the Sideboard the split is returned unchanged. The
 *  combined pool (Maindeck + Sideboard) is preserved. */
export function moveToMaindeck(
    split: SideboardSplit,
    cardId: string
): SideboardSplit {
    const { found, rest } = removeFirst(split.sideboard, cardId);
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
