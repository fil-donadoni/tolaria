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
import type { CardInstanceState, GameState } from "../state";
import { animatePermanentAsCreature, payRemoveCounterCost } from "../state";
import { validateBlockerEligibility } from "../combat";
import { permanentGiveUpCostLegs } from "../constants";
import { cloneGameState } from "../clone";
import { checkStateBasedActions } from "../sba";
import { getEffectivePT } from "../layers";
import {
    getEffectiveActivatedAbilities,
    type EffectiveActivatedAbility,
} from "../activatedAbilities";
import { childOpArrays, isTriggerBodyHost } from "./effectOpChildren";

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
        // A delayed / reflexive trigger body resolves as its OWN ability
        // later (CR 603.7 / 603.12) — an end-of-turn pump that lands next
        // turn is banked value, not this turn's window. Fail-closed: lasting.
        if (isTriggerBodyHost(op)) return false;
        // Any other script host carries no effect of its own; every nested
        // list must be transient in turn (`childOpArrays`, the one
        // enumeration of them).
        const children = childOpArrays(op);
        if (children.length > 0) {
            if (!children.every(opsAllTransient)) return false;
            continue;
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
    return (
        ability.effects !== undefined && isTransientOnlyScript(ability.effects)
    );
}

/** Whether a whole Effect Script expires this turn (CR 514.2 / 511.3) — the
 *  script-level reading {@link isTransientOnlyAbility} makes of an activation,
 *  exposed for a CAST's script too (the deferral perimeter, issue #4768).
 *  Same fail-closed semantics: an empty or partly-lasting script is not
 *  transient. */
export function isTransientOnlyScript(effects: readonly EffectOp[]): boolean {
    return opsAllTransient(effects);
}

/** Whether an `animatesSelf` activation (CR 611.1) buys a body that can do
 *  nothing in the window it is used in (issue #4238). Two clauses, both read
 *  off the source's own state and the ability's `animatesSelf` marker — never a
 *  card name (ADR 0102):
 *
 *    * TAPPED body — the source is already tapped, so the creature it becomes
 *      can neither attack (CR 508.1a) nor block (CR 509.1a) and stays tapped
 *      until its controller's untap step (CR 502.3), after the animation has
 *      expired. Pointless in ANY window, the opponent's turn included, and
 *      haste does not lift it. (The self-PAID half — the activation's own
 *      mana tapping the source — is closed at the tap plan, see
 *      `planManaPayment`'s `barredSourceId`.)
 *    * SICK body, on the mover's OWN turn — a permanent carries the
 *      control-continuity flag from entry (CR 302.6), so it can't attack
 *      (CR 508.1a, haste lifts it — CR 702.10b) and an active player never
 *      blocks. Scoped to the mover's own turn: the flag survives the
 *      opponent's whole turn, where a sick body can still block.
 *
 *  Haste is read the way attack legality reads it: `staticAbilities` (native
 *  or granted), plus the haste the animation itself grants. */
export function animatedBodyCannotFight(
    state: GameState,
    pid: string,
    source: CardInstanceState,
    ability: ActivatedAbility
): boolean {
    if (ability.animatesSelf !== true) return false;
    if (source.isTapped) return true;
    if (pid !== state.activePlayerId || !source.isSummoningSick) return false;
    return !source.staticAbilities.includes("haste") && !grantsHaste(ability);
}

/** The steps a combat body can still be put to use in, BEFORE the attack is
 *  declared: an attacker must be a creature when attackers are declared
 *  (CR 508.1a), and a blocker when blockers are (CR 509.1a). */
const PRE_ATTACK_PHASES: ReadonlySet<GameState["phase"]> = new Set([
    "UNTAP",
    "UPKEEP",
    "DRAW",
    "PRECOMBAT_MAIN",
    "BEGINNING_OF_COMBAT",
]);

/** The beginning-phase steps (CR 501.1) — an animation bought there for the
 *  coming attack does the same in the precombat main phase. */
const DEFERRABLE_TO_MAIN_PHASES: ReadonlySet<GameState["phase"]> = new Set([
    "UNTAP",
    "UPKEEP",
    "DRAW",
]);

const COMBAT_STEPS: ReadonlySet<GameState["phase"]> = new Set([
    "BEGINNING_OF_COMBAT",
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
    "FIRST_STRIKE_DAMAGE",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
]);

/** Whether this turn still has an attack declaration AHEAD of it: before the
 *  first combat's declaration, or inside a combat with an extra combat still
 *  owed (CR 500.8 — `state.extraPhases` is consumed only at the
 *  `END_OF_COMBAT` exit, so an entry still queued once the turn has left
 *  combat is dead and `advanceTurn` discards it). */
function attackDeclarationAhead(state: GameState): boolean {
    if (PRE_ATTACK_PHASES.has(state.phase)) return true;
    if (state.phase === "DECLARE_ATTACKERS" && !state.combat?.confirmed) {
        return true;
    }
    return COMBAT_STEPS.has(state.phase) && !!state.extraPhases?.length;
}

/** Whether a creature body that reverts this turn ({@link
 *  isExpiringAnimatedBody}) can still attack or block before it does (issue
 *  #7705) — the only thing such a body is worth. Outside such a window its
 *  creature-ness buys nothing but exposure to creature removal and combat.
 *
 *    * A body already IN combat (declared attacker or blocker, CR 508.1 /
 *      509.1) is in use until combat damage is dealt (CR 510.1); by the
 *      COMBAT_DAMAGE priority round that damage is on the board already.
 *    * Otherwise a tapped body can neither attack (CR 508.1a) nor block
 *      (CR 509.1a).
 *    * Its controller's own turn: usable while an attack declaration is
 *      still ahead and the body may attack (continuous control since the
 *      turn began, CR 508.1a, lifted by haste, CR 702.10b).
 *    * The opponent's turn: usable while a block is still ahead — before
 *      attackers are declared, or after, while blockers are not yet, when the
 *      body can legally block at least one declared attacker (CR 509.1b,
 *      through the engine's own `validateBlockerEligibility`).
 *
 *  Pure. */
export function expiringBodyHasCombatUse(
    state: GameState,
    body: CardInstanceState
): boolean {
    const combat = state.combat;
    if (
        combat &&
        (combat.attackerIds.includes(body.id) ||
            body.id in combat.blockerAssignments) &&
        (state.phase === "DECLARE_ATTACKERS" ||
            state.phase === "DECLARE_BLOCKERS" ||
            state.phase === "FIRST_STRIKE_DAMAGE")
    ) {
        return true;
    }
    if (body.isTapped) return false;
    if (body.controllerId === state.activePlayerId) {
        return (
            attackDeclarationAhead(state) &&
            (!body.isSummoningSick || body.staticAbilities.includes("haste"))
        );
    }
    if (attackDeclarationAhead(state)) return true;
    return canBlockADeclaredAttacker(state, body);
}

/** Whether `body`, controlled by the defending player, can legally block at
 *  least one declared attacker in a declare-attackers step whose blockers are
 *  not yet declared (CR 509.1). Once blockers are declared no body can
 *  BECOME a blocker. Eligibility is the engine's own
 *  `validateBlockerEligibility` (evasion — flying vs reach, CR 702.9b /
 *  702.17b — restrictions, protection), judged against the defender's whole
 *  battlefield (landwalk reads it). */
function canBlockADeclaredAttacker(
    state: GameState,
    body: CardInstanceState
): boolean {
    const combat = state.combat;
    if (
        state.phase !== "DECLARE_ATTACKERS" ||
        !combat?.confirmed ||
        combat.blockersConfirmed ||
        combat.attackerIds.length === 0
    ) {
        return false;
    }
    const defender = state.players.find((p) => p.id === body.controllerId);
    if (!defender) return false;
    return combat.attackerIds.some((attackerId) => {
        const attacker = state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === attackerId);
        return (
            !!attacker &&
            validateBlockerEligibility(
                attacker,
                body,
                defender.battlefield,
                state
            ).eligible
        );
    });
}

/** The `animate` Op an `animatesSelf` ability applies to its own source, if
 *  its script spells one out at top level. */
function selfAnimateOp(
    ability: ActivatedAbility
): Extract<EffectOp, { op: "animate" }> | undefined {
    return ability.effects?.find(
        (op): op is Extract<EffectOp, { op: "animate" }> =>
            op.op === "animate" &&
            (op.target as { ref?: string }).ref === "$source"
    );
}

/** Whether activating the `animatesSelf` `ability` of `source` NOW, by `pid`,
 *  buys a body that can still fight this turn in a window where activating
 *  LATER would lose that use (issue #7705). An animation buys a creature body
 *  for the rest of the turn and nothing else, so these are the only windows
 *  it is worth anything in:
 *
 *    * `pid`'s OWN turn, while an attack declaration is still ahead — from
 *      the precombat main phase (the earlier untap/upkeep/draw windows defer
 *      to it with the same effect) up to the declaration (CR 508.1a), plus an
 *      owed extra combat (CR 500.8).
 *    * The OPPONENT's turn, after attackers are declared and before blockers
 *      are (CR 509.1), when the animated body could block at least one
 *      declared attacker. The body is judged AS IT WOULD BE after the
 *      animation — keywords the animation grants count (an animation granting
 *      reach can block a flyer) — by applying the ability's own `animate` Op
 *      to a clone through the engine's animation primitive, and eligibility
 *      through `validateBlockerEligibility`, never a hand-rolled check.
 *      Before attackers are declared the animation is deferrable: the
 *      defender gets priority again in the declare-attackers step (CR 117.3a)
 *      and can animate then with full information. The deterrence value of
 *      animating at beginning of combat is deliberately NOT credited.
 *
 *  The stack does not lift any of this: an animation in response to a spell
 *  or ability (a discard, a draw, burn to a player) buys the same body for
 *  the same windows. An ability whose script has no top-level self-`animate`
 *  is not judged on the opponent's turn — reads as usable (fails open: this
 *  is a guardrail, never a dominance proof). Pure. */
export function animationHasCombatWindow(
    state: GameState,
    pid: string,
    source: CardInstanceState,
    ability: ActivatedAbility
): boolean {
    if (pid === state.activePlayerId) {
        return (
            !DEFERRABLE_TO_MAIN_PHASES.has(state.phase) &&
            attackDeclarationAhead(state)
        );
    }
    const combat = state.combat;
    if (
        state.phase !== "DECLARE_ATTACKERS" ||
        !combat?.confirmed ||
        combat.blockersConfirmed ||
        combat.attackerIds.length === 0
    ) {
        return false;
    }
    const op = selfAnimateOp(ability);
    if (!op) return true;
    const world = cloneGameState(state);
    const body = world.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === source.id);
    if (!body) return false;
    animatePermanentAsCreature(
        world,
        body,
        {
            power: op.power,
            toughness: op.toughness,
            subtype: op.subtype,
            additionalTypes: op.additionalTypes,
            grantedAbilities: op.grantedAbilities,
            colors: op.colors,
            duration: op.duration,
        },
        pid
    );
    return canBlockADeclaredAttacker(world, body);
}

function grantsHaste(ability: ActivatedAbility): boolean {
    const visit = (ops: readonly EffectOp[]): boolean =>
        ops.some(
            (op) =>
                (
                    op as { grantedAbilities?: readonly string[] }
                ).grantedAbilities?.includes("haste") === true ||
                childOpArrays(op).some(visit)
        );
    return ability.effects !== undefined && visit(ability.effects);
}

/** Whether `ability` is a `{T}` activation whose whole payoff expires this
 *  turn ({@link isTransientOnlyAbility}) aimed at its OWN source, in a window
 *  where the source is not committed to combat (issue #4238).
 *
 *  The tap spends the body: outside combat it forfeits the attack or block the
 *  permanent exists for (CR 508.1a / 509.1a — a tapped creature does neither),
 *  and the bonus lands on a body that can no longer use it. Real value
 *  survives, so the clause lifts when
 *
 *    * the source is a declared blocker, or an attacker (it is untapped, or the
 *      `{T}` could not have been paid — it stays untapped through combat), or
 *    * the stack is non-empty: the activation responds to something (toughness
 *      in response to burn).
 *
 *  Pumping ANOTHER permanent is untouched: every target must be the source. */
export function isPointlessSelfPump(
    state: GameState,
    source: CardInstanceState,
    ability: ActivatedAbility,
    targets: readonly { type: string; id: string }[]
): boolean {
    if (!ability.cost.tap || !isTransientOnlyAbility(ability)) return false;
    if (targets.length === 0) return false;
    if (!targets.every((t) => t.type === "permanent" && t.id === source.id)) {
        return false;
    }
    if (state.stack.length > 0) return false;
    const combat = state.combat;
    if (combat) {
        if (combat.attackerIds.includes(source.id)) return false;
        if (combat.blockerAssignments[source.id]?.length) return false;
    }
    return true;
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
 *    * `tap` (the {T} symbol, CR 107.5) and `mana` — the untap step gives both
 *      back (CR 502.3), so the resource is rented for the turn either way and
 *      holding preserves nothing that firing destroys. Prodigal Sorcerer's
 *      `{T}` ping is the shipped guard for that (issue #1890), and it must
 *      keep winning or losing on mean reward.
 *    * `life`, `discardThis`, `discardLastDrawn` — each is irreversible too,
 *      but none of them is a resource the OPPONENT's turn lets the bot use in
 *      the meantime, which is the whole argument here. Fail closed: this rule
 *      redirects a root pick, so a cost it cannot argue about is left alone.
 *    * `removeCounter` was in that list until issue #3296, on the same
 *      argument — and the argument is false whenever THE COUNTERS ARE THE
 *      BODY. Remove the last +1/+1 counter from a creature with printed
 *      toughness 0 and CR 704.5f puts it into the graveyard: a permanent that
 *      would have blocked all through the opponent's turn is gone, which is
 *      exactly the forfeiture the sacrifice clause prices. So the key is not
 *      promoted wholesale — `costDestroysSource` asks whether paying THIS
 *      cost, on THIS board, ends with the source off the battlefield. The
 *      distinction is POSITIONAL, not definitional: the same ability on the
 *      same card is a sacrifice at its last counter and an ordinary cost at
 *      three, which is why the predicate needs the state at all.
 *    * `tapOtherFilter` — the tapped creatures WOULD still be able to block if
 *      the cost were deferred, so the argument does apply; it is left out
 *      because whether those creatures matter is a combat judgement the
 *      outcome-equality gate this feeds cannot make, and issue #2939 is
 *      explicitly about sacrifice engines.
 *
 *  A sacrifice-for-MANA outlet is excluded, and not as a workaround: mana
 *  empties at the end of every step and phase (CR 500.5), so an outlet
 *  deferred to the opponent's end step produces mana that is simply lost. Its
 *  whole point is to convert a permanent AT the moment the mana is needed,
 *  which is the mover's own main phase — the exact window this predicate would
 *  otherwise defer it out of. Detected from the SCRIPT (`addMana` anywhere in
 *  it, recursing through the structural constructs the way `opsAllTransient`
 *  does), because a mana ability under CR 605.1a can still carry
 *  `useStack: true` in its definition, and then `isDeferrableStackAbility`'s
 *  own mana-ability exclusion never sees it. Ashnod's Altar and Phyrexian Altar
 *  were flipped to `useStack: false` by issue #3047; the remaining members of
 *  the shape wait on issue #3989, and this clause stays correct either way.
 *
 *  Per-card-agnostic by construction: reads the cost shape, the resulting
 *  board state and the Op vocabulary only — never a card name, never a
 *  hardcoded counter type (ADR 0102). */
export function spendsStandingPermanent(
    state: GameState,
    source: CardInstanceState,
    ability: ActivatedAbility
): boolean {
    const givesUpAPermanent =
        ability.cost.sacrifice === true ||
        // CR 602.1a — a filtered give-up leg (`sacrificeFilter`, or the
        // bounce twin `returnToHandFilter`) spends ANOTHER permanent's board
        // presence either way.
        permanentGiveUpCostLegs(ability.cost).length > 0 ||
        costDestroysSource(state, source, ability);
    return givesUpAPermanent && !producesMana(ability);
}

/** Whether paying `ability`'s cost would, ON THIS BOARD, take its own source
 *  off the battlefield — the positional half of `spendsStandingPermanent`
 *  (issue #3296, surfaced by issue #3192).
 *
 *  Decided by SIMULATION rather than by a rule of its own: the cost is paid
 *  through the engine's own `payRemoveCounterCost` chokepoint on a clone, the
 *  real state-based-action sweep runs (CR 704.3 — so CR 704.5f's zero-toughness
 *  check, and anything else the payment sets off, is the engine's answer and
 *  not a second copy of it), and the question is simply whether the source is
 *  still there. A creature whose toughness comes only from counters dies at its
 *  LAST one and survives with counters to spare, and this reads that difference
 *  off the board instead of off the definition.
 *
 *  DIFFERENTIAL, and that is not a refinement: a bare "is it gone after the
 *  sweep" reading calls the COST responsible for a source the BOARD had already
 *  doomed. An unattached Aura is the reproduction — CR 704.5m puts it into its
 *  owner's graveyard whether or not anything is paid — so the unpaid sweep is
 *  the baseline the paid one is measured against, and only a source that
 *  survives the first and not the second counts.
 *
 *  Scoped to `removeCounter`, the one cost key whose payment can remove its own
 *  source without the definition saying "sacrifice" anywhere. Every other key
 *  is either already handled above (`sacrifice` / `sacrificeFilter`) or cannot
 *  reach the source at all (`tap`, `mana`, `life`, `discardThis`).
 *
 *  Fail-closed, matching the module's discipline: every way the simulation can
 *  fail to answer — a source not on the battlefield, a payment the real
 *  chokepoint refuses (too few counters), a throw out of the sweep itself —
 *  leaves the activation alone. */
function costDestroysSource(
    state: GameState,
    source: CardInstanceState,
    ability: ActivatedAbility
): boolean {
    const cost = ability.cost.removeCounter;
    if (!cost) return false;
    return (
        survivesSweep(state, source.id, null) &&
        !survivesSweep(state, source.id, cost)
    );
}

/** Whether `sourceId` is still on the battlefield after a state-based-action
 *  sweep (CR 704.3) on a CLONE of `state`, with `cost` paid first when one is
 *  given. Mutates nothing the caller owns.
 *
 *  Returns true on anything it cannot simulate, which is the fail-closed
 *  direction for BOTH of `costDestroysSource`'s uses of it: an unanswerable
 *  baseline reads as "the source was fine", an unanswerable paid sweep as "it
 *  still is", and the difference between them — the only thing the caller
 *  looks at — is then empty. The one exception is a source that is not on the
 *  battlefield at all, which is not an unanswered question but a `false` one,
 *  and it fails the baseline. */
function survivesSweep(
    state: GameState,
    sourceId: string,
    cost: { type: string; count: number } | null
): boolean {
    try {
        const probe = cloneGameState(state);
        const card = probe.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === sourceId);
        if (!card) return false;
        if (cost) payRemoveCounterCost(probe, card, cost);
        checkStateBasedActions(probe);
        return probe.players.some((p) =>
            p.battlefield.some((c) => c.id === sourceId)
        );
    } catch {
        return true;
    }
}

/** Whether paying `ability`'s cost would, ON THIS BOARD, take part or all of
 *  its own source's BODY — the source leaves the battlefield
 *  (`costDestroysSource`), or its power or toughness after the CR 613.4 layer
 *  pipeline ends lower (issue #3376).
 *
 *  The partial sibling of `costDestroysSource`, on the same argument: when the
 *  counters ARE the body, removing one spends a slice of a standing permanent
 *  that would otherwise keep attacking and blocking, and the last one spends
 *  all of it. Decided by SIMULATION like its sibling — the cost is paid
 *  through the engine's own `payRemoveCounterCost` chokepoint on a clone and
 *  the layers recompute power and toughness — so a counter that is not part of
 *  power or toughness (a charge counter, a spore counter) never reads as a
 *  shrink, and no counter type is hardcoded.
 *
 *  Scoped to `removeCounter`, for the reason `costDestroysSource` gives: no
 *  other cost key reaches the source's own stats. Fail-closed: a payment the
 *  chokepoint refuses or a throw leaves the activation alone. */
export function costShrinksSource(
    state: GameState,
    source: CardInstanceState,
    ability: ActivatedAbility
): boolean {
    const cost = ability.cost.removeCounter;
    if (!cost) return false;
    if (costDestroysSource(state, source, ability)) return true;
    try {
        const probe = cloneGameState(state);
        const card = probe.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === source.id);
        if (!card) return false;
        const before = getEffectivePT(probe, card);
        payRemoveCounterCost(probe, card, cost);
        const after = getEffectivePT(probe, card);
        return after.power < before.power || after.toughness < before.toughness;
    } catch {
        return false;
    }
}

/** Whether `ability`'s script can add mana (CR 106.4) — recursing through the
 *  structural constructs, so a modal or conditional branch that produces mana
 *  counts. An imperative `resolve()` ability has no script to read and is
 *  treated as NOT mana-producing, which is the fail-open direction here but
 *  the fail-CLOSED one for the caller: it leaves the deferral rule applying to
 *  a card it could not read, and `isDeferrableStackAbility` still gates on
 *  `useStack`. */
function producesMana(ability: ActivatedAbility): boolean {
    return ability.effects !== undefined && opsAddMana(ability.effects);
}

function opsAddMana(effects: readonly EffectOp[]): boolean {
    for (const op of effects) {
        if (op.op === "addMana") return true;
        // Mana a delayed / reflexive trigger adds arrives when THAT ability
        // resolves (CR 603.7 / 603.12), not as this activation's payoff — it
        // is not what makes a sacrifice outlet a mana outlet.
        if (isTriggerBodyHost(op)) continue;
        if (childOpArrays(op).some(opsAddMana)) return true;
    }
    return false;
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
