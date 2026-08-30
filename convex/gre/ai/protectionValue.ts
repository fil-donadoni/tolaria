// Threat-aware valuation of a DEFENSIVE keyword GRANT (issues #2937 / #2938).
//
// THE CLASS. A keyword whose entire worth is protective — indestructible
// (CR 702.12), shroud (CR 702.18), hexproof (CR 702.11), protection
// (CR 702.16) — is worth its cost only against a threat that is actually
// live. The bot priced one flat and unconditionally, from two directions at
// once:
//
//   * `creatureBody.ts`'s `KEYWORD_BONUS` credits `indestructible` a flat +30
//     on every board, so paying a real cost (Iron-Shield Elf discards a card
//     AND taps itself) bought +30 of measurable material with nothing to be
//     indestructible against — issue #2937;
//   * shroud / hexproof / protection carry NO board value at all, so the
//     mirror case is equally wrong in the other direction: a shroud grant that
//     blanks a removal spell already on the stack was worth exactly zero, and
//     the bot let the creature die rather than pay for it — issue #2938 (the
//     `docs/findings/1920-safekeeper-reactive-depth.md` gap).
//
// SCOPE — this module reads a grant, never a printed characteristic. A
// permanent that IS indestructible (Darksteel Colossus) is unconditionally
// better, and `KEYWORD_BONUS` saying so is correct; what is not correct is
// pricing a DURATION-SCOPED grant (`grantedStaticAbilities[].duration`, CR
// 611.2a — the "until end of turn" the two cards above buy) as though it were
// that permanent characteristic. So every predicate here keys on the grant
// record, which means the whole term is identically zero on every board that
// carries no temporary defensive grant — no other position's evaluation moves.
//
// Per-card-agnostic by construction (ADR 0102): the inputs are the granted
// KEYWORD's protective family, the objects on the stack, the declared blocks,
// and the opponent's castable held interaction. No card name appears here and
// no registry is keyed by one.
//
// PURE: reads state, mutates nothing.

import type { CardInstanceState, GameState } from "../state";
import {
    getPermanentEffectivePower,
    getPermanentEffectiveToughness,
} from "../layers";
import { isCreature } from "../constants";
import { castableHeldInteraction } from "../heldInteraction";
import { isProtectionAbility } from "../protection";

/** What a defensive keyword actually answers.
 *
 *  * `targeted` — the keyword makes the permanent an illegal target, so a
 *    spell or ability already aimed at it does nothing (CR 608.2b: it is
 *    countered on resolution for having no legal targets). Shroud and hexproof.
 *  * `damage` — the keyword survives what would destroy the permanent: lethal
 *    damage and destruction (CR 702.12b). Indestructible.
 *
 *  Protection answers BOTH halves of its own DEBT (CR 702.16b/e — can't be
 *  Damaged, Enchanted/Equipped, Blocked or Targeted). */
export type ThreatFamily = "targeted" | "damage";

const TARGETED_ONLY: readonly ThreatFamily[] = ["targeted"];
const DAMAGE_ONLY: readonly ThreatFamily[] = ["damage"];
const BOTH: readonly ThreatFamily[] = ["targeted", "damage"];

/** The threat families `keyword` answers, or `null` when the keyword is not a
 *  defensive one at all (evasion, combat amplifiers, utility — untouched by
 *  this module, per the issues' explicit "non-defensive grants are
 *  unaffected"). */
export function defensiveKeywordFamilies(
    keyword: string
): readonly ThreatFamily[] | null {
    switch (keyword) {
        case "shroud": // CR 702.18a
        case "hexproof": // CR 702.11b
            return TARGETED_ONLY;
        case "indestructible": // CR 702.12b
            return DAMAGE_ONLY;
        default:
            // CR 702.16 — "protection from <quality>" is a family of keyword
            // strings, not one literal, so it is matched by its prefix the
            // same way `protection.ts` parses it everywhere else.
            return isProtectionAbility(keyword) ? BOTH : null;
    }
}

/** The DURATION-SCOPED defensive keywords currently granted to `card`
 *  (CR 611.2a). An `auraId`- or `counterType`-keyed grant is deliberately
 *  excluded: those last as long as their source does, so they behave like a
 *  printed characteristic rather than like the until-end-of-turn window these
 *  two issues are about. */
export function temporaryDefensiveKeywords(card: CardInstanceState): string[] {
    const granted = card.grantedStaticAbilities;
    if (!granted || granted.length === 0) return [];
    const out: string[] = [];
    for (const g of granted) {
        if (g.duration === undefined) continue;
        if (defensiveKeywordFamilies(g.ability) === null) continue;
        out.push(g.ability);
    }
    return out;
}

/** Severity of a threat the opponent is holding rather than showing: a
 *  castable, instant-speed answer in hand (`heldInteraction.ts`'s opt-in
 *  `aiCombatHint.removal`, gated on the same coarse available-mana proxy the
 *  `mana` term uses — so "no opposing untapped mana" is already a `false`
 *  here). Well below 1: unlike a spell on the stack, it may never be cast, and
 *  it may not even be removal for THIS permanent. */
const HELD_ANSWER_SEVERITY = 0.35;

/** Whether an opponent of `card`'s controller has an object on the stack that
 *  TARGETS it (CR 601.2c / 602.2b).
 *
 *  Coarse on purpose, and the coarseness is one-directional: the object's own
 *  script is not read, so a targeted opposing spell counts as a threat for
 *  BOTH families rather than only the one it really is (a targeted bounce
 *  credits indestructible, which cannot save the permanent from it). That
 *  over-credit reproduces exactly today's unconditional `KEYWORD_BONUS`, so it
 *  can regress nothing; the under-credit it avoids — failing to see a
 *  Lightning Bolt as a threat — is the bug. Refining it to the Op level is a
 *  separate slice. */
function targetedByOpposingStackObject(
    state: GameState,
    card: CardInstanceState
): boolean {
    for (const item of state.stack) {
        if (item.castById === card.controllerId) continue;
        for (const t of item.targets ?? []) {
            if (t.type === "permanent" && t.id === card.id) return true;
        }
    }
    return false;
}

/** Whether `card` is about to be dealt LETHAL combat damage by the block that
 *  has already been declared (CR 510.1 / 704.5g).
 *
 *  PHASE GUARD, for the reason `evaluate.ts`'s `declaredFaceDamage` documents:
 *  `state.combat` survives the damage steps and is torn down only as
 *  END_OF_COMBAT ends, so without pinning the one PRE-damage phase in which
 *  `blockersConfirmed` can be true this would keep reporting damage that has
 *  already been dealt. */
function facesLethalCombatDamage(
    state: GameState,
    card: CardInstanceState
): boolean {
    if (state.phase !== "DECLARE_BLOCKERS") return false;
    const combat = state.combat;
    if (!combat || !combat.confirmed || !combat.blockersConfirmed) return false;
    if (!isCreature(card)) return false;
    const toughness = getPermanentEffectiveToughness(state, card);
    if (toughness <= 0) return false;

    let incoming = 0;
    if (combat.attackerIds.includes(card.id)) {
        // An ATTACKER takes damage from every creature blocking it (CR 510.1c).
        for (const [blockerId, attackerIds] of Object.entries(
            combat.blockerAssignments
        )) {
            if (!attackerIds.includes(card.id)) continue;
            const blocker = findPermanent(state, blockerId);
            if (blocker)
                incoming += Math.max(
                    0,
                    getPermanentEffectivePower(state, blocker)
                );
        }
    } else {
        // A BLOCKER takes damage from every attacker it blocks (CR 510.1d).
        for (const attackerId of combat.blockerAssignments[card.id] ?? []) {
            const attacker = findPermanent(state, attackerId);
            if (attacker)
                incoming += Math.max(
                    0,
                    getPermanentEffectivePower(state, attacker)
                );
        }
    }
    return incoming >= toughness;
}

function findPermanent(
    state: GameState,
    instanceId: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === instanceId);
        if (found) return found;
    }
    return undefined;
}

/**
 * How live the threat against `card` is, in [0, 1], counting only threats one
 * of `families` actually answers. Zero means the protective keyword buys
 * nothing right now — which is the whole verdict both issues turn on.
 */
export function liveThreatSeverity(
    state: GameState,
    card: CardInstanceState,
    families: readonly ThreatFamily[]
): number {
    if (families.length === 0) return 0;
    // A spell/ability already aimed at the permanent is the one certain threat
    // — both families answer it (see the coarseness note above).
    if (targetedByOpposingStackObject(state, card)) return 1;
    if (families.includes("damage") && facesLethalCombatDamage(state, card)) {
        return 1;
    }
    // Nothing shown. An answer the opponent can pay for right now is worth a
    // fraction of one already on the stack.
    const opponent = state.players.find((p) => p.id !== card.controllerId);
    if (opponent && castableHeldInteraction(opponent).removal) {
        return HELD_ANSWER_SEVERITY;
    }
    return 0;
}

/** The union of threat families answered by `card`'s temporary defensive
 *  grants, and the keywords themselves — the one walk both `evaluate.ts`
 *  consumers (the flat-bonus correction and the threat-scaled credit) share,
 *  so they can never disagree about which grants are in scope. */
export function temporaryDefensiveGrantFamilies(card: CardInstanceState): {
    keywords: string[];
    families: ThreatFamily[];
} {
    const keywords = temporaryDefensiveKeywords(card);
    const families: ThreatFamily[] = [];
    for (const keyword of keywords) {
        for (const family of defensiveKeywordFamilies(keyword) ?? []) {
            if (!families.includes(family)) families.push(family);
        }
    }
    return { keywords, families };
}
