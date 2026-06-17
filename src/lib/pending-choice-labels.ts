import type { PendingChoiceKind } from "@convex/gre/types";

/** UI label shown as the source tag on a pending choice prompt
 *  (the bold leading word, e.g. "Sacrifice — choose ...").
 *
 *  Exhaustive `Record<PendingChoiceKind, ...>` typing — adding a new kind
 *  without an entry here is a compile error, so the UI stays in sync with
 *  the engine taxonomy. */
const PENDING_CHOICE_KIND_LABELS: Record<PendingChoiceKind, string> = {
    // zone-pick family
    "keep-permanents": "Keep",
    "sacrifice-permanents": "Sacrifice",
    "keep-hand": "Keep in hand",
    "search-library": "Search",
    "pick-source": "Pick source",
    "untap-pick": "Untap step",
    "discard-hand": "Discard",
    "reorder-library": "Reorder",
    "reveal-hand": "Reveal",
    "choose-permanents": "Choose",
    partition: "Divide",
    "choose-hand-card": "Cast face down",
    "choose-damage-target": "Choose target",
    // yes-no family
    "may-pay": "Optional",
    // order family
    "mulligan-bottom": "Mulligan",
};

export function pendingChoiceLabel(kind: PendingChoiceKind): string {
    return PENDING_CHOICE_KIND_LABELS[kind];
}
