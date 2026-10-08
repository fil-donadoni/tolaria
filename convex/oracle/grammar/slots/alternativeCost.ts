/**
 * Slot: a hand-pitch ALTERNATIVE COST line (CR 118.9).
 *
 * "You may exile a blue card from your hand rather than pay this spell's mana
 * cost." / "You may discard an Island card and another card rather than pay
 * this spell's mana cost." — a printed line of its own, on instants, sorceries
 * and permanents alike, so it is a slot and not a branch of the spell slot
 * (whose guard refuses a permanent). It is paid as the spell is CAST
 * (CR 601.2b), never on resolution, which is why it is not an effect sentence.
 *
 * ── What is read ───────────────────────────────────────────────────────────
 *
 * Exactly the two HAND legs `CostLegs.hand` can pay (CR 701.9 discard /
 * CR 701.13 exile) in the two shapes the corpus prints:
 *
 *   - "exile a <colour> card from your hand"      (Force of Will family)
 *   - "discard an Island card and another card"   (Foil)
 *
 * ── What is refused, and why ───────────────────────────────────────────────
 *
 * Everything else, fail-closed. In particular the neighbours the engine has no
 * surface for: an exile leg over the GRAVEYARD ("exile the top three black
 * cards of your graveyard" — `CostLegs` has no graveyard leg), a REVEAL cost
 * with a hand-contents condition ("If you have no land cards in hand, you may
 * reveal your hand" — `AlternativeCostCondition` has no such member), a
 * life-plus-pitch cost and a turn-gated one (separate printed forms, separate
 * gaps).
 */

import { COLOR_WORDS } from "../shared/targetFilter";
import { fail, ok, pattern, type Rule } from "../../rule";
import type { AlternativeCostIR, SlotIR } from "../ir";

export const ALTERNATIVE_COST_SLOT = "alternative-cost";

const ALTERNATIVE_COST =
    /^You may (.+) rather than pay this spell's mana cost\.$/;

/** CR 701.13 — "exile a <colour> card from your hand". */
const EXILE_COLOURED = /^exile an? (\w+) card from your hand$/;

/** CR 701.9 — Foil's two-requirement discard, Island first (see the greedy-
 *  ordering constraint on `CostLegs.hand`). */
const DISCARD_ISLAND_AND_CARD = "discard an Island card and another card";

function readBody(body: string): AlternativeCostIR | null {
    if (body === DISCARD_ISLAND_AND_CARD)
        return {
            id: "pitch-discard-island-and-card",
            description: "Discard an Island card and another card",
            hand: {
                action: "discard",
                requirements: [
                    { filter: { subtype: "Island" }, count: 1 },
                    { filter: {}, count: 1 },
                ],
            },
        };
    const exile = EXILE_COLOURED.exec(body);
    if (exile !== null) {
        const colour = COLOR_WORDS.get(exile[1]!);
        if (colour === undefined) return null;
        return {
            id: `pitch-exile-${exile[1]}`,
            description: `Exile ${body.slice("exile ".length)}`,
            hand: {
                action: "exile",
                requirements: [{ filter: { color: colour }, count: 1 }],
            },
        };
    }
    return null;
}

export const alternativeCostSlot: Rule<SlotIR> = pattern<SlotIR>(
    ALTERNATIVE_COST_SLOT,
    ALTERNATIVE_COST,
    (match, span) => {
        const cost = readBody(match[1]!);
        if (cost === null)
            return fail(
                `"${match[1]}" is not an alternative cost this grammar reads (CR 118.9)`,
                span
            );
        return ok({ kind: "alternative-cost" as const, cost });
    }
);
