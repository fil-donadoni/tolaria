// The ONE adapter from a Pool split to the zone entries a `DeckZoneSurface`
// renders (ADR 0075 §4). Extracted from `pool-deck-builder-form.tsx` when the
// draft-time Pool became the second caller (issue #1632): the draft and the
// build view now feed the SAME surface from the SAME Pool Arrangement, so the
// per-copy Pin identity they establish must be established once, in one place.
// Two callers minting the pin key differently would produce Pins that resolve
// on one surface and silently do nothing on the other — the exact failure the
// key's single-authority rule (`poolCopyPinKey`) exists to prevent.
import type { PlainPoolCard } from "@convex/limited/poolArrangement";
import { poolCopyPinKey } from "@convex/limited/poolArrangement";
import type { ZoneCard } from "~/types/game";

/** Pool cards as ZONE entries carrying their per-copy Pin identity (issue
 *  #1626): the Pool's own `poolIndex`, stringified by the one authority
 *  (`poolCopyPinKey`) that `pinsByPoolIndex` records Pins under.
 *
 *  This is where the Limited per-copy identity ENTERS a zone surface, and the
 *  only place it is ever established: from here on the entry carries it, and a
 *  Maindeck⇄Sideboard move moves the entry itself, so no later render
 *  re-derives it by counting occurrences in an array that renumbers (PR #2318
 *  review B1). A card the Pool doesn't hold — a Basic added from the bar — has
 *  no `poolIndex`, so it gets no key and simply can never be pinned. */
export function toZoneCards(cards: readonly PlainPoolCard[]): ZoneCard[] {
    return cards.map(({ cardId, cardName, poolIndex }) =>
        poolIndex === undefined
            ? { cardId, cardName }
            : { cardId, cardName, pinKey: poolCopyPinKey(poolIndex) }
    );
}
