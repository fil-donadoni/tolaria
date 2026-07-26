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
    "choose-hand-card": "Choose",
    "choose-graveyard-card": "Return",
    // Dauthi Voidwalker (issue #1156) — pick an exiled card to grant a free
    // cast for.
    "choose-exile-card": "Choose",
    "choose-damage-target": "Choose target",
    // trigger-time player target (CR 115.1a — Endurance's "up to one target player")
    "choose-player": "Choose a player",
    "draw-look-keep": "Keep",
    // look-top (Stock Up / Preordain, #942) — look at the top N, pick a subset
    "look-top": "Look",
    // order-top (scry / surveil / ponder drag picker) — order the kept top cards
    "order-top": "Scry",
    // look-distribute (Impulse / Stock Up) — take N to hand, order the rest bottom
    "look-distribute": "Look",
    // legend rule (CR 704.5j)
    "legend-keep": "Legend rule",
    // non-cast Aura host choice (CR 303.4f — Replenish, Living Death)
    "choose-aura-host": "Choose host",
    // yes-no family
    "may-pay": "Optional",
    // land-entry pay-choice (CR 614.12, ADR 0051 — shock lands)
    "land-entry-tapped": "Pay 2 life",
    // order family
    "mulligan-bottom": "Mulligan",
    // simultaneous-trigger ordering (CR 603.3b, ADR 0058)
    "trigger-order": "Order triggers",
    // option family
    "option-pick": "Choose",
    // name-card family (CR 202.3)
    "name-card": "Name a card",
    // random-reveal family (CR 705, ADR 0023)
    "random-reveal": "Coin flip",
    // pile-division divide-then-choose family (ADR 0053)
    "divide-piles": "Divide into piles",
    "pick-pile": "Choose a pile",
    // reflexive Madness cast-choice (CR 702.35d)
    "madness-cast": "Madness",
    // reflexive Rebound cast-choice (CR 702.88a)
    "rebound-cast": "Rebound",
    // draw-reveal pay-choice (CR 614, issue #735 — Zur's Weirding)
    "draw-replacement": "Pay life",
};

export function pendingChoiceLabel(kind: PendingChoiceKind): string {
    return PENDING_CHOICE_KIND_LABELS[kind];
}
