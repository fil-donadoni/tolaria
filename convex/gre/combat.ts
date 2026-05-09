import type { CardInstanceState } from "./state";
import { LANDWALK_KEYWORDS } from "./constants";
import { isProtectedFromSource } from "./protection";

export type AttackerValidation =
    | { eligible: true }
    | { eligible: false; reason: string };

/** Validates whether a card instance is eligible to be declared as an attacker
 *  (CR 508.1a-d). `defenderBattlefield` (CR 508.1c) lets the check evaluate
 *  conditional restrictions whose predicate depends on the defending player's
 *  permanents (Sea Serpent: "can't attack unless defending player controls an
 *  Island"). When omitted the conditional checks are skipped — call sites
 *  that don't yet plumb the defender battlefield retain the previous
 *  behavior, which only matters for the few cards that carry such
 *  restrictions. */
export function validateAttackerEligibility(
    card: CardInstanceState,
    defenderBattlefield?: CardInstanceState[]
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
    if (defenderBattlefield) {
        // CR 508.1c — conditional attack restriction. Sea Serpent: "can't
        // attack unless defending player controls an Island." Encoded as a
        // `cant-attack-unless-defender-controls-<Subtype>` static ability so
        // additional cards with the same shape (Merfolk of the Pearl Trident
        // variants, Reef Pirates, etc.) can opt in by changing the subtype.
        for (const ability of card.staticAbilities) {
            const match = ability.match(
                /^cant-attack-unless-defender-controls-(.+)$/
            );
            if (!match) continue;
            const requiredSubtype = match[1];
            const ok = defenderBattlefield.some((c) =>
                c.subtypes.includes(requiredSubtype)
            );
            if (!ok) {
                return {
                    eligible: false,
                    reason: `${card.card.name as string} can't attack unless defending player controls a ${requiredSubtype}`,
                };
            }
        }
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

    // Subtype-based block restriction (CR 509.1b). Juggernaut: "This creature
    // can't be blocked by Walls." Generalizable to other subtype restrictions
    // via `cant-be-blocked-by-<subtype>` static ability strings.
    if (
        attacker.staticAbilities.includes("cant-be-blocked-by-wall") &&
        blocker.subtypes.includes("Wall")
    ) {
        return {
            eligible: false,
            reason: "Attacker can't be blocked by Walls",
        };
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

    // CR 702.16f: an attacking creature with "protection from [color]" can't
    // be blocked by creatures of that color.
    if (isProtectedFromSource(attacker, blocker)) {
        return {
            eligible: false,
            reason: "Attacker has protection from this blocker",
        };
    }

    return { eligible: true };
}

/**
 * True if `card` is subject to an "attacks each combat if able" requirement
 * (CR 508.1d) and is currently eligible to attack. Creatures with the
 * requirement but no legal attack (tapped, sick, defender, etc.) are not
 * required — CR 508.1d only forces requirements that can be obeyed.
 */
export function mustAttack(
    card: CardInstanceState,
    defenderBattlefield?: CardInstanceState[]
): boolean {
    if (!card.staticAbilities.includes("attacks-if-able")) return false;
    return validateAttackerEligibility(card, defenderBattlefield).eligible;
}

/** Ids of creatures on `battlefield` that are required to attack this combat. */
export function getRequiredAttackerIds(
    battlefield: CardInstanceState[],
    defenderBattlefield?: CardInstanceState[]
): string[] {
    return battlefield
        .filter((c) => mustAttack(c, defenderBattlefield))
        .map((c) => c.id);
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
