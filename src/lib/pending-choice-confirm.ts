import type { PendingChoice } from "~/types/game";
import {
    isCategorizedCoverLegal,
    isCategorizedPickLegal,
} from "@convex/gre/categorizedPick";

/** Lower bound of a {@link PendingChoice.count}, regardless of whether it's the
 *  fixed-N shape (`min === count`) or the `{ min, max }` range shape. */
export function pendingChoiceMin(count: PendingChoice["count"]): number {
    return typeof count === "number" ? count : count.min;
}

/** Upper bound of a {@link PendingChoice.count}. */
export function pendingChoiceMax(count: PendingChoice["count"]): number {
    return typeof count === "number" ? count : count.max;
}

/** Whether a zone-pick choice's Done/Skip button is legal to fire given the
 *  number of items currently buffered (ADR 0007). The confirm enables once the
 *  buffer is within `[min, max]` — for range choices (e.g. Sylvan Library's
 *  0–N topdeck pick) that means Done is enabled at the MINIMUM allowed
 *  selection, including 0 when `min === 0`. Pure so it can be unit-tested apart
 *  from the hook that wires it to game context.
 *
 *  `categorized` (issue #1945, Noxious Vapors / Planar Overlay) — a
 *  CATEGORIZED pick (`choice.categories`, `look-distribute` OR
 *  `choose-categorized`) adds a constraint the count bounds alone cannot
 *  express, and it is the SAME constraint the server validates the
 *  submission with (`gre/categorizedPick.ts`), selected by `rule`:
 *
 *   - `"injective"` (`look-distribute`, and any optional categorized pick) —
 *     at most one buffered member per category, each claimable by only ONE.
 *   - `"cover"` (the mandatory `choose-categorized` offer) — every non-empty
 *     category must be ANSWERED, and one member may answer several at once (a
 *     dual land, a gold card). Here the count bounds are especially
 *     insufficient: `count.min` is the smallest COVERING set, so a buffer of
 *     the right size can still leave a category unanswered.
 *
 *  The hand/battlefield toggle (`board-hand-card.tsx`,
 *  `useBattlefieldVisualState.ts`) — unlike the richer library grid picker
 *  (`player-library.tsx`) — has no per-click categorized gate, so an
 *  in-bounds-COUNT-but-illegal buffer must be caught here or Done would
 *  submit a combination the server rejects. An empty buffer short-circuits
 *  the categorized check (declining is governed by `count.min` alone),
 *  mirroring the server's own submit path. Omitted (every non-categorized
 *  choice) — no extra check, unchanged behavior. */
export function isZonePickConfirmEnabled(
    count: PendingChoice["count"],
    selected: number,
    categorized?: {
        categories: NonNullable<PendingChoice["categories"]>;
        pickedIds: readonly string[];
        /** Defaults to the injective rule when omitted, matching every
         *  pre-#1945 caller and the server's own default. */
        rule?: "cover" | "injective";
    }
): boolean {
    if (
        selected < pendingChoiceMin(count) ||
        selected > pendingChoiceMax(count)
    ) {
        return false;
    }
    if (categorized && categorized.pickedIds.length > 0) {
        const legal =
            categorized.rule === "cover"
                ? isCategorizedCoverLegal(
                      categorized.categories,
                      categorized.pickedIds
                  )
                : isCategorizedPickLegal(
                      categorized.categories,
                      categorized.pickedIds
                  );
        if (!legal) return false;
    }
    return true;
}
