/**
 * Keyword Combat Registry — data-driven evasion & attack-restriction rules.
 *
 * Each keyword that affects combat eligibility is declared once as a typed
 * rule object. The engine iterates the registry instead of maintaining
 * per-keyword if-branches. Adding a new keyword means adding a registry
 * entry, not touching the engine loop.
 *
 * Architecture precedent: ADR 0005 (data-driven untap restrictions).
 * CR basis: 508.1 (attack eligibility), 509.1b (block eligibility).
 */

import type { CardInstanceState } from "./state";
import {
    LANDWALK_KEYWORDS,
    LANDWALK_SUPERTYPE_KEYWORDS,
    LANDWALK_SNOW_SUBTYPE_KEYWORDS,
} from "./constants";
import { hasColor } from "./rules";
import { applySubstitution } from "./textChanges";
import {
    controlsLandWithSupertype,
    negatedLandwalkSubtypes,
} from "../cards/landwalkNegation";
import { controlsSnowSubtype } from "./snow";

// ---------------------------------------------------------------------------
// Rule types
// ---------------------------------------------------------------------------

/** A keyword rule that restricts which creatures can block an attacker. */
export interface EvasionRule {
    /** Keyword string on the attacker's `staticAbilities`. */
    keyword: string;
    /** CR section reference. */
    cr: string;
    /** Returns `true` if `blocker` is eligible to block `attacker`.
     *  Called only when the attacker has this keyword. */
    canBlock: (
        attacker: CardInstanceState,
        blocker: CardInstanceState,
        defenderBattlefield: CardInstanceState[]
    ) => boolean;
    /** Human-readable reason when the block is rejected. */
    reason: string;
}

/** A keyword rule that restricts whether a creature can attack. */
export interface AttackRestrictionRule {
    /** Keyword string on the attacker's `staticAbilities`. */
    keyword: string;
    /** CR section reference. */
    cr: string;
    /** Returns `true` if the creature is eligible to attack.
     *  Called only when the creature has this keyword. */
    canAttack: (card: CardInstanceState) => boolean;
    /** Human-readable reason when the attack is rejected. */
    reason: string;
}

// ---------------------------------------------------------------------------
// Evasion rules registry (blocker eligibility)
// ---------------------------------------------------------------------------

// CR 509.1b — Unblockable: "This creature can't be blocked."
// Global short-circuit — no blocker qualifies.
const UNBLOCKABLE_RULE: EvasionRule = {
    keyword: "unblockable",
    cr: "509.1b",
    canBlock: () => false,
    reason: "Attacker can't be blocked",
};

// CR 702.13b — Landwalk: "A creature with [type]walk can't be blocked as
// long as the defending player controls a land of the specified subtype."
// One rule per variant, parameterized via LANDWALK_KEYWORDS.
//
// CR 509.1b / 702.13 — a `landwalk-negation` static on the defending player's
// battlefield (Great Wall, Undertow) suppresses the matching landwalk: the
// attacker can then be blocked as though it didn't have the keyword. We scan
// for that negation first and treat a negated subtype as "no evasion".
const LANDWALK_RULES: EvasionRule[] = Object.entries(LANDWALK_KEYWORDS).map(
    ([keyword, subtype]) => ({
        keyword,
        cr: "702.13b",
        canBlock: (
            _attacker: CardInstanceState,
            _blocker: CardInstanceState,
            defenderBattlefield: CardInstanceState[]
        ) => {
            // Negated (Great Wall / Undertow) → keyword grants no evasion.
            if (negatedLandwalkSubtypes(defenderBattlefield).has(subtype)) {
                return true;
            }
            // CR 612: read the text-change-rewritten subtypes so a land whose
            // type was changed (Magical Hack) is matched by the new word.
            return !defenderBattlefield.some(
                (c) =>
                    c.types.includes("Land") &&
                    applySubstitution(c).subtypes.includes(subtype)
            );
        },
        reason: `Attacker can't be blocked while defender controls a ${subtype}`,
    })
);

// CR 702.13 — Landwalk keyed on a land *supertype* ("legendary landwalk",
// Livonya Silone): the attacker can't be blocked while the defending player
// controls a land with the named supertype. Same evasion shape as subtype
// landwalk, but the match reads `supertypes` (CR 205.4) via the registry
// instead of the instance's substitution-rewritten subtypes. Text-change
// effects (CR 612) rewrite subtypes, not supertypes, so no `applySubstitution`
// pass is needed here.
const LANDWALK_SUPERTYPE_RULES: EvasionRule[] = Object.entries(
    LANDWALK_SUPERTYPE_KEYWORDS
).map(([keyword, supertype]) => ({
    keyword,
    cr: "702.13",
    canBlock: (
        _attacker: CardInstanceState,
        _blocker: CardInstanceState,
        defenderBattlefield: CardInstanceState[]
    ) => !controlsLandWithSupertype(defenderBattlefield, supertype),
    reason: `Attacker can't be blocked while defender controls a ${supertype} land`,
}));

// CR 702.13 / 205.4a — Snow landwalk ("snow swampwalk", "snow forestwalk"):
// the attacker can't be blocked while the defending player controls a SNOW
// land of the named subtype. Same shape as subtype landwalk, but the match
// additionally requires the live Snow supertype (`controlsSnowSubtype` reads
// `hasSnowSupertype`, so Melting / Arcum's Weathervane mutations are honored).
// Subtype landwalk negation (Great Wall / Undertow) doesn't name snow, so no
// negation pass is applied here.
const LANDWALK_SNOW_RULES: EvasionRule[] = Object.entries(
    LANDWALK_SNOW_SUBTYPE_KEYWORDS
).map(([keyword, subtype]) => ({
    keyword,
    cr: "702.13",
    canBlock: (
        _attacker: CardInstanceState,
        _blocker: CardInstanceState,
        defenderBattlefield: CardInstanceState[]
    ) => !controlsSnowSubtype(defenderBattlefield, subtype),
    reason: `Attacker can't be blocked while defender controls a snow ${subtype}`,
}));

// CR 702.36b — Fear: "This creature can't be blocked except by artifact
// creatures and/or black creatures."
const FEAR_RULE: EvasionRule = {
    keyword: "fear",
    cr: "702.36b",
    canBlock: (_attacker, blocker) =>
        blocker.types.includes("Artifact") || hasColor(blocker, "B"),
    reason: "Attacker has fear — only artifact or black creatures can block",
};

// CR 702.9b — Flying: "A creature with flying can't be blocked except by
// creatures with flying and/or reach."
const FLYING_RULE: EvasionRule = {
    keyword: "flying",
    cr: "702.9b",
    canBlock: (_attacker, blocker) =>
        blocker.staticAbilities.includes("flying") ||
        blocker.staticAbilities.includes("reach"),
    reason: "Only creatures with flying or reach can block a creature with flying",
};

export const EVASION_RULES: readonly EvasionRule[] = [
    UNBLOCKABLE_RULE,
    ...LANDWALK_RULES,
    ...LANDWALK_SUPERTYPE_RULES,
    ...LANDWALK_SNOW_RULES,
    FEAR_RULE,
    FLYING_RULE,
];

// ---------------------------------------------------------------------------
// Attack restriction rules registry (attacker eligibility)
// ---------------------------------------------------------------------------

// CR 702.3a — Defender: "A creature with defender can't attack." The
// turn-scoped `canAttackDespiteDefenderThisTurn` flag (FEM Vodalian War Machine:
// "can attack this turn as though it didn't have defender") overrides the rule
// for that one turn; the flag is cleared at CLEANUP.
const DEFENDER_RULE: AttackRestrictionRule = {
    keyword: "defender",
    cr: "702.3a",
    canAttack: (card) => card.canAttackDespiteDefenderThisTurn === true,
    reason: "Creatures with defender cannot attack",
};

export const ATTACK_RESTRICTION_RULES: readonly AttackRestrictionRule[] = [
    DEFENDER_RULE,
];

// ---------------------------------------------------------------------------
// Public evaluation API
// ---------------------------------------------------------------------------

export type BlockerKeywordResult =
    | { eligible: true }
    | { eligible: false; reason: string };

export type AttackerKeywordResult =
    | { eligible: true }
    | { eligible: false; reason: string };

/**
 * Evaluates keyword-level evasion rules from the registry.
 * Returns the first failing rule, or `{ eligible: true }` if all pass.
 *
 * This covers only keyword-level rules (flying, fear, landwalk, etc.).
 * Card-level `staticEffects` block-restrictions and protection are
 * evaluated separately by the caller.
 */
export function evaluateBlockerKeywords(
    attacker: CardInstanceState,
    blocker: CardInstanceState,
    defenderBattlefield: CardInstanceState[]
): BlockerKeywordResult {
    // CR 612: a text change can rewrite the attacker's landwalk keyword
    // (forestwalk → islandwalk), so match against the rewritten abilities.
    const attackerAbilities = applySubstitution(attacker).staticAbilities;
    for (const rule of EVASION_RULES) {
        if (!attackerAbilities.includes(rule.keyword)) continue;
        if (!rule.canBlock(attacker, blocker, defenderBattlefield)) {
            return { eligible: false, reason: rule.reason };
        }
    }
    return { eligible: true };
}

/**
 * Evaluates keyword-level attack restriction rules from the registry.
 * Returns the first failing rule, or `{ eligible: true }` if all pass.
 *
 * This covers only keyword-level rules (defender, etc.).
 * Card-level `staticEffects` attack-restrictions are evaluated
 * separately by the caller.
 */
export function evaluateAttackerKeywords(
    card: CardInstanceState
): AttackerKeywordResult {
    for (const rule of ATTACK_RESTRICTION_RULES) {
        if (!card.staticAbilities.includes(rule.keyword)) continue;
        if (!rule.canAttack(card)) {
            return { eligible: false, reason: rule.reason };
        }
    }
    return { eligible: true };
}
