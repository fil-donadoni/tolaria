// uds — green cards (ADR 0043 colour split).
import type { CardDefinition, ManaCost } from "../../types";
import { manaCostForCardId } from "../../manaCostLookup";

/** CR 105.2 / 202.2 — is a card with this mana cost black? A normal, Phyrexian
 *  or hybrid `{B}` pip each makes it so. The same reading as
 *  `getColorsFromCost` (`cards/colors.ts`), inlined because importing that
 *  module pulls `gre/constants → cards/index` and closes the set ↔ registry
 *  eval-time cycle (the arn/white.ts `permanentColors` precedent). Colour
 *  indicators are not modelled on `CardDefinition` at all, so a cost-derived
 *  colour is the engine's whole notion of a card's colour. */
function costIsBlack(cost: ManaCost | undefined): boolean {
    if (!cost) return false;
    return (
        (cost.B ?? 0) > 0 ||
        (cost.phyrexian?.B ?? 0) > 0 ||
        (cost.hybrid ?? []).some((pip) => pip.includes("B"))
    );
}

// Compost — {1}{G} Enchantment. "Whenever a black card is put into an opponent's
// graveyard from anywhere, you may draw a card."
//
// "From anywhere" is one Oracle line over the FIVE ways the engine moves a card
// into a graveyard, so ONE ability listens on the four events that partition
// them (CR 603.2 — Worldspine Wurm's shape, rtr/green.ts): PERMANENT_LEFT
// (battlefield → graveyard, every permanent type, not just creatures),
// CARD_DISCARDED (CR 701.9), CARD_MILLED (CR 701.17) and CARD_PUT_INTO_GRAVEYARD
// (the residual general move, AND a spell card leaving the stack — resolved,
// countered or fizzled — which is the Duress-into-the-bin case this card exists
// for). CR 603.6c: a "from anywhere" trigger is never a leaves-the-battlefield
// ability, so it looks at the card in the graveyard it reached, not back in time:
// the card must be there (a CR 614 exile redirect means it never arrived), must
// be a CARD (a token is not one — CR 111.7 lets it reach the graveyard only until
// the next state-based check), and must be black by its own cost there.
// "An opponent's graveyard" is the owner's graveyard (CR 400.3), so the owner
// must not be Compost's controller.
//
// The "you may" is the cost-free `mayPay` decision (issue #680), Verduran
// Enchantress's shape (lea/green.ts).
// hand-tail: "Whenever a black card is put into an opponent's graveyard from anywhere, you may draw a card." (#4195)
export const compost: CardDefinition = {
    id: "2523c403-0025-48c7-8ff1-e66ca27ee585", // UDS 102
    rarity: "uncommon",
    name: "Compost",
    oracleText:
        "Whenever a black card is put into an opponent's graveyard from anywhere, you may draw a card.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "compost-draw",
            oracleText:
                "Whenever a black card is put into an opponent's graveyard from anywhere, you may draw a card.",
            event: [
                "PERMANENT_LEFT",
                "CARD_DISCARDED",
                "CARD_MILLED",
                "CARD_PUT_INTO_GRAVEYARD",
            ],
            matches: (event, self, state) => {
                let ownerId: string;
                let cardInstanceId: string;
                if (event.type === "PERMANENT_LEFT") {
                    if (event.toZone !== "graveyard") return false;
                    ownerId = event.ownerId;
                    cardInstanceId = event.instanceId;
                } else if (event.type === "CARD_DISCARDED") {
                    ownerId = event.playerId;
                    cardInstanceId = event.cardInstanceId;
                } else if (
                    event.type === "CARD_MILLED" ||
                    event.type === "CARD_PUT_INTO_GRAVEYARD"
                ) {
                    ownerId = event.ownerId;
                    cardInstanceId = event.cardInstanceId;
                } else {
                    return false;
                }
                if (ownerId === self.controllerId) return false;
                const landed = state?.players
                    .find((p) => p.id === ownerId)
                    ?.graveyard?.find((c) => c.id === cardInstanceId);
                if (landed === undefined) return false;
                // The trigger scan hands over the real `GameState`, typed
                // narrower as the view: the token flag and the card id ride on
                // the graveyard instance at runtime.
                const raw = landed as {
                    isToken?: boolean;
                    card?: { id?: string };
                };
                if (raw.isToken) return false;
                const cardId = raw.card?.id;
                return (
                    cardId !== undefined &&
                    costIsBlack(manaCostForCardId(cardId))
                );
            },
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Draw a card (Compost)?",
                    bind: "$draw",
                },
                {
                    op: "if",
                    predicate: { binding: "$draw" },
                    then: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        },
    ],
};
