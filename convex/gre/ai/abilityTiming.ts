// Activation-timing discipline for the bot (issue #1890).
//
// The engine already knows that a HOLDABLE INSTANT in hand carries option value:
// `evaluate`'s flexibility term pays for one, `isDiscouragedRolloutMove` penalises
// dumping one at sorcery speed, and `selectRootMove`'s hold-the-trick tie-break
// keeps it when holding and dumping are outcome-equal (ADR 0021). All three read
// `types.includes("Instant")`, so the ENTIRE mirror case — a permanent already on
// the battlefield whose ACTIVATED ability can be used at instant speed — was
// invisible. The bot therefore spent Mother of Runes' protection at sorcery speed
// with nothing to protect against, and animated Mishra's Factory after its own
// combat.
//
// This module is the single, per-card-agnostic authority for the one question all
// three sites need answered: **could this activation just as well happen in a
// later, better-informed window?** It is keyed purely on the ability's declared
// TIMING (CR 602.2a/602.5) — never on a card name, never on what the ability
// does.
//
// PURE: reads state, mutates nothing.

import type { ActivatedAbility, EffectOp } from "../../cards/types";
import type { CardInstanceState, PlayerState } from "../state";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { manaValue } from "../constants";

/** Whether `ability` may be activated at INSTANT SPEED, and therefore in some
 *  window LATER than the mover's own main phase (CR 602.2a — an activated
 *  ability may be activated any time its controller has priority, unless a
 *  restriction says otherwise).
 *
 *  Every `false` branch below is a restriction that makes "activate it later"
 *  either impossible or not obviously available, so the deferral reasoning the
 *  callers build on it does not apply:
 *
 *    * `!useStack` — a mana ability (CR 605.3a). It resolves immediately, is
 *      payment plumbing rather than a play, and is out of scope by the issue's
 *      own terms.
 *    * `sorcerySpeedOnly` (CR 602.3b) and a loyalty cost (CR 606.3) — the
 *      ability is ALREADY restricted to a main phase with an empty stack, so
 *      "hold it for the combat step" is not a thing it can do.
 *    * `activationPhaseRestriction` (CR 602.5, Jade Statue's "only during
 *      combat") — the phases it may be used in are a card-declared set, and
 *      whether a later one is reachable this turn is not a question this
 *      predicate can answer. Fail closed: never deferrable. */
export function isDeferrableStackAbility(ability: ActivatedAbility): boolean {
    if (!ability.useStack) return false;
    if (ability.sorcerySpeedOnly) return false;
    if (ability.cost.loyalty !== undefined) return false;
    if (ability.activationPhaseRestriction) return false;
    return true;
}

/** Duration phases whose effect expires WITHIN the current turn (CR 514.2 /
 *  511.3). `upkeep` / `untap` durations survive into a later turn, so an effect
 *  carrying one has banked lasting value and is deliberately excluded. */
const WITHIN_TURN_DURATION_PHASES = new Set(["end-of-turn", "end-of-combat"]);

/** Whether every Op in `effects` (recursively, through the structural
 *  constructs) declares a within-this-turn duration — i.e. the script does
 *  nothing that outlives the turn.
 *
 *  Fail-CLOSED: an Op with no `duration` field at all (`addCounter`, `draw`,
 *  `dealDamage`, `moveZone`, `createToken` …) is lasting, and one branch of a
 *  modal / conditional script being lasting makes the whole thing lasting. An
 *  empty script is not transient either — there is nothing to be transient. */
function opsAllTransient(effects: readonly EffectOp[]): boolean {
    if (effects.length === 0) return false;
    for (const op of effects) {
        // The structural constructs (ADR 0045) carry no effect of their own;
        // recurse into every branch, exactly as `beneficence.ts` does.
        switch (op.op) {
            case "if":
                if (!opsAllTransient(op.then)) return false;
                if (op.else && !opsAllTransient(op.else)) return false;
                continue;
            case "forEach":
                if (!opsAllTransient(op.effects)) return false;
                continue;
            case "optionChoice":
                for (const mode of op.modes) {
                    if (!opsAllTransient(mode.effects)) return false;
                }
                continue;
            case "coinFlip":
            case "coinFlipSync":
                if (!opsAllTransient(op.win.effects)) return false;
                if (!opsAllTransient(op.loss.effects)) return false;
                continue;
            default:
                break;
        }
        const duration = (op as { duration?: { phase?: string } }).duration;
        if (
            !duration ||
            !WITHIN_TURN_DURATION_PHASES.has(duration.phase ?? "")
        ) {
            return false;
        }
    }
    return true;
}

/** Whether `ability`'s whole effect expires this turn — the activated-ability
 *  analogue of a combat TRICK (issue #1890 item 2).
 *
 *  This is the narrowness that keeps the hold-the-option root tie-break honest.
 *  The cast-side rule it mirrors (`isSorcerySpeedTrickDump`) is scoped to
 *  `aiCombatHint.pump` for a reason: a pump moves no PERMANENT material
 *  (`evaluateCreature` reads permanent effective P/T, so an until-end-of-turn
 *  buff is invisible to it), so its entire worth is the window it is held for
 *  and spending it early is strictly dominated. An ability that BUILDS
 *  something — Sandstorm Salvager's permanent +1/+1 counters, a fetchland's
 *  search — has already banked its value the moment it resolves, whenever that
 *  is, and must be left to win or lose on mean reward.
 *
 *  Derived from Op semantics with ZERO per-card knowledge (the settled
 *  principle of map #1254), and fail-closed at every step: an ability with an
 *  imperative `resolve()` (no script to read) is never called transient. */
export function isTransientOnlyAbility(ability: ActivatedAbility): boolean {
    return ability.effects !== undefined && opsAllTransient(ability.effects);
}

/** One ability of a permanent's POST-LAYER activated-ability set (CR 611.1b),
 *  by id — so a GRANTED ability is found exactly like a printed one. */
export function effectiveAbilityOf(
    card: CardInstanceState,
    abilityId: string
): ActivatedAbility | undefined {
    return getEffectiveActivatedAbilities(card).find(
        ({ ability }) => ability.id === abilityId
    )?.ability;
}

/** Whether `perm` currently offers its controller a LIVE instant-speed
 *  activated option: a deferrable stack ability (above) whose {T} component the
 *  permanent can still pay (it is untapped) and whose mana component fits in
 *  `availableMana`.
 *
 *  This is the battlefield mirror of `hasInstantTiming(card) && affordable` on a
 *  hand card, and it is what the flexibility term pays for: an UNTAPPED Mother
 *  of Runes is a live answer, a tapped one is not, so spending her taps the
 *  option away and the evaluator can finally see the difference. */
export function hasLiveInstantSpeedAbility(
    perm: CardInstanceState,
    availableMana: number
): boolean {
    for (const { ability } of getEffectiveActivatedAbilities(perm)) {
        if (!isDeferrableStackAbility(ability)) continue;
        if (ability.cost.tap && perm.isTapped) continue;
        if (manaValue(ability.cost.mana) > availableMana) continue;
        return true;
    }
    return false;
}

/** How many of `player`'s permanents currently offer a live instant-speed
 *  activated option, capped at `cap`. The board-side count `evaluate`'s
 *  flexibility term adds to its hand-side one. */
export function liveInstantSpeedAbilityCount(
    player: PlayerState,
    availableMana: number,
    cap: number
): number {
    let n = 0;
    for (const perm of player.battlefield) {
        if (!hasLiveInstantSpeedAbility(perm, availableMana)) continue;
        n += 1;
        if (n === cap) break;
    }
    return n;
}
