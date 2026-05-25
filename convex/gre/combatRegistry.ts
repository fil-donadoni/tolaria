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

// ---------------------------------------------------------------------------
// Evasion rules registry (blocker eligibility)
// ---------------------------------------------------------------------------

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

export const EVASION_RULES: readonly EvasionRule[] = [FLYING_RULE];

// ---------------------------------------------------------------------------
// Public evaluation API
// ---------------------------------------------------------------------------

export type BlockerKeywordResult =
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
    for (const rule of EVASION_RULES) {
        if (!attacker.staticAbilities.includes(rule.keyword)) continue;
        if (!rule.canBlock(attacker, blocker, defenderBattlefield)) {
            return { eligible: false, reason: rule.reason };
        }
    }
    return { eligible: true };
}
