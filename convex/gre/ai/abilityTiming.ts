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
// TIMING (CR 117.1b/602.5d) — never on a card name, never on what the ability
// does.
//
// NOT here, but SHIPPED: the BOARD-SIDE flexibility term (issue #1890 item 3 —
// an `evaluate` bonus for a permanent that currently offers a live instant-speed
// activated option, the mirror of the hand-side bonus for a holdable instant).
// It lives in `gre/evaluate.ts` (`hasLiveInstantSpeedActivation`), reads THIS
// module's `isDeferrableStackAbility` for the timing half, and landed with issue
// #1920.
//
// It was held back from PR #1919 for a reason worth keeping in view. The credit
// is SYMMETRIC — it pays for holding the option in every window, including the
// REACTIVE one where the option should be spent — so while `applyMoveInSearch`
// applied an activation's COSTS and never put its effect on the stack, spending
// an option had no payoff at any depth and the term turned the exact tie between
// "activate in response to removal" and `pass` into a deterministic
// `W_FLEX`-sized loss for the activation. No scoping of the term repaired that
// (the leaf reached after `pass` legitimately has the option unspent); closing
// the payoff gap did. If the search ever stops resolving an activated ability
// one ply deep, this term becomes a regression again — which is why the pin is a
// MARGIN assertion, not an equality one
// (`convex/gre/__tests__/activationPayoffInSearch.bot.test.ts`).
//
// PURE: reads state, mutates nothing.

import type { ActivatedAbility, EffectOp } from "../../cards/types";
import type { CardInstanceState } from "../state";
import {
    getEffectiveActivatedAbilities,
    type EffectiveActivatedAbility,
} from "../activatedAbilities";

/** Whether `ability` may be activated at INSTANT SPEED, and therefore in some
 *  window LATER than the mover's own main phase (CR 117.1b — a player may
 *  activate an activated ability any time they have priority; CR 602.5 is the
 *  umbrella for the prohibitions that take that away).
 *
 *  Every `false` branch below is a restriction that makes "activate it later"
 *  either impossible or not obviously available, so the deferral reasoning the
 *  callers build on it does not apply:
 *
 *    * `!useStack` — a mana ability (CR 605.3a). It resolves immediately, is
 *      payment plumbing rather than a play, and is out of scope by the issue's
 *      own terms.
 *    * `sorcerySpeedOnly` (CR 602.5d) and a loyalty cost (CR 606.3) — the
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

/** Whether `ability`'s cost gives up a permanent that is STILL DOING ITS JOB
 *  while unspent — a sacrifice cost (CR 701.21a, paid at activation per
 *  CR 602.1), either of the source itself or of a permanent matching a filter.
 *
 *  This is the SECOND way an instant-speed activation can be strictly
 *  dominated by holding it, and it is the one `isTransientOnlyAbility` cannot
 *  see (issue #2939). That predicate asks about the PAYOFF: an effect that
 *  expires this turn is worth only the window it is held for. This one asks
 *  about the COST: a sacrificed land keeps tapping for mana and a sacrificed
 *  creature keeps blocking until the moment it is given up, so converting it
 *  early buys nothing the later conversion would not also buy and forfeits
 *  every use in between. Zuran Orb's payoff (life, and Titania's Elemental)
 *  never decays, so only the cost side makes firing it in the mover's own main
 *  phase the strictly worse window.
 *
 *  The two are ORed at the call site rather than merged here because they
 *  justify the same verdict from opposite ends and a caller may one day want
 *  only one of them.
 *
 *  Scoped to SACRIFICE, and every other cost key is a deliberate exclusion:
 *
 *    * `tap` (CR 302.6's cost symbol) and `mana` — the untap step gives both
 *      back (CR 502.1), so the resource is rented for the turn either way and
 *      holding preserves nothing that firing destroys. Prodigal Sorcerer's
 *      `{T}` ping is the shipped guard for that (issue #1890), and it must
 *      keep winning or losing on mean reward.
 *    * `life`, `removeCounter`, `discardThis`, `discardLastDrawn` — each is
 *      irreversible too, but none of them is a resource the OPPONENT's turn
 *      lets the bot use in the meantime, which is the whole argument here.
 *      Fail closed: this rule redirects a root pick, so a cost it cannot argue
 *      about is left alone.
 *    * `tapOtherFilter` — the tapped creatures WOULD still be able to block if
 *      the cost were deferred, so the argument does apply; it is left out
 *      because whether those creatures matter is a combat judgement the
 *      outcome-equality gate this feeds cannot make, and issue #2939 is
 *      explicitly about sacrifice engines.
 *
 *  Per-card-agnostic by construction: reads the cost shape only (ADR 0102). */
export function spendsStandingPermanent(ability: ActivatedAbility): boolean {
    return (
        ability.cost.sacrifice === true ||
        ability.cost.sacrificeFilter !== undefined
    );
}

/** One ENTRY of a permanent's POST-LAYER activated-ability set (CR 611.2a /
 *  613.1f, layer 6), by id — the ability template plus, when it reached the
 *  permanent through a grant (CR 113.1), the granting card's definition id.
 *
 *  This is the wrapper `effectiveAbilityOf` below discards. A caller that only
 *  needs the ability's TEMPLATE (a timing/shape predicate: is it deferrable,
 *  does it animate its own source) has no use for the provenance and should
 *  keep using `effectiveAbilityOf`. A caller that PUSHES a stack item for the
 *  ability — issue #2468, the search's own `activate-ability` push — needs the
 *  provenance too: `resolveTopOfStack` resolves a GRANTED ability off the
 *  granting card's `grantTemplates`, keyed by `grantedSourceCardId`
 *  (`gre/state.ts`), and an item built without it falls through to a lookup on
 *  the SOURCE's own `activatedAbilities`, finds nothing, and pops as a silent
 *  no-op. */
export function effectiveActivatedAbilityEntryOf(
    card: CardInstanceState,
    abilityId: string
): EffectiveActivatedAbility | undefined {
    return getEffectiveActivatedAbilities(card).find(
        ({ ability }) => ability.id === abilityId
    );
}

/** One ability of a permanent's POST-LAYER activated-ability set (CR 611.2a),
 *  by id — so a GRANTED ability is found exactly like a printed one. Discards
 *  the grant provenance; see `effectiveActivatedAbilityEntryOf` for callers
 *  that need it (e.g. a stack-item push). */
export function effectiveAbilityOf(
    card: CardInstanceState,
    abilityId: string
): ActivatedAbility | undefined {
    return effectiveActivatedAbilityEntryOf(card, abilityId)?.ability;
}
