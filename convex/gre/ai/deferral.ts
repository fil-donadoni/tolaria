// The DEFERRAL PERIMETER (issue #4764, PRD #4754) — which actions "keep mana
// open, act in the last window" is a statement about, and which window is the
// last one.
//
// Two consumers share it, and that is why it is one module rather than a
// clause in each:
//
//   * the Verdict lowering (`verdicts/evalPairs.ts`) — a pair "pass over a
//     deferrable action" in an earlier window, or "a deferrable action over
//     pass" in the last one, is a TIMING judgement. Acting now and acting at
//     the last window reach the same board when nothing happens in between, so
//     the Weight Fit, which reads a position's terms and never its window, can
//     only answer it by bending material weights. Such a pair yields no Eval
//     Pair; the report lists it as checked by the search instead.
//   * the `last-window-deferral` root rule (issue #4757, `search.ts`) — the
//     same perimeter decides which actions wait for the last window at the
//     root, and which one it spends there; the rule then asks its own premise
//     of each (`waitsUnchanged`, a resolution probe that lives beside the
//     search it drives, so this module stays a pure reading of the position).
//
// A third reader asks only the pre-attack clause: `selectRootMove`'s
// `last-window-fire` rule fires a {@link isPreAttackGrant} in ITS last window
// (issue #4768), the one the perimeter refuses to defer to the end step.
//
// A predicate the two disagreed on would let the fit and the root rule each
// claim the other owns a position — so the perimeter is asked here, once.
//
// FAIL-CLOSED, and the direction is chosen by both consumers at once: `false`
// ("not deferrable") leaves a pair in the fit and a decision to the search,
// which is exactly what happened before this module existed. Every doubt — an
// unknown card, a move kind this module cannot read, an opposing object it
// might reach — answers `false`.

import { tryGetDefinition } from "../../cards";
import type { EffectOp, TargetSelection } from "../../cards/types";
import { validateAttackerEligibility } from "../combat";
import { hasInstantSpeed, isTapLockedBySummoningSickness } from "../constants";
import type { Move } from "../moves";
import { getLegalTargets, targetingSourceFromCard } from "../rules";
import type { CardInstanceState, GameState } from "../state";
import {
    effectiveAbilityOf,
    isDeferrableStackAbility,
    isTransientOnlyAbility,
    isTransientOnlyScript,
} from "./abilityTiming";

/** Whether `pid` is at the LAST priority window of this turn cycle in which
 *  deferring still costs nothing — the opponent's end step (CR 513.1, issue
 *  #2939). "The last window before the bot's own turn" is the normal case, not
 *  an invariant: an extra turn taken by the opponent makes this one cycle
 *  early, which converts sooner than strictly necessary and never later.
 *
 *  Deliberately not "any window on the opponent's turn": the end step is the
 *  one where every threat and answer of the turn is already known, which is the
 *  whole payoff the hold rule defers FOR. Anything earlier still has
 *  information left to buy. */
export function isLastDeferralWindow(state: GameState, pid: string): boolean {
    return state.phase === "END_STEP" && state.activePlayerId !== pid;
}

/**
 * Is `move` a DEFERRABLE action for `pid` — one whose only question is WHEN,
 * because a later window offers the same action on the same board?
 *
 * Five clauses, all required:
 *
 *  1. **Instant timing.** A cast of a card with instant speed
 *     (`hasInstantSpeed`: an Instant, or Flash — CR 117.1a / 702.8a), or an
 *     activation `isDeferrableStackAbility` admits (a stack ability with no
 *     timing restriction, CR 117.1b / 602.5). Anything else may have no later
 *     window at all.
 *  2. **Own side only.** Every object the action names is its controller's
 *     own — see {@link reachesOnlyOwnSide}. Removal and burn are OUT: their
 *     timing is the search's, whose leaves simulate the opponent's turn.
 *  3. **Not a response** — the stack is empty. With something on it, "later"
 *     is after that object resolves, a different board (counters and
 *     responses are the search's).
 *  4. **No attack declared** (CR 506.1 / 508.1) — a combat trick's window is
 *     combat itself; that is the search's too.
 *  5. **Not a pre-attack grant** (issue #4768). A haste grant on the
 *     mover's own summoning-sick body, in its own turn before attackers are
 *     declared ({@link isPreAttackGrant}), has no "same action on the same
 *     board" at the opponent's end step: its last USEFUL window is before the
 *     declaration (CR 508.1a / 302.6), and held past it the grant expires at
 *     this turn's cleanup (CR 514.2) having enabled nothing. The root rule
 *     of issue #4757 (`last-window-deferral`), which makes the bot wait for the end step, must
 *     never hold it.
 *
 *     Deliberately NOT every this-turn effect (`isTransientOnlyScript`):
 *     measured, excluding them all put the Mother of Runes hold back into the
 *     Weight Fit — a pass over a protection grant in the mover's own main
 *     phase IS a timing judgement (the grant is worth the response window it
 *     is held for), and the committed weights stopped being the fit of the
 *     committed verdicts. What such an effect is worth at the end step itself
 *     is the last-window rule's own question (issue #4757): nothing, and
 *     {@link isTransientOnlyAction} is how it refuses to spend one there.
 *
 * And one exclusion inside clause 1: an activation whose cost sacrifices
 * ANOTHER permanent (`cost.sacrificeFilter` — Zuran Orb's land, Sylvan
 * Safekeeper's) is a CONVERSION, and whether a land is worth two life is a
 * question of WHAT, not when. It is the question the last-window FIRE rule
 * asks the evaluation (`firingBeatsHolding`, issue #2939), so the pairs that
 * price it must stay in the fit: measured, routing them out moved
 * `manaWeight` far enough that a land-for-two-life conversion read as paying
 * and the engine stopped being held. A source that sacrifices ITSELF (a
 * fetchland, `cost.sacrifice`) converts nothing else and stays in.
 */
export function isDeferrableAction(
    state: GameState,
    pid: string,
    move: Move
): boolean {
    if (state.stack.length > 0) return false;
    if ((state.combat?.attackerIds.length ?? 0) > 0) return false;
    const player = state.players.find((p) => p.id === pid);
    if (!player) return false;
    if (move.kind === "cast-spell") {
        const card = castCardOf(player, move.cardInstanceId);
        if (!card || !hasInstantSpeed(card)) return false;
        if (isPreAttackGrant(state, pid, move)) return false;
        return reachesOnlyOwnSide(state, pid, move.targets, card);
    }
    if (move.kind === "activate-ability") {
        const source = player.battlefield.find(
            (c) => c.id === move.cardInstanceId
        );
        if (!source) return false;
        const ability = effectiveAbilityOf(source, move.abilityId);
        if (!ability || !isDeferrableStackAbility(ability)) return false;
        if (ability.cost.sacrificeFilter !== undefined) return false;
        return reachesOnlyOwnSide(state, pid, move.targets);
    }
    return false;
}

/**
 * Is `move` a PRE-ATTACK GRANT for `pid` — an own-side haste grant whose whole
 * worth is the attack it enables THIS turn, cast in the last windows before
 * that attack is declared (issue #4768)?
 *
 * The timing, printed rather than recalled: attackers are declared as the
 * first act of the declare attackers step, a turn-based action with no
 * priority before it (CR 508.1), and each attacker "must either have haste or
 * have been controlled by the active player continuously since the turn
 * began" (CR 508.1a, 302.6, 702.10b). The grant lasts "until end of turn"
 * (CR 514.2). So its useful windows are the active player's own precombat
 * main phase and beginning of combat step (CR 507.2 gives priority there);
 * past them it buys nothing. Between the two only priority passes and
 * beginning-of-combat triggers happen, and the Bot's search models neither
 * bluffing nor the information a main-phase cast gives away — so for the
 * search they are one window (the {T}-ability half of CR 302.6 is left to it:
 * this predicate answers only for a body the grant lets attack).
 *
 * All required, every doubt answering `false`:
 *
 *  - own turn, precombat main or beginning of combat, empty stack, no attack
 *    declared;
 *  - a CAST of an instant-speed card whose script expires this turn and
 *    grants haste at its top level. Activations are out, fail-closed: an
 *    activated haste grant is the `hold-trick` rule's (a transient activation
 *    at sorcery timing, `isSorcerySpeedTrickDump`), can carry a sacrifice of
 *    another permanent (the conversion class the perimeter keeps out), and in
 *    the catalogue mostly grants to its own source with no announced target;
 *  - at least one announced target, and every one of them a creature `pid`
 *    controls that cannot attack now only because it is summoning-sick
 *    (`isTapLockedBySummoningSickness`) and could attack with haste — asked
 *    of `validateAttackerEligibility`, the one reading of CR 508.1a-c, so a
 *    tapped body, a defender or a body under an attack prohibition enables
 *    nothing and is refused.
 */
export function isPreAttackGrant(
    state: GameState,
    pid: string,
    move: Move
): boolean {
    if (move.kind !== "cast-spell") return false;
    if (state.activePlayerId !== pid) return false;
    if (
        state.phase !== "PRECOMBAT_MAIN" &&
        state.phase !== "BEGINNING_OF_COMBAT"
    ) {
        return false;
    }
    if (state.stack.length > 0) return false;
    if ((state.combat?.attackerIds.length ?? 0) > 0) return false;
    const player = state.players.find((p) => p.id === pid);
    if (!player) return false;
    const card = castCardOf(player, move.cardInstanceId);
    if (!card || !hasInstantSpeed(card)) return false;
    const script = castScriptOf(card);
    if (!script || !expiresThisTurn(script)) return false;
    if (!script.some(isHasteGrant)) return false;
    if (move.targets.length === 0) return false;
    const defenders = state.players
        .filter((p) => p.id !== pid)
        .flatMap((p) => p.battlefield);
    return move.targets.every((t) => {
        if (t.type !== "permanent") return false;
        const body = player.battlefield.find((c) => c.id === t.id);
        if (!body || !isTapLockedBySummoningSickness(body)) return false;
        const hasty = {
            ...body,
            staticAbilities: [...body.staticAbilities, "haste"],
        };
        return validateAttackerEligibility(hasty, defenders, state).eligible;
    });
}

/**
 * Does `move`'s whole effect EXPIRE THIS TURN (CR 514.2 / 500.5a) — a pump, a
 * protection grant, any until-end-of-turn script?
 *
 * The question the last-window half of issue #4757 asks before it spends a
 * deferrable action at the opponent's end step (CR 513.1): nothing happens
 * between that window and the cleanup step, so an effect that ends there buys
 * nothing, and "the action does not worsen the position" is false for it — it
 * spends a card or a mana for an effect with nothing left to act on. The same
 * action in an EARLIER window is the hold half's business, which waits for
 * the last window with it like with any other deferrable action.
 *
 * Proven-transient only: a cast whose card carries no readable script (an
 * imperative `resolve()`, a permanent spell) and an activation with none are
 * NOT transient — the reading `isTransientOnlyAbility` already makes. The
 * direction is chosen by the hold half: an action the hold defers and the
 * fire refuses is never taken at all, so the refusal claims only what it can
 * prove.
 */
export function isTransientOnlyAction(
    state: GameState,
    pid: string,
    move: Move
): boolean {
    const player = state.players.find((p) => p.id === pid);
    if (!player) return false;
    if (move.kind === "cast-spell") {
        const card = castCardOf(player, move.cardInstanceId);
        const script = card ? castScriptOf(card) : undefined;
        return !!script && script.length > 0 && isTransientOnlyScript(script);
    }
    if (move.kind === "activate-ability") {
        const source = player.battlefield.find(
            (c) => c.id === move.cardInstanceId
        );
        const ability = source
            ? effectiveAbilityOf(source, move.abilityId)
            : undefined;
        return !!ability && isTransientOnlyAbility(ability);
    }
    return false;
}

function isHasteGrant(op: EffectOp): boolean {
    return op.op === "grantAbility" && op.ability === "haste";
}

/** The script ends within this turn (CR 514.2 / 500.5a). An absent script (an
 *  imperative `resolve()` card) is unreadable, so it is NOT called transient —
 *  {@link isPreAttackGrant} claims only what it can prove. */
function expiresThisTurn(script: readonly EffectOp[] | undefined): boolean {
    return script !== undefined && isTransientOnlyScript(script);
}

/** The Effect Script a cast resolves — its definition's `effects`. */
function castScriptOf(
    card: CardInstanceState
): readonly EffectOp[] | undefined {
    const cardId = (card.card as { id?: string } | undefined)?.id;
    return cardId ? tryGetDefinition(cardId)?.effects : undefined;
}

/** The card a cast names, from any zone a cast may come from (hand, and the
 *  graveyard / exile / library permissions — `CastFromZone`). */
function castCardOf(
    player: GameState["players"][number],
    id: string
): CardInstanceState | undefined {
    for (const zone of [
        player.hand,
        player.graveyard,
        player.exile,
        player.library,
    ]) {
        const card = zone.find((c) => c.id === id);
        if (card) return card;
    }
    return undefined;
}

/**
 * Clause 2: does the action name only its controller's own objects?
 *
 * Why not one of the own-side predicates `search.ts` already has (issue #4764
 * asked for a reuse "after checking it answers this question" — neither does):
 *
 *  - `targetsOnlyOwnPermanents` is a CAST-only, PERMANENT-only test that is
 *    `false` for a move with no target at all — the draw instant, the flash
 *    body, the fetch crack are exactly the untargeted shapes this perimeter
 *    exists for;
 *  - `reachesOnlyOwnSideThroughChoice` answers "self-confined AND futile"
 *    (`isSelfConfinedFutileMove` requires a do-nothing branch) through a probe
 *    that refuses every permanent spell, so every flash creature fails it.
 *
 * So it is read off the objects the action NAMES:
 *
 *  - every announced target is the controller's own — its own player, a
 *    permanent it controls, a card in its own graveyard or hand. A stack
 *    target is never own-side here (clause 3 empties the stack anyway);
 *  - a permanent spell's entering triggers (`PERMANENT_ENTERED` — the ETB
 *    Ability and any "whenever a … enters" it would fire on itself) choose
 *    their targets later (CR 603.3d), so the Move cannot carry them: they are
 *    asked of the CURRENT board through `getLegalTargets`, the targeting
 *    authority, and one legal opposing target makes the cast reach the
 *    opponent. A Snapcaster whose ETB can only point at its own graveyard
 *    stays deferrable; a Flametongue Kavu facing an opposing creature does
 *    not.
 *
 * KNOWN LIMIT, stated rather than hidden: an UNTARGETED effect that reaches
 * the opponent ("each opponent loses 1 life", a symmetric sweep at instant
 * speed) names no object and passes this clause. If a verdict ever shows
 * one, a resolution probe of the opponent's record is the widening.
 */
export function reachesOnlyOwnSide(
    state: GameState,
    pid: string,
    targets: readonly TargetSelection[],
    castCard?: CardInstanceState
): boolean {
    if (!targets.every((t) => isOwnSideTarget(state, pid, t))) return false;
    if (!castCard) return true;
    const cardId = (castCard.card as { id?: string } | undefined)?.id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (!def) return false;
    const source = targetingSourceFromCard(castCard, false);
    for (const trigger of def.triggeredAbilities ?? []) {
        const events = Array.isArray(trigger.event)
            ? trigger.event
            : [trigger.event];
        if (!events.includes("PERMANENT_ENTERED")) continue;
        // A modal trigger (CR 700.2b) carries its requirements per mode: any
        // mode that can point at the opponent's side takes the cast out.
        const requirements = [
            trigger.targetRequirement,
            ...(trigger.modes ?? []).map((m) => m.targetRequirement),
        ];
        for (const requirement of requirements) {
            if (!requirement) continue;
            const legal = getLegalTargets(state, requirement, source, pid);
            if (!legal.every((t) => isOwnSideTarget(state, pid, t)))
                return false;
        }
    }
    return true;
}

function isOwnSideTarget(
    state: GameState,
    pid: string,
    target: TargetSelection
): boolean {
    switch (target.type) {
        case "player":
            return target.id === pid;
        case "permanent": {
            const me = state.players.find((p) => p.id === pid);
            return !!me?.battlefield.some((c) => c.id === target.id);
        }
        case "graveyard-card":
        case "hand-card":
            return target.playerId === pid;
        case "spell":
            return false;
    }
}
