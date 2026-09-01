// ADR 0026 / PRD #338 — WHICH library positions a given viewer legitimately
// knows. ONE derivation, two consumers (issue #1524).
//
// A library is a hidden zone (CR 400.2), but a scry keep, a Brainstorm
// put-back, an Impulse/Stock Up bottoming and the CR 401.5 continuous top
// reveal all leave the viewer knowing a card AND its position. `knownTo`
// records who was shown what; this module turns that per-card record into the
// set of INDICES the viewer is entitled to, applying the one rule that makes
// position knowledge sound:
//
//   only the two CONTIGUOUS runs from each END count — the run from the TOP
//   and the run from the BOTTOM.
//
// Position certainty is lost the moment an unknown card straddles a known one:
// a scry-known card pushed into the middle by a later Stock Up is contiguous
// with neither end, so the viewer knows the card is SOMEWHERE in there but not
// where, and it reads as a face-down back again. The instance keeps its
// `knownTo` (nothing mutates); the derivation simply stops granting it.
//
// WHY THIS IS A MODULE AND NOT TWO COPIES. The wire projection
// (`projectLibrary`) decides what a client is shown; `determinize` decides
// what the bot's ISMCTS search is allowed to keep pinned across iterations.
// Those two must agree exactly: a search that pinned MORE than the projection
// granted would be reasoning about cards the viewer was never shown, and one
// that pinned less would throw away knowledge the viewer demonstrably has
// (the pre-#1524 behaviour — the bot forgot a card it had just scryed to the
// top). Two parallel derivations of "what does this viewer know" is precisely
// the drift this file exists to make impossible.

import type { CardInstanceState } from "./state";

/** ADR 0026 — the indices of `library` that `viewerId` legitimately knows: the
 *  contiguous run from the top, then the contiguous run from the bottom.
 *
 *  Returned TOP RUN ASCENDING, then BOTTOM RUN DESCENDING — the order
 *  `PublicLibrary.known[]` has always been emitted in, so the wire shape is
 *  byte-identical to before this was extracted.
 *
 *  The two runs never overlap: the bottom scan stops at the top run's
 *  boundary, so an all-known library yields each index exactly once.
 *
 *  `topRevealed` is the CR 401.5 continuous reveal (issue #1095 symmetric,
 *  #2398 asymmetric), a second SOURCE of the same knowledge rather than a
 *  second mechanism: it makes index 0 — and only index 0 — known independently
 *  of `knownTo`. It is derived from the battlefield on every call
 *  (`libraryReveal.ts`), never stored, so it cannot go stale. */
export function knownLibraryIndices(
    library: readonly CardInstanceState[],
    viewerId: string,
    topRevealed: boolean = false
): number[] {
    const knows = (card: CardInstanceState, index: number): boolean =>
        (topRevealed && index === 0) ||
        (card.knownTo?.includes(viewerId) ?? false);

    const indices: number[] = [];
    // Top run: [0, topEnd).
    let topEnd = 0;
    while (topEnd < library.length && knows(library[topEnd], topEnd)) {
        indices.push(topEnd);
        topEnd++;
    }
    // Bottom run: (bottomStart, length), scanning up but never crossing topEnd.
    for (let index = library.length - 1; index >= topEnd; index--) {
        if (!knows(library[index], index)) break;
        indices.push(index);
    }
    return indices;
}
