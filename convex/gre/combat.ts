import type { CardInstanceState, GameState } from "./state";
import type {
    PermanentView,
    StaticAttackRestriction,
    StaticBlockRestriction,
    StaticBlockRequirement,
} from "../cards/types";
import { isProtectedFromSource } from "./protection";
import { getEffectivePower } from "./layers";
import { tryGetCardById } from "../cards";
import { globalAttackProhibitionReason } from "../cards/attackRestrictions";
import {
    evaluateBlockerKeywords,
    evaluateAttackerKeywords,
} from "./combatRegistry";

/** Card definition ids of the Legends World enchantments that impose global
 *  combat caps / conditional attack restrictions (cluster C9, #386). Kept here
 *  so the engine recognises them without a string-parsing pass — they carry no
 *  per-card predicate, the rule is global. */
export const CAVERNS_OF_DESPAIR_ID = "209f7479-b3a0-4c27-9602-78babb8d2e99";
export const ARBORIA_ID = "095078b0-0f26-442f-9d3b-45e30cdb33c4";

/** True when any permanent with the given card id is on any player's
 *  battlefield. Used for global World-enchantment effects (CR 109.2 — the
 *  effect applies regardless of controller). */
function isCardOnBattlefield(state: GameState, cardId: string): boolean {
    return state.players.some((p) =>
        p.battlefield.some((c) => (c.card as { id?: string }).id === cardId)
    );
}

/** Caverns of Despair (CR 508.1a / 509.1a) — the global cap on how many
 *  creatures may be declared as attackers each combat. Returns the cap (2)
 *  when a Caverns of Despair is in play, else `undefined` (no cap). */
export function getAttackerCap(state: GameState): number | undefined {
    return isCardOnBattlefield(state, CAVERNS_OF_DESPAIR_ID) ? 2 : undefined;
}

/** Caverns of Despair (CR 509.1a) — the global cap on how many creatures may
 *  be declared as blockers each combat. Returns the cap (2) when a Caverns of
 *  Despair is in play, else `undefined` (no cap). */
export function getBlockerCap(state: GameState): number | undefined {
    return isCardOnBattlefield(state, CAVERNS_OF_DESPAIR_ID) ? 2 : undefined;
}

/** Generic minimum-blocker threshold (CR 509.1b, 702.111 menace).
 *
 *  Some evasion keywords don't forbid a blocker outright — they impose a
 *  MINIMUM on how many creatures must block the attacker together. Menace
 *  (CR 702.111a) sets that minimum to two ("can't be blocked except by two or
 *  more creatures"). The threshold is deliberately a single generic number so
 *  future "can't be blocked except by three or more creatures" variants reuse
 *  the same `confirmBlockers` enforcement path — they only raise this number.
 *
 *  Returns the per-attacker minimum number of blockers (default 1, i.e. no
 *  constraint). Reads the attacker instance's effective `staticAbilities`,
 *  which already include keywords granted by anthems such as Goblin War Drums
 *  (the grant is pushed into `staticAbilities` imperatively when the source
 *  resolves — see `applySourceStaticEffects`). */
export function getMinimumBlockers(attacker: CardInstanceState): number {
    // CR 702.111a — menace. If multiple "two or more" / "three or more"
    // keywords ever stack, the highest minimum wins (CR 509.1b applies every
    // restriction). Today only menace exists.
    if (attacker.staticAbilities.includes("menace")) return 2;
    return 1;
}

/** Validates the COMPLETE set of declared blocks against every attacker's
 *  minimum-blocker threshold (CR 509.1b). Unlike pairwise blocker eligibility,
 *  a minimum constraint can only be judged once all blocks are known: an
 *  attacker with menace blocked by exactly one creature is an ILLEGAL block
 *  declaration (CR 509.1c), but the same single block is a legal intermediate
 *  state while the defender is still assigning. Hence this runs at confirm
 *  time, not at per-blocker assignment time.
 *
 *  `blockerAssignments` maps blockerId → the attacker ids it blocks. An
 *  attacker is "blocked" by N distinct creatures; the declaration is legal
 *  only when N is 0 (unblocked) or N ≥ the attacker's minimum. */
export function validateMinimumBlockers(
    state: GameState
): { ok: true } | { ok: false; reason: string } {
    const combat = state.combat;
    if (!combat) return { ok: true };

    // Count distinct blockers per attacker from the assignment map.
    const blockerCountByAttacker = new Map<string, number>();
    for (const attackerIds of Object.values(combat.blockerAssignments)) {
        for (const attackerId of attackerIds) {
            blockerCountByAttacker.set(
                attackerId,
                (blockerCountByAttacker.get(attackerId) ?? 0) + 1
            );
        }
    }

    const activePlayer = state.players.find(
        (p) => p.id === state.activePlayerId
    );
    if (!activePlayer) return { ok: true };

    for (const attackerId of combat.attackerIds) {
        const blockedBy = blockerCountByAttacker.get(attackerId) ?? 0;
        if (blockedBy === 0) continue; // unblocked is always legal
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue;
        const min = getMinimumBlockers(attacker);
        if (blockedBy < min) {
            const cardName = tryGetCardById(
                (attacker.card as { id?: string }).id ?? ""
            )?.name;
            const label = cardName ?? "This creature";
            return {
                ok: false,
                reason: `${label} can't be blocked except by ${min} or more creatures (menace)`,
            };
        }
    }
    return { ok: true };
}

/** Arboria (CR 508.1c) — true when a creature can't be declared as an attacker
 *  against `defenderId` because an Arboria is in play and that player took no
 *  qualifying action (cast a spell / put a nontoken permanent onto the
 *  battlefield) during their last turn. */
export function arboriaForbidsAttack(
    state: GameState,
    defenderId: string
): boolean {
    if (!isCardOnBattlefield(state, ARBORIA_ID)) return false;
    const defender = state.players.find((p) => p.id === defenderId);
    return !defender?.qualifyingActionLastTurn;
}

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
    defenderBattlefield?: CardInstanceState[],
    state?: GameState
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
    // CR 508.1c — battlefield-scanned global attack restrictions. A permanent
    // OTHER than the attacker (Moat, Akron Legionnaire) can forbid the attack
    // via a `global-attack-restriction` static effect. Scanned across the whole
    // board, mirroring the Crusade anthem pattern.
    if (state) {
        const reason = globalAttackProhibitionReason(
            card as unknown as PermanentView,
            state as never
        );
        if (reason) {
            return { eligible: false, reason };
        }
    }
    // Arboria (CR 508.1c) — "Creatures can't attack a player unless that player
    // cast a spell or put a nontoken permanent onto the battlefield during
    // their last turn." A defender-history attack restriction; global, so it
    // lives in the engine rather than on the attacker's staticEffects[].
    if (state) {
        const defenderId = state.players.find(
            (p) => p.id !== card.controllerId
        )?.id;
        if (defenderId && arboriaForbidsAttack(state, defenderId)) {
            return {
                eligible: false,
                reason: "Arboria: that player took no qualifying action during their last turn",
            };
        }
    }
    // Island Sanctuary: defender can only be attacked by flying/islandwalk
    if (state?.islandSanctuaryProtection) {
        const defenderId = state.players.find(
            (p) => p.id !== card.controllerId
        )?.id;
        if (defenderId === state.islandSanctuaryProtection) {
            const hasFlying = card.staticAbilities.includes("flying");
            const hasIslandwalk = card.staticAbilities.includes("islandwalk");
            if (!hasFlying && !hasIslandwalk) {
                return {
                    eligible: false,
                    reason: "Island Sanctuary: can only be attacked by creatures with flying or islandwalk",
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
    // Pass 0 — "can't block this turn" flag (CR 509.1b). Twin of
    // mustBlockAllThisTurn; set by Ydwen Efreet's lost block flip.
    if (blocker.cantBlockThisTurn) {
        return {
            eligible: false,
            reason: "This creature can't block this turn",
        };
    }

    // Pass 0b — attacker "can't be blocked this turn" flag (CR 509.1b). Set on
    // the attacker by Tawnos's Wand; rejects every would-be blocker.
    if (attacker.cantBeBlockedThisTurn) {
        return {
            eligible: false,
            reason: "Attacker can't be blocked this turn",
        };
    }

    // Pass 0c — attacker "can't be blocked by [subtype] this turn" (CR 509.1b).
    // Set on the attacker by Tower of Coireall ("can't be blocked by Walls");
    // rejects only blockers carrying one of the listed subtypes.
    if (attacker.cantBeBlockedBySubtypesThisTurn?.length) {
        const blockerSubtypes = blocker.subtypes ?? [];
        const banned = attacker.cantBeBlockedBySubtypesThisTurn.find((s) =>
            blockerSubtypes.includes(s)
        );
        if (banned !== undefined) {
            return {
                eligible: false,
                reason: `Attacker can't be blocked by ${banned}s this turn`,
            };
        }
    }

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

    // Pass 3 — combat-scoped block restrictions not sourced from a card
    // (Raging River pile combat, ADR 0012). A restricted attacker can be
    // blocked only by flying creatures or creatures in the matching pile.
    const pileRestriction = state?.combatBlockRestrictions?.find(
        (r) => r.attackerId === attacker.id
    );
    if (pileRestriction) {
        const blockerFlies = blocker.staticAbilities.includes("flying");
        if (
            !blockerFlies &&
            blocker.pileLabel !== pileRestriction.allowedPileLabel
        ) {
            return {
                eligible: false,
                reason: `Attacker can be blocked only by flying creatures or creatures in the "${pileRestriction.allowedPileLabel}" pile`,
            };
        }
    }

    // Pass 4 — protection (CR 702.16f).
    if (isProtectedFromSource(attacker, blocker)) {
        return {
            eligible: false,
            reason: "Attacker has protection from this blocker",
        };
    }

    return { eligible: true };
}

/** True if `card` carries an `attack-requirement` static effect
 *  (CR 508.1d) or has been forced to attack this turn by an external
 *  effect (Nettling Imp — `mustAttackThisTurn`). */
function hasAttackRequirement(
    card: CardInstanceState,
    massAttackPlayerId?: string
): boolean {
    if (card.mustAttackThisTurn) return true;
    if (
        massAttackPlayerId &&
        card.controllerId === massAttackPlayerId &&
        card.types.includes("Creature")
    )
        return true;
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
    defenderBattlefield?: CardInstanceState[],
    massAttackPlayerId?: string
): boolean {
    if (!hasAttackRequirement(card, massAttackPlayerId)) return false;
    return validateAttackerEligibility(card, defenderBattlefield).eligible;
}

/** Ids of creatures on `battlefield` that are required to attack this combat. */
export function getRequiredAttackerIds(
    battlefield: CardInstanceState[],
    defenderBattlefield?: CardInstanceState[],
    massAttackPlayerId?: string
): string[] {
    return battlefield
        .filter((c) => mustAttack(c, defenderBattlefield, massAttackPlayerId))
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

/** Collects `block-requirement` static effects from a card's definition
 *  and from any auras attached to it (CR 509.1c). The scope "all-able"
 *  means every eligible creature must block this attacker (Lure). */
function collectBlockRequirements(
    card: CardInstanceState,
    state?: GameState
): StaticBlockRequirement[] {
    const requirements: StaticBlockRequirement[] = [];
    const collect = (cardId: string | undefined) => {
        if (!cardId) return;
        const def = tryGetCardById(cardId);
        if (!def?.staticEffects) return;
        for (const effect of def.staticEffects) {
            if (effect.kind === "block-requirement") {
                requirements.push(effect);
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
    return requirements;
}

/** Maximum number of attackers a blocker can block. Reads from both the
 *  card definition (static, e.g. Two-Headed Giant) and the instance
 *  (temporary, e.g. Blaze of Glory), taking the max of both. */
export function getMaxBlockTargets(card: CardInstanceState): number {
    const defVal =
        tryGetCardById((card.card as { id?: string })?.id ?? "")
            ?.canBlockAdditional ?? 0;
    const instanceVal = card.canBlockAdditional ?? 0;
    return 1 + Math.max(defVal, instanceVal);
}

/** Computes mandatory blocker assignments for must-block requirements
 *  (CR 509.1c — Lure, Blaze of Glory mustBlockAll). Returns a map of
 *  blockerId → attackerIds[] that must be added to the current
 *  blockerAssignments. Only assigns blockers that are:
 *  - untapped creatures
 *  - not already at their max block limit
 *  - able to legally block the attacker (evasion, protection, etc.) */
export function getRequiredBlockerAssignments(
    attackerBattlefield: CardInstanceState[],
    defenderBattlefield: CardInstanceState[],
    attackerIds: string[],
    currentAssignments: Record<string, string[]>,
    state?: GameState
): Record<string, string[]> {
    const result: Record<string, string[]> = {};

    const attackers = attackerIds
        .map((id) => attackerBattlefield.find((c) => c.id === id))
        .filter((c): c is CardInstanceState => c !== undefined);

    const candidates = defenderBattlefield.filter(
        (c) => c.types.includes("Creature") && !c.isTapped
    );

    // Phase 1: Collect attackers that have block requirements (Lure)
    const attackersWithRequirement: CardInstanceState[] = [];
    for (const attacker of attackers) {
        const reqs = collectBlockRequirements(attacker, state);
        if (reqs.some((r) => r.scope === "all-able")) {
            attackersWithRequirement.push(attacker);
        }
    }

    // Phase 2: For each candidate blocker, determine what it must block
    for (const blocker of candidates) {
        const currentBlocks = [
            ...(currentAssignments[blocker.id] ?? []),
            ...(result[blocker.id] ?? []),
        ];
        const maxTargets = getMaxBlockTargets(blocker);

        // Check mustBlockAllThisTurn (Blaze of Glory)
        if (blocker.mustBlockAllThisTurn) {
            for (const attacker of attackers) {
                if (currentBlocks.length >= maxTargets) break;
                if (currentBlocks.includes(attacker.id)) continue;
                if (
                    validateBlockerEligibility(
                        attacker,
                        blocker,
                        defenderBattlefield,
                        state
                    ).eligible
                ) {
                    if (!result[blocker.id]) result[blocker.id] = [];
                    result[blocker.id].push(attacker.id);
                    currentBlocks.push(attacker.id);
                }
            }
        }

        // Check block requirements from attackers (Lure)
        for (const attacker of attackersWithRequirement) {
            if (currentBlocks.length >= maxTargets) break;
            if (currentBlocks.includes(attacker.id)) continue;
            if (
                validateBlockerEligibility(
                    attacker,
                    blocker,
                    defenderBattlefield,
                    state
                ).eligible
            ) {
                if (!result[blocker.id]) result[blocker.id] = [];
                result[blocker.id].push(attacker.id);
                currentBlocks.push(attacker.id);
            }
        }
    }

    return result;
}
