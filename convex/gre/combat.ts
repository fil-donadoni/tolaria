import type { CardInstanceState, GameState } from "./state";
import { isProtectedFromSource } from "./protection";
import { getEffectivePower } from "./layers";
import { getCardById } from "../cards";
import {
    evaluateBlockerKeywords,
    evaluateAttackerKeywords,
} from "./combatRegistry";

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
    // CR 702.3a+ — keyword-level attack restrictions (registry-driven).
    const keywordResult = evaluateAttackerKeywords(card);
    if (!keywordResult.eligible) return keywordResult;
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
                    reason: `${getCardById(card.card.id as string).name} can't attack unless defending player controls a ${requiredSubtype}`,
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
 * given the defending player's battlefield. Evaluation order:
 *  1. Keyword-level evasion (registry): unblockable, landwalk, fear, flying.
 *  2. Card-specific string restrictions: Wall-only, cant-be-blocked-by-wall,
 *     power-bound (migrating to StaticEffect in S2).
 *  3. Protection (CR 702.16f).
 *
 * `state` is optional — required only for the power-bound restriction so
 * the validator can call `getEffectivePower(state, attacker)` (CR 613 layer
 * 7c). Callers without state degrade gracefully to `attacker.power ?? 0`.
 */
export function validateBlockerEligibility(
    attacker: CardInstanceState,
    blocker: CardInstanceState,
    defenderBattlefield: CardInstanceState[],
    state?: GameState
): BlockerValidation {
    // Pass 1 — keyword-level evasion (registry-driven).
    // Covers: unblockable (509.1b), landwalk (702.13b), fear (702.36b),
    // flying (702.9b).
    const keywordResult = evaluateBlockerKeywords(
        attacker,
        blocker,
        defenderBattlefield
    );
    if (!keywordResult.eligible) return keywordResult;

    // Pass 2 — card-specific string restrictions (migrating to
    // StaticEffect block-restriction in S2).

    // CR 509.1b — Juggernaut: "This creature can't be blocked by Walls."
    if (
        attacker.staticAbilities.includes("cant-be-blocked-by-wall") &&
        blocker.subtypes.includes("Wall")
    ) {
        return {
            eligible: false,
            reason: "Attacker can't be blocked by Walls",
        };
    }

    // CR 509.1b — Invisibility-style "can be blocked only by Walls".
    if (
        attacker.staticAbilities.includes("cant-be-blocked-except-by-wall") &&
        !blocker.subtypes.includes("Wall")
    ) {
        return {
            eligible: false,
            reason: "Attacker can be blocked only by Walls",
        };
    }

    // CR 509.1b — Ironclaw Orcs: "can't block creatures with power 2 or
    // greater." Predicate is on the blocker; reads the attacker's effective
    // power so layer-7c buffs (Crusade, Bad Moon, etc.) are honored.
    if (blocker.staticAbilities.includes("cant-block-power-2-or-greater")) {
        const power = state
            ? getEffectivePower(state, attacker)
            : (attacker.power ?? 0);
        if (power >= 2) {
            return {
                eligible: false,
                reason: "Blocker can't block creatures with power 2 or greater",
            };
        }
    }

    // Pass 3 — protection (CR 702.16f).
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
    defenderBattlefield: CardInstanceState[],
    state?: GameState
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
                    defenderBattlefield,
                    state
                ).eligible
            ) {
                return true;
            }
        }
    }
    return false;
}
