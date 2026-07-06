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
    "choose-graveyard-card": "Return",
    "choose-damage-target": "Choose target",
    "draw-look-keep": "Keep",
    // legend rule (CR 704.5j)
    "legend-keep": "Legend rule",
    // yes-no family
    "may-pay": "Optional",
    // land-entry pay-choice (CR 614.12, ADR 0051 — shock lands)
    "land-entry-tapped": "Pay 2 life",
    // order family
    "mulligan-bottom": "Mulligan",
    // option family
    "option-pick": "Choose",
    // name-card family (CR 202.3)
    "name-card": "Name a card",
    // random-reveal family (CR 705, ADR 0023)
    "random-reveal": "Coin flip",
};

export function pendingChoiceLabel(kind: PendingChoiceKind): string {
    return PENDING_CHOICE_KIND_LABELS[kind];
}
