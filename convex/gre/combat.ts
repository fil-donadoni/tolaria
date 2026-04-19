import type { CardInstanceState } from "./state";
import { LANDWALK_KEYWORDS } from "./constants";

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

export type BlockerValidation =
    | { eligible: true }
    | { eligible: false; reason: string };

/**
 * Validates whether `blocker` can be legally assigned to block `attacker`
 * given the defending player's battlefield. Covers evasion abilities:
 *  - Flying (CR 702.9b): only flying/reach can block a flier.
 *  - Landwalk (CR 702.13b): attacker can't be blocked at all as long as
 *    the defender controls a land of the matching subtype.
 */
export function validateBlockerEligibility(
    attacker: CardInstanceState,
    blocker: CardInstanceState,
    defenderBattlefield: CardInstanceState[]
): BlockerValidation {
    for (const [keyword, subtype] of Object.entries(LANDWALK_KEYWORDS)) {
        if (!attacker.staticAbilities.includes(keyword)) continue;
        const hasLand = defenderBattlefield.some(
            (card) =>
                card.types.includes("Land") && card.subtypes.includes(subtype)
        );
        if (hasLand) {
            return {
                eligible: false,
                reason: `Attacker can't be blocked while defender controls a ${subtype}`,
            };
        }
    }

    if (attacker.staticAbilities.includes("flying")) {
        if (
            !blocker.staticAbilities.includes("flying") &&
            !blocker.staticAbilities.includes("reach")
        ) {
            return {
                eligible: false,
                reason: "Only creatures with flying or reach can block a creature with flying",
            };
        }
    }

    return { eligible: true };
}

/**
 * True if the defender has at least one creature that can legally block at
 * least one declared attacker. Used by the phase engine to auto-skip
 * DECLARE_BLOCKERS when every attacker is unblockable (e.g. all attackers
 * have evasion the defender can't beat).
 */
export function hasAnyLegalBlock(
    attackers: CardInstanceState[],
    defenderBattlefield: CardInstanceState[]
): boolean {
    const candidates = defenderBattlefield.filter(
        (c) => c.types.includes("Creature") && !c.isTapped
    );
    for (const attacker of attackers) {
        for (const blocker of candidates) {
            if (
                validateBlockerEligibility(
                    attacker,
                    blocker,
                    defenderBattlefield
                ).eligible
            ) {
                return true;
            }
        }
    }
    return false;
}
