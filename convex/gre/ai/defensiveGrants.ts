// Threat-awareness for a DEFENSIVE keyword GRANT (issue #2937).
//
// THE CLASS. A keyword whose entire worth is protective is worth paying for
// only against a threat that is actually live, and the bot priced one flat:
// `creatureBody.ts`'s `KEYWORD_BONUS` credits `indestructible` +30 on every
// board, so Iron-Shield Elf discarding a card AND tapping itself to gain
// indestructible bought +30 of measurable material with nothing to be
// indestructible against.
//
// WHAT THIS MODULE DECIDES, and nothing more: whether a permanent's position is
// QUIET — nothing on the stack, no combat damage still headed at it, no answer
// the opponent can pay for. In a quiet position `evaluate.ts` takes the flat
// bonus back off a duration-scoped grant; everywhere else the pre-existing
// valuation stands untouched.
//
// FAIL-CLOSED, deliberately and in every clause. The predicate answers "could
// anything at all be happening to this permanent?", never "is this specific
// threat one this specific keyword answers?". A Wrath of God on the stack, an
// opposing pump spell, a blocker that could not actually kill the creature —
// all of them make the position NOT quiet and leave the valuation exactly where
// `main` had it. The only positions this module changes are the ones where it
// can prove nothing is happening, which is the position the issue reports. That
// asymmetry is the whole design: an over-eager "quiet" verdict silently
// un-prices a real protective grant, while an over-cautious one merely declines
// to fix a case, so every doubt resolves toward NOT quiet.
//
// It deliberately builds NO lethality model. "Is this creature about to die in
// combat?" is `damageAssignment.ts`'s `lethalDamageThreshold` and
// `evaluate.ts`'s `declaredBlockDelta`, which know about marked damage
// (CR 510.1a), deathtouch (CR 702.2b) and multi-block damage division
// (CR 510.1d); a second, cruder copy here would disagree with them about who
// dies. The question asked instead — "is any combat damage assigned toward this
// permanent at all?" — is exact, needs none of that, and is the one a
// fail-closed gate wants.
//
// Per-card-agnostic by construction (ADR 0102): the inputs are the granted
// keyword's protective character, the stack, the declared combat, and the
// opponent's castable held interaction. No card name appears here.
//
// PURE: reads state, mutates nothing.

import type { CardInstanceState, GameState } from "../state";
import { castableHeldInteraction } from "../heldInteraction";
import { isProtectionAbility } from "../protection";

/** Whether `keyword`'s worth is purely PROTECTIVE — it does nothing except
 *  answer something the opponent is doing.
 *
 *  Indestructible is CR 702.12.
 *  Shroud is CR 702.18.
 *  Hexproof is CR 702.11.
 *  Protection is CR 702.16, matched by prefix the way `protection.ts` parses it
 *  everywhere else — the keyword string is "protection from <quality>", never
 *  one literal.
 *
 *  Evasion, combat amplifiers and utility keywords are NOT here: their value is
 *  unconditional, and the issue's "non-defensive grants are unaffected" is that
 *  exclusion. */
export function isDefensiveKeyword(keyword: string): boolean {
    switch (keyword) {
        case "indestructible":
        case "shroud":
        case "hexproof":
            return true;
        default:
            return isProtectionAbility(keyword);
    }
}

/** The DURATION-SCOPED defensive keyword occurrences currently LIVE on `card`
 *  (CR 611.2a) — the until-end-of-turn window an activated grant buys.
 *
 *  Three narrowings, each load-bearing:
 *
 *  * an `auraId`- or `counterType`-keyed grant is excluded — those last as long
 *    as their source does, so they behave like a printed characteristic rather
 *    than like the window this is about (`state.ts` guarantees exactly one of
 *    the three keys per entry);
 *  * a printed keyword has no grant record at all and is never returned, so a
 *    creature that IS indestructible keeps its flat bonus;
 *  * the keyword must still be IN `staticAbilities`. A grant record and the
 *    `staticAbilities` occurrence it pushed are not in lockstep: a layer-6
 *    ability-loss effect (CR 613.1f) takes the occurrence away and records
 *    `removedKeywords` while leaving the grant record standing, and the
 *    `suppressed` flag that would mark that is only ever written on the aura
 *    path. Without this clause the caller would subtract a bonus
 *    `creatureValueRaw` never added, under-valuing a creature whose keyword had
 *    been stripped.
 *
 *  Returns one entry per live occurrence, so two activations that each pushed
 *  their own occurrence are both accounted for. */
export function temporaryDefensiveKeywords(card: CardInstanceState): string[] {
    const granted = card.grantedStaticAbilities;
    if (!granted || granted.length === 0) return [];
    // One occurrence of each keyword may be consumed per grant record; count
    // what `staticAbilities` actually holds so a stripped occurrence is not
    // claimed twice.
    const available = new Map<string, number>();
    for (const keyword of card.staticAbilities) {
        if (!isDefensiveKeyword(keyword)) continue;
        available.set(keyword, (available.get(keyword) ?? 0) + 1);
    }
    if (available.size === 0) return [];
    const out: string[] = [];
    for (const g of granted) {
        if (g.duration === undefined) continue;
        const left = available.get(g.ability);
        if (!left) continue;
        available.set(g.ability, left - 1);
        out.push(g.ability);
    }
    return out;
}

/** Whether any combat damage is still headed AT `card` (CR 510.1c/510.1d).
 *
 *  Exact, and deliberately not a lethality judgement: any assigned combat
 *  damage at all makes the position un-quiet, whether or not it would kill.
 *
 *  PHASE GUARD, for the reason `evaluate.ts`'s `declaredFaceDamage` documents
 *  at length: `state.combat` SURVIVES the damage steps and is torn down only as
 *  END_OF_COMBAT ends, so without pinning the pre-damage steps this would keep
 *  reporting damage that has already been dealt. */
function facesCombatDamage(state: GameState, card: CardInstanceState): boolean {
    if (
        state.phase !== "DECLARE_ATTACKERS" &&
        state.phase !== "DECLARE_BLOCKERS"
    ) {
        return false;
    }
    const combat = state.combat;
    if (!combat || !combat.confirmed) return false;
    const isAttacker = combat.attackerIds.includes(card.id);
    // Blocks are not declared yet: any attacker may still be blocked, and any
    // untapped creature on the other side may still block. Fail closed.
    if (!combat.blockersConfirmed) return isAttacker || !card.isTapped;
    if (isAttacker) {
        return Object.values(combat.blockerAssignments).some((attackerIds) =>
            attackerIds.includes(card.id)
        );
    }
    return (combat.blockerAssignments[card.id] ?? []).length > 0;
}

/**
 * Whether NOTHING the opponent is doing can reach `card` right now — the one
 * verdict that licenses treating a protective grant as worth nothing.
 *
 * Every clause fails closed (see the module header):
 *
 *  * ANY object on the stack controlled by an opponent counts, whether or not
 *    it targets this permanent and whatever it does. A board wipe targets
 *    nothing and is the archetypal reason to buy indestructible (CR 702.12b);
 *    reading the object's script to decide would be a second, weaker copy of
 *    the Op semantics, and getting it wrong un-prices a real answer.
 *  * combat damage still headed at the permanent, per `facesCombatDamage`.
 *  * an instant-speed answer the opponent can pay for, through the engine's
 *    existing predictor (`heldInteraction.ts` — an opt-in `aiCombatHint`
 *    gated on the same coarse untapped-mana proxy the `mana` term uses, so
 *    "the opponent is tapped out" already answers `false` there). Narrow by
 *    construction, and narrow in the safe direction: a held answer it cannot
 *    see leaves the position un-quiet only if some OTHER clause says so.
 */
export function isQuietFor(state: GameState, card: CardInstanceState): boolean {
    for (const item of state.stack) {
        if (item.castById !== card.controllerId) return false;
    }
    if (facesCombatDamage(state, card)) return false;
    const opponent = state.players.find((p) => p.id !== card.controllerId);
    if (opponent && castableHeldInteraction(opponent).removal) return false;
    return true;
}
