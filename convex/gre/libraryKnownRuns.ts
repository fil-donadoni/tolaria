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

import type { CardInstanceState, PendingChoice } from "./state";

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
 *  (`libraryReveal.ts`), never stored, so it cannot go stale.
 *
 *  `peekedTop` is the THIRD such source (issue #2996): while a top-N look
 *  choice is OPEN, the chooser is staring at those cards in the picker — the
 *  wire projection hands them over face-up as `libraryPeek`
 *  (`exposeLibraryPeek`, `gameProjections.ts`) — but nothing has stamped
 *  `knownTo` yet, because the scry / surveil grant only happens when the
 *  choice is APPLIED. Without it `determinize` re-deals the very cards the
 *  open choice's `candidateIds` name, and the resume path then throws
 *  ("Card … not in kept top of library") because the kept cards are no longer
 *  the library's top run. It makes indices `[0, peekedTop)` known
 *  independently of `knownTo`, so the run scan continues past them into any
 *  genuinely-known card beneath — see {@link openPeekTopCount}. */
export function knownLibraryIndices(
    library: readonly CardInstanceState[],
    viewerId: string,
    topRevealed: boolean = false,
    peekedTop: number = 0
): number[] {
    const knows = (card: CardInstanceState, index: number): boolean =>
        (topRevealed && index === 0) ||
        index < peekedTop ||
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

/** Issue #2996 — how many TOP cards of `libraryOwnerId`'s library `viewerId`
 *  is looking at right now through an OPEN top-N look choice, for
 *  {@link knownLibraryIndices}' `peekedTop`. 0 when there is no such choice.
 *
 *  `choice` is the pending-choice QUEUE HEAD, which is the only choice anyone
 *  can be answering (`applyPendingChoiceSubmit` and `enumerateMoves` both read
 *  the head and nothing else), and the peek is exposed to the CHOOSER
 *  (`head.playerId`) over the ZONE OWNER's library (`zoneOwnerId ?? playerId`)
 *  — the fateseal split (CR 701.29, Jace's +2: the controller looks into the
 *  target player's library).
 *
 *  Only the kinds whose `candidateIds` ARE the top N qualify. `reorder-library`
 *  and `divide-piles` also expose a peek, but their candidates may sit anywhere
 *  in the library (`gameProjections.ts` says so where it builds
 *  `peekCandidateIds`), so they are not a top RUN and this function's index
 *  model cannot express them; neither is a searchable choice node, so nothing
 *  reads their peek through the search today. Pinning them needs an index-set
 *  derivation rather than a run length — deliberately not invented here for a
 *  caller that does not exist. */
export function openPeekTopCount(
    choice: PendingChoice | undefined,
    libraryOwnerId: string,
    viewerId: string
): number {
    if (!choice || choice.zone !== "library") return 0;
    if (choice.playerId !== viewerId) return 0;
    if ((choice.zoneOwnerId ?? choice.playerId) !== libraryOwnerId) return 0;
    switch (choice.kind) {
        case "order-top":
        case "look-top":
        case "look-distribute":
        case "draw-look-keep":
            return choice.candidateIds?.length ?? 0;
        default:
            return 0;
    }
}
