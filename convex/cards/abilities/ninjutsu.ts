// `ninjutsuAbility` — the declarative template for Ninjutsu (CR 702.49), the
// keyword ability that swaps an unblocked attacker for a bigger threat after
// blockers are declared.
//
// CR 702.49a: "Ninjutsu [cost]" means "[Cost], Reveal this card from your hand,
//   Return an unblocked attacking creature you control to its owner's hand: Put
//   this card onto the battlefield from your hand tapped and attacking."
//   Ninjutsu is an activated ability that functions only while the card with
//   ninjutsu is in a player's hand.
// CR 702.49b: The card with ninjutsu remains revealed from the time the ability
//   is announced until the ability leaves the stack.
// CR 702.49c: The creature put onto the battlefield with the ninjutsu ability
//   enters attacking the same player, planeswalker, or battle as the creature
//   that was returned to its owner's hand.
//
// It is an ACTIVATED ability — announced, on the stack, respondable — not a
// special action, so this is an ordinary `ActivatedAbility` built from seams
// that already existed, in the shape `cyclingAbility` established for the other
// from-hand keyword (CR 702.29a):
//
//   - `activateFromHand: true` (CR 702.49a's "functions only while in hand"),
//   - `cost.returnUnblockedAttacker` for the return leg, paid through the one
//     unified give-up-a-permanent selection layer so the payer chooses WHICH
//     attacker goes back (`gre/ninjutsu.ts`),
//   - a plain Effect Script body: `moveZone` from the hand carrier, `tapped`
//     and `attacking`.
//
// The REVEAL leg (CR 702.49a/b) is `markKnownToAll` at commit rather than a
// cost flag of its own: revealing grants knowledge and nothing else, and
// knowledge in this engine is per-viewer and monotonic (ADR 0026), so there is
// no state to undo when the ability leaves the stack — CR 702.49b's window ends
// but what the opponents saw, they saw.
//
// CR 702.49d (COMMANDER ninjutsu, the command-zone variant) is out of scope:
// this engine models no command zone, so the variant has no zone to function
// from. Not a divergence in the shipped rule — a rule with no surface here.
//
// The Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) is the name
// authority: Ninjutsu is row `id: "ninjutsu"`.

import type { ActivatedAbility, ManaCost } from "../types";
import { MANA_COLORS } from "../../gre/constants";

/** Renders a ninjutsu cost as its reminder-text label ("{2}{U}{B}"). Generic
 *  first, then one symbol per coloured pip — the printed order every ninjutsu
 *  cost uses. Deliberately narrow, exactly as `cyclingCostLabel` is: no printed
 *  ninjutsu cost carries a hybrid or Phyrexian pip, and a label renderer that
 *  silently dropped one would be worse than one that never claimed to handle
 *  it. */
function ninjutsuCostLabel(cost: ManaCost): string {
    const generic = (cost.X as number | undefined) ?? 0;
    const parts = generic > 0 ? [`{${generic}}`] : [];
    for (const color of MANA_COLORS) {
        for (let i = 0; i < ((cost[color] as number | undefined) ?? 0); i++) {
            parts.push(`{${color}}`);
        }
    }
    return parts.join("");
}

/** The default ability id. A card never prints two ninjutsu abilities, so it
 *  stays unique per card. */
const NINJUTSU_ABILITY_ID = "ninjutsu";

/** Builds the Ninjutsu activated ability (CR 702.49a) for a card whose printed
 *  ninjutsu cost is `cost`. Add the returned ability to the card's
 *  `activatedAbilities`.
 *
 *  Usable only from hand (`activateFromHand`); pays `cost` plus returning an
 *  unblocked attacking creature its controller controls; resolves by putting
 *  the source onto the battlefield tapped and attacking the defender the
 *  returned creature was attacking (CR 702.49c). Instant speed — the ability
 *  carries no phase restriction, because its own cost cannot be paid before
 *  blockers are declared (CR 509.1h). */
export function ninjutsuAbility(
    cost: ManaCost,
    id = NINJUTSU_ABILITY_ID
): ActivatedAbility {
    const label = ninjutsuCostLabel(cost);
    return {
        id,
        oracleText: `Ninjutsu ${label} (${label}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.)`,
        // CR 702.49a — the printed ninjutsu mana cost plus the return leg. The
        // reveal is paid at commit (see the module note above).
        cost: { mana: cost, returnUnblockedAttacker: true },
        // CR 702.49a — functions only while this card is in its owner's hand.
        activateFromHand: true,
        // CR 605.1a — not a mana ability: it uses the stack and can be
        // responded to (CR 702.49b names the stack explicitly).
        useStack: true,
        // CR 702.49a — "Put this card onto the battlefield from your hand
        // tapped and attacking." The hand-source `moveZone` shape; `attacking`
        // consumes the defender stamped by the cost payment (CR 702.49c).
        effects: [
            {
                op: "moveZone",
                target: { ref: "$source" },
                // CR 702.49a — "from your hand", declared rather than inferred
                // (see the shape's doc in cards/types.ts).
                from: "hand",
                to: "battlefield",
                tapped: true,
                attacking: true,
            },
        ],
    };
}
