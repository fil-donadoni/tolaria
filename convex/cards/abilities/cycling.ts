// `cyclingAbility` — declarative template for Cycling (CR 702.29), the keyword
// ability that lets a card be discarded from hand to draw a fresh one.
//
// CR 702.29a: "Cycling [cost]" means "[cost], Discard this card: Draw a card."
//   This activated ability functions only while this card is in your hand.
// CR 702.29b: A card with cycling may be cycled any time its owner could cast
//   an instant — i.e. any time they have priority (instant speed).
//
// Cycling is engine/cost-system infrastructure, NOT an Effect Script Op: only
// the ability's CAST-from-hand permission and discard-this cost are special;
// the on-resolution effect ("Draw a card") is a plain `draw` Op like any other.
// The special part rides two engine seams added for this keyword:
//   - `ActivatedAbility.activateFromHand` (twin of `activateFromGraveyard`) —
//     `activateAbility` locates the source in the owner's hand and gates on
//     this flag + ownership.
//   - `ActivatedAbility.cost.discardThis` — the source is discarded from hand
//     as the ability goes on the stack, routed through `discardToGraveyard`
//     (CR 701.8) so "whenever you discard" triggers fire (Marauding Mako).
//
// The Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) is the name
// authority: Cycling is row `id: "cycling"`, `binding: "cycling"`.

import type { ActivatedAbility, ManaCost } from "../types";

/** Renders a generic-only cycling cost as its `{N}` reminder-text label. Every
 *  card in this batch has a purely-generic cycling cost ({1}/{2}/{3}); a
 *  coloured cost would need a fuller mana-symbol renderer, which the callers
 *  don't need yet. */
function cyclingCostLabel(cost: ManaCost): string {
    const generic = cost.generic ?? 0;
    return `{${generic}}`;
}

/** Builds the Cycling activated ability (CR 702.29) for a card whose printed
 *  cycling cost is `cost` (a mana cost). Add the returned ability to the card's
 *  `activatedAbilities`. The ability is usable only from hand
 *  (`activateFromHand`), pays `cost` + discards the source (`discardThis`), and
 *  resolves by drawing a card. Instant speed by default (CR 702.29b). */
export function cyclingAbility(
    cost: ManaCost,
    id = "cycling"
): ActivatedAbility {
    const label = cyclingCostLabel(cost);
    return {
        id,
        oracleText: `Cycling ${label} (${label}, Discard this card: Draw a card.)`,
        // CR 702.29a — the cost is the printed cycling mana cost plus discarding
        // this card. `discardThis` moves the source hand → graveyard at commit.
        cost: { mana: cost, discardThis: true },
        // CR 702.29a — the ability functions only while the card is in hand.
        activateFromHand: true,
        // CR 605 — this is NOT a mana ability; it uses the stack (can be
        // responded to) and its effect is a one-shot draw.
        useStack: true,
        // CR 702.29a — "Draw a card." Authored as a plain Effect Script Op; the
        // cost (mana + discard-this) is the only cycling-specific part.
        effects: [{ op: "draw", player: "controller", count: 1 }],
    };
}
