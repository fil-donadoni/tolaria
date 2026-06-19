// ADR 0026 / PRD #338 — pure render-model helpers that map a projected library
// to what the viewer may see face-up. The server has already gated identity by
// `knownTo`; these helpers only translate the sparse wire shape into the
// position-indexed model the pile UI renders. No game logic, no mutations.

import type { CardInstance, PublicLibrary } from "~/types/game";

/** One slot in the expanded library pile: a card plus whether the viewer knows
 *  its identity (face-up) or sees only a back. `card` is a real instance for
 *  known slots and a synthetic placeholder for hidden ones. */
export interface LibraryPileSlot {
    /** Position from the top of the library (0 = top). */
    index: number;
    card: CardInstance;
    faceUp: boolean;
}

/** Synthetic face-down placeholder for an unknown library position. */
function placeholderSlot(playerId: string, index: number): CardInstance {
    return {
        id: `lib-${playerId}-${index}`,
        card: { id: "" },
        controllerId: playerId,
        ownerId: playerId,
        zone: "library",
        isTapped: false,
    };
}

/** Builds the full expanded-pile model from a projected library. Known cards
 *  (from `known[]`) appear face-up at their `index`; every other position is a
 *  face-down back. Result is ordered top → bottom (index ascending). A full
 *  `CardInstance[]` (debug full-state view) renders every card face-up. */
export function buildLibraryPileModel(
    library: CardInstance[] | PublicLibrary,
    playerId: string
): LibraryPileSlot[] {
    if (Array.isArray(library)) {
        return library.map((card, index) => ({ index, card, faceUp: true }));
    }
    const knownByIndex = new Map<number, CardInstance>();
    for (const k of library.known ?? []) knownByIndex.set(k.index, k.card);

    const slots: LibraryPileSlot[] = [];
    for (let index = 0; index < library.count; index++) {
        const known = knownByIndex.get(index);
        slots.push(
            known
                ? { index, card: known, faceUp: true }
                : {
                      index,
                      card: placeholderSlot(playerId, index),
                      faceUp: false,
                  }
        );
    }
    return slots;
}

/** The card the library PREVIEW should show face-up, or `null` for a back.
 *  Returns the top card (index 0) when the viewer knows it — e.g. scry-to-top
 *  or a Natural-Selection reorder that left a known card on top. */
export function libraryPreviewTopCard(
    library: CardInstance[] | PublicLibrary
): CardInstance | null {
    if (Array.isArray(library)) {
        return library.length > 0 ? library[0] : null;
    }
    const top = (library.known ?? []).find((k) => k.index === 0);
    return top ? top.card : null;
}

/** Number of cards in the library regardless of projection shape. */
export function libraryCount(library: CardInstance[] | PublicLibrary): number {
    return Array.isArray(library) ? library.length : library.count;
}
