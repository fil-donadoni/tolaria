import type { CardInstanceState } from "./state";

export type AttackerValidation =
    | { eligible: true }
    | { eligible: false; reason: string };

/** Validates whether a card instance is eligible to be declared as an attacker (CR 508.1a-d). */
export function validateAttackerEligibility(
    card: CardInstanceState
): AttackerValidation {
    if (!card.types.includes("Creature")) {
        return { eligible: false, reason: "Only creatures can attack" };
    }
    if (card.staticAbilities.includes("defender")) {
        return {
            eligible: false,
            reason: "Creatures with defender cannot attack",
        };
    }
    if (card.isTapped) {
        return { eligible: false, reason: "Tapped creatures cannot attack" };
    }
    if (card.isSummoningSick) {
        return { eligible: false, reason: "Creature has summoning sickness" };
    }
    return { eligible: true };
}
