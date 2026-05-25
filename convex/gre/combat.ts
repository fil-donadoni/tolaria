import type { CardInstanceState, GameState } from "./state";
import type { StaticBlockRestriction } from "../cards/types";
import { LANDWALK_KEYWORDS } from "./constants";
import { isProtectedFromSource } from "./protection";
import { getEffectivePower } from "./layers";
import { hasColor } from "./rules";
import { tryGetCardById } from "../cards";
import { evaluateBlockerKeywords } from "./combatRegistry";

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
                const def = tryGetCardById(card.card.id as string);
                const name = def?.name ?? "Creature";
                return {
                    eligible: false,
                    reason: `${name} can't attack unless defending player controls a ${requiredSubtype}`,
                };
            }
        }
    }
    return { eligible: true };
}

export type BlockerValidation =
    | { eligible: true }
    | { eligible: false; reason: string };

/** Collects `block-restriction` static effects from a card's definition
 *  and from any auras attached to it (CR 303.4 — aura effects apply to
 *  their host). Requires `state` to discover attached auras; without state
 *  only the card's own restrictions are returned. */
function collectBlockRestrictions(
    card: CardInstanceState,
    side: "attacker" | "blocker",
    state?: GameState
): StaticBlockRestriction[] {
    const restrictions: StaticBlockRestriction[] = [];
    const collect = (cardId: string | undefined) => {
        if (!cardId) return;
        const def = tryGetCardById(cardId);
        if (!def?.staticEffects) return;
        for (const effect of def.staticEffects) {
            if (effect.kind === "block-restriction" && effect.side === side) {
                restrictions.push(effect);
            }
        }
    };
    collect((card.card as { id?: string }).id);
    if (state) {
        for (const player of state.players) {
            for (const perm of player.battlefield) {
                if (perm.attachedTo !== card.id) continue;
                collect((perm.card as { id?: string }).id);
            }
        }
    }
    return restrictions;
}

/**
 * Validates whether `blocker` can be legally assigned to block `attacker`
 * given the defending player's battlefield. Covers evasion abilities:
 *  - Flying (CR 702.9b): only flying/reach can block a flier.
 *  - Landwalk (CR 702.13b): attacker can't be blocked at all as long as
 *    the defender controls a land of the matching subtype.
 *  - Unblockable (CR 509.1b): no creature can block.
 *  - Wall-only (Invisibility, CR 509.1b): only Walls can block.
 *  - Fear (CR 702.36b): only artifact and/or black creatures can block.
 *  - Power-bound block restriction (Ironclaw Orcs, CR 509.1b): blocker
 *    can't block creatures with effective power ≥ 2.
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
    // CR 509.1b — global "can't be blocked" (Dwarven Warriors temporary
    // grant). Encoded as an `unblockable` static ability that may be granted
    // for end-of-turn via `grantStaticAbility`.
    if (attacker.staticAbilities.includes("unblockable")) {
        return {
            eligible: false,
            reason: "Attacker can't be blocked",
        };
    }

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

    // CR 702.36b — Fear: "This creature can't be blocked except by artifact
    // creatures and/or black creatures." Color check uses hasColor so
    // hybrid / multicolor blockers including Black still count.
    if (
        attacker.staticAbilities.includes("fear") &&
        !blocker.types.includes("Artifact") &&
        !hasColor(blocker, "B")
    ) {
        return {
            eligible: false,
            reason: "Attacker has fear — only artifact or black creatures can block",
        };
    }

    // CR 702.9b+ — keyword-level evasion rules (registry-driven).
    const keywordResult = evaluateBlockerKeywords(
        attacker,
        blocker,
        defenderBattlefield
    );
    if (!keywordResult.eligible) return keywordResult;

    // CR 509.1b — card-level block restrictions from staticEffects[].
    const attackerRestrictions = collectBlockRestrictions(
        attacker,
        "attacker",
        state
    );
    const blockerRestrictions = collectBlockRestrictions(
        blocker,
        "blocker",
        state
    );
    if (attackerRestrictions.length > 0 || blockerRestrictions.length > 0) {
        const effAttacker = state
            ? { ...attacker, power: getEffectivePower(state, attacker) }
            : attacker;
        const effBlocker = state
            ? { ...blocker, power: getEffectivePower(state, blocker) }
            : blocker;
        for (const r of attackerRestrictions) {
            if (!r.predicate(effAttacker, effBlocker, state)) {
                return { eligible: false, reason: r.oracleText };
            }
        }
        for (const r of blockerRestrictions) {
            if (!r.predicate(effBlocker, effAttacker, state)) {
                return { eligible: false, reason: r.oracleText };
            }
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
