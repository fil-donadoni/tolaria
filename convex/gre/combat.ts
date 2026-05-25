import type { CardInstanceState, GameState } from "./state";
import type {
    StaticAttackRestriction,
    StaticBlockRestriction,
} from "../cards/types";
import { isProtectedFromSource } from "./protection";
import { getEffectivePower } from "./layers";
import { tryGetCardById } from "../cards";
import {
    evaluateBlockerKeywords,
    evaluateAttackerKeywords,
} from "./combatRegistry";

export type AttackerValidation =
    | { eligible: true }
    | { eligible: false; reason: string };

/** Collects `attack-restriction` static effects from a card's definition
 *  (CR 508.1c). Mirrors `collectBlockRestrictions` — reads the card
 *  definition via the registry. */
function collectAttackRestrictions(
    card: CardInstanceState
): StaticAttackRestriction[] {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return [];
    const def = tryGetCardById(cardId);
    if (!def?.staticEffects) return [];
    return def.staticEffects.filter(
        (e): e is StaticAttackRestriction => e.kind === "attack-restriction"
    );
}

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
    // CR 508.1c — card-level attack restrictions from staticEffects[].
    if (defenderBattlefield) {
        for (const r of collectAttackRestrictions(card)) {
            if (!r.predicate(card, defenderBattlefield)) {
                return { eligible: false, reason: r.oracleText };
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
 * given the defending player's battlefield. Evaluation order:
 *  1. Keyword-level evasion (registry): unblockable, landwalk, fear, flying.
 *  2. Card-level block restrictions from staticEffects[] (Juggernaut,
 *     Invisibility, Ironclaw Orcs, etc.) — predicate-driven via S2.
 *  3. Protection (CR 702.16f).
 *
 * `state` is optional — required for block-restriction predicates that check
 * effective P/T (CR 613 layer 7c). Without state, predicates degrade to
 * base P/T values.
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

    // Pass 2 — card-level block restrictions from staticEffects[] (S2).
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

    // Pass 3 — protection (CR 702.16f).
    if (isProtectedFromSource(attacker, blocker)) {
        return {
            eligible: false,
            reason: "Attacker has protection from this blocker",
        };
    }

    return { eligible: true };
}

/** True if `card` carries an `attack-requirement` static effect
 *  (CR 508.1d). Checked separately from eligibility so the engine can
 *  distinguish "must attack" from "can attack". */
function hasAttackRequirement(card: CardInstanceState): boolean {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return false;
    const def = tryGetCardById(cardId);
    if (!def?.staticEffects) return false;
    return def.staticEffects.some((e) => e.kind === "attack-requirement");
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
    if (!hasAttackRequirement(card)) return false;
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
