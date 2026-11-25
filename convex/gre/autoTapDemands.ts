import { getInstanceManaCost, tryGetDefinition } from "../cards";
import {
    CASTABLE_PERMANENT_TYPES,
    type ActivatedAbility,
    type EffectOp,
} from "../cards/types";
import { classLevelActivationViolation } from "../cards/abilities/classLevels";
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import { activationPreconditionViolation } from "./activationPrecondition";
import type { Demand } from "./autoTap";
import { stampCastFace } from "./castCommit";
import {
    abilitiesSuppressed,
    hasInstantSpeed,
    isManaAbilityForRules,
    isTapLockedBySummoningSickness,
} from "./constants";
import { totalKickerCount } from "./kicker";
import type { Phase } from "./types";
import type { CardInstanceState, GameState, PendingCast } from "./state";
import {
    applyCostModifiers,
    applyEntersWithCounters,
    applyExistingGrantsTo,
    beginApplyingStaticEffects,
    getCostModifiers,
    markEnteredThisTurn,
    normalizeManaCost,
    shouldEnterTapped,
} from "./state";

/**
 * Build the **hand-spell Demands** for smart auto-tap (PRD #472, ADR 0034,
 * issue #474 — the spine).
 *
 * A Demand here is *another* spell in the paying player's hand whose mana cost
 * the solver tries not to strand when it auto-taps for the spell being cast.
 * This is the demand-aware spine: it enumerates every castable-shaped hand
 * card other than the one currently being paid for, carrying its normalized
 * mana cost. The auto-tap scorer (`scorePreservedDemands`) then measures, for
 * each candidate tap plan, how many of these stay individually affordable
 * after the payment.
 *
 * **Timing filter (issue #475, CR 307 / 601.3a / 602 / 603).** A hand spell is
 * a preservable Demand only when it is legal to *cast at the current timing*:
 *  - Instant-speed spells (Instants and Flash cards, CR 702.8) can be cast in
 *    any priority window, including the opponent's turn — they always count.
 *  - Sorcery-speed spells (creatures, sorceries, and any non-flash permanent)
 *    may be cast only when the player could cast a sorcery (CR 307.1 / 601.3a):
 *    their own main phase, empty stack, holding priority. They count only when
 *    `isSorceryTiming` is true. Off-turn / instant-window payments do NOT
 *    preserve mana for them — auto-tap must not hoard mana for plays the player
 *    cannot legally make right now (PRD #472 user stories 4 & 5).
 *
 * `isSorceryTiming` is computed by the caller via the engine's existing
 * `isSorceryTiming(state)` helper (`phases.ts`) — the timing condition is never
 * re-derived here. Instant-speed legality is the canonical `hasInstantSpeed`
 * predicate (`constants.ts`).
 *
 * Scope of this slice (deliberately narrow — siblings layer on top):
 *  - Lands are skipped (they aren't cast and have no mana cost).
 *  - Cards with no mana cost (can't strand mana) are skipped.
 *  - The card being cast (`excludeInstanceId`) is excluded — it's the payment
 *    target, not a Demand.
 *
 * **X-spells assumed at X=1 (issue #477, CR 107.3 / 601.2b).** A variable-X
 * spell ({X}{R} Fireball, {X}{U} Power Sink) is folded into the Demand set at
 * an assumed **X=1** — its preserve-cost is the base cost plus one generic per
 * `{X}` pip (`xFactor`: {X}{X}{U} → X=1 contributes 2 generic). X=0 would
 * under-preserve and strand the spell: on any turn the player actually casts an
 * X-spell, at least one mana goes to X, so reserving for X=1 is the minimum
 * meaningful demand. This is achieved by handing `chosenX: 1` to
 * `normalizeManaCost`, which (CR 107.3) only folds the chosen X into the generic
 * portion when the cost's `X` is the *variable* `"X"`; a fixed-number X (plain
 * generic) is untouched. Downstream affordability still decides whether X=1 is
 * actually payable from leftover sources — an X-spell unaffordable even at X=1
 * is simply not preserved (no false preservation).
 *
 * Demand affordability *before* and *after* payment is decided downstream in
 * `solveSmartAutoTap` against the real untapped sources + floating mana — this
 * helper only assembles the candidate cost list, deterministically in hand
 * order.
 */
export function buildHandSpellDemands(
    hand: CardInstanceState[],
    excludeInstanceId: string,
    isSorceryTiming: boolean
): Demand[] {
    const demands: Demand[] = [];
    for (let i = 0; i < hand.length; i++) {
        const card = hand[i];
        if (card.id === excludeInstanceId) continue;
        // Lands aren't cast (CR 305.1) — no mana cost to preserve for.
        if (card.types.includes("Land")) continue;
        // Timing filter (CR 307.1 / 601.3a): a sorcery-speed spell is a
        // preservable Demand only at sorcery timing; instant-speed spells
        // (Instant / Flash, CR 702.8) count in any priority window.
        if (!hasInstantSpeed(card) && !isSorceryTiming) continue;
        const rawCost = getInstanceManaCost(card);
        if (!rawCost) continue;
        // X-spell inflation (issue #477, CR 107.3 / 601.2b): assume X=1 so a
        // variable-X spell ({X}{R}) is preserved as base + one generic per `{X}`
        // pip. `chosenX` is a no-op for fixed (already-generic) costs — it only
        // folds into the generic portion when the printed `X` is the variable
        // `"X"`, matching how the engine resolves an announced X.
        const cost = normalizeManaCost(rawCost, { chosenX: 1 });
        // A free (no-mana) spell can never be stranded by auto-tap.
        if (Object.keys(cost).length === 0) continue;
        demands.push({ id: card.id, cost });
    }
    return demands;
}

/** The timing facts an ability Demand is filtered by (CR 602.5), read once by
 *  the caller off the live state. */
export interface AbilityDemandTiming {
    phase: Phase;
    isControllersTurn: boolean;
    /** The paying player's sorcery window (CR 307.1, `isSorceryTimingFor`). */
    isSorceryTiming: boolean;
}

/**
 * Build the **on-board-ability Demands** for smart auto-tap (PRD #472, ADR
 * 0034, issue #476).
 *
 * In addition to hand spells (`buildHandSpellDemands`), the active player's
 * already-resolved permanents may carry activated abilities that cost mana —
 * a firebreathing creature's `{R}: +1/+0` (CR 602.1, an activated ability of
 * the form *cost: effect*). Each such ability is another play the player might
 * still pay for this turn, so the solver tries not to strand its mana cost.
 *
 * **Counted once (PRD user story 12).** A repeatable ability ("activate any
 * number of times") is emitted as exactly *one* Demand per (permanent,
 * ability) pair — the question is "can I still activate it at least once?",
 * not "can I activate it N times?". A firebreathing creature therefore
 * contributes a single {R} Demand, not one per potential pump, so it does not
 * over-weight the scorer. Two distinct firebreathing creatures are two
 * distinct plays → two Demands (one each), which is correct.
 *
 * **What counts (CR 602.1).** Only abilities that:
 *  - actually carry a mana cost (`cost.mana`, non-empty after normalization) —
 *    an ability with no mana cost can never have its mana stranded;
 *  - are NOT mana abilities (`useStack: false` with a mana output) — those
 *    *produce* mana and are auto-tap *sources*, not Demands, and are already
 *    modeled by `buildAutoTapSources`.
 * Suppressed permanents (CR 613.1f — Humility / Blood Moon) expose none of
 * their printed activated abilities and are skipped.
 *
 * **Timing filter (issue #475, CR 602.5b).** An activated ability is a
 * preservable Demand only when it is legal to activate at the current timing,
 * checked per ability against the live timing facts:
 *  - By default activated abilities are instant-speed (CR 602.5b — any time you
 *    have priority), so they count in any window the auto-tap runs in.
 *  - `controllerTurnOnly` ("Activate only during your turn") counts only on the
 *    paying player's own turn (`isControllersTurn`).
 *  - `activationPhaseRestriction` ("Activate only during combat", Jade Statue)
 *    counts only while the current `phase` is in that list. This is what makes
 *    a combat-only ability *not* held for during a main phase even though it is
 *    its controller's turn.
 *  - `sorcerySpeedOnly` ("Activate only as a sorcery", Equip) counts only in
 *    the paying player's own sorcery window (`isSorceryTiming`).
 *  - a {T} cost on a tapped or summoning-sick creature, an ability that
 *    functions only outside the battlefield, a once-per-turn ability already
 *    used and a printed restriction that fails right now do not count.
 * The restrictions compose (an ability with several must satisfy all). This
 * mirrors the hand-spell timing filter so auto-tap never hoards mana for a
 * play the player cannot legally make right now (PRD user stories 5 & 17).
 *
 * X in a cost is treated as 0 here (`normalizeManaCost` default), matching the
 * hand-spell helper; X-cost ability inflation is out of scope for this slice
 * (issue #477 handles X-spells).
 *
 * **Reserved at the MODIFIED cost (CR 601.2f, ADR 0096, issue #2288).** The
 * amount reserved is what the server would actually charge — the battlefield
 * `cost-modifier` scan plus the ability's own `cost.selfReduction` — not the
 * printed `cost.mana`. That is why this helper needs the whole `state`: the
 * scan is board-wide and the reduction's count is read off the reserving
 * player's permanents. Reserving the PRINTED cost for an ability that now
 * costs less strands mana the player needed elsewhere, and it makes the
 * solver disagree with the mutation that will charge the activation.
 *
 * Demand affordability *before* and *after* payment is decided downstream in
 * `solveSmartAutoTap` — this helper only assembles the candidate cost list,
 * deterministically in battlefield order then ability order. The Demand `id`
 * is `${permanentId}#${abilityId}` so two abilities on one permanent (and the
 * same ability across permanents) stay distinct for debugging.
 */
export function buildBoardAbilityDemands(
    state: GameState,
    battlefield: CardInstanceState[],
    timing: AbilityDemandTiming
): Demand[] {
    const demands: Demand[] = [];
    for (let i = 0; i < battlefield.length; i++) {
        demands.push(...permanentAbilityDemands(state, battlefield[i], timing));
    }
    return demands;
}

/** The Demands of one permanent's activated abilities: the shared body of
 *  `buildBoardAbilityDemands` and `buildCastPermanentAbilityDemands`. */
function permanentAbilityDemands(
    state: GameState,
    perm: CardInstanceState,
    timing: AbilityDemandTiming
): Demand[] {
    // CR 613.1f — a permanent that has lost all abilities exposes none of
    // its printed activated abilities.
    if (abilitiesSuppressed(perm)) return [];
    const demands: Demand[] = [];
    // CR 113.1 / 611.2a (issue #1880) — POST-LAYER set: an ability GRANTED
    // to this permanent competes for mana exactly like a printed one, so
    // auto-tap must reserve for it too.
    const entries = getEffectiveActivatedAbilities(perm);
    for (let j = 0; j < entries.length; j++) {
        const { ability } = entries[j];
        if (!ability.cost.mana) continue;
        // Mana abilities (CR 605.1a) PRODUCE mana — they're sources, not
        // Demands (handled by `buildAutoTapSources`).
        if (isManaAbilityForRules(ability)) continue;
        if (!isActivatableNow(state, perm, ability, timing)) continue;
        const cost = normalizeManaCost(ability.cost.mana);
        // CR 601.2f (ADR 0096) — reserve the REDUCED total, through the
        // same collector + apply pair the `activateAbility` mutation uses.
        applyCostModifiers(
            cost,
            getCostModifiers(state, perm, "ability", ability)
        );
        // A free (no-mana) ability can never be stranded by auto-tap.
        if (Object.keys(cost).length === 0) continue;
        // Counted once per (permanent, ability) — repeatable activations do
        // NOT multiply the Demand (PRD user story 12).
        demands.push({
            id: `${perm.id}#${ability.id}`,
            cost,
            // The untap-price gate never buys a source's tap with the
            // ability that untaps that very source.
            ...(scriptUntapsItsSource(ability.effects)
                ? { untapsSourceId: perm.id }
                : {}),
        });
    }
    return demands;
}

/** True when `perm`'s controller could activate `ability` at the current
 *  timing, mana aside (CR 602.5): an ability they cannot activate must not
 *  reserve mana for itself. */
function isActivatableNow(
    state: GameState,
    perm: CardInstanceState,
    ability: ActivatedAbility,
    timing: AbilityDemandTiming
): boolean {
    // CR 113.6 — Cycling and its kin function only outside the battlefield.
    if (ability.activateFromHand || ability.activateFromGraveyard) return false;
    // CR 602.1b — "Only your opponents may activate this ability".
    if (ability.activatableByOpponentsOnly) return false;
    if (ability.controllerTurnOnly === true && !timing.isControllersTurn)
        return false;
    // CR 602.5d — "activate only as a sorcery" (Equip).
    if (ability.sorcerySpeedOnly === true && !timing.isSorceryTiming)
        return false;
    if (
        ability.activationPhaseRestriction &&
        ability.activationPhaseRestriction.length > 0 &&
        !ability.activationPhaseRestriction.includes(timing.phase)
    ) {
        return false;
    }
    // CR 702.142a (Boast, issue #2375) — "Activate only if this creature
    // attacked this turn". Absence IS "did not attack": the engine only ever
    // writes the flag `true` (`recordAttackerDeclared`, gre/combat.ts).
    if (
        ability.requiresAttackedThisTurn === true &&
        perm.hasAttackedThisTurn !== true
    )
        return false;
    // CR 716.2a (issue #3234) — a level bar the Class's current level does not
    // admit.
    if (classLevelActivationViolation(perm, ability) !== null) return false;
    if (
        ability.oncePerTurn === true &&
        (perm.activationsThisTurn?.[ability.id] ?? 0) > 0
    )
        return false;
    // CR 302.6 — a {T} cost of a tapped or summoning-sick creature.
    if (
        ability.cost.tap === true &&
        (perm.isTapped || isTapLockedBySummoningSickness(perm))
    )
        return false;
    // CR 602.1b / 602.5 — the ability's own printed restriction, through the
    // predicate the mutation and the Bot read.
    return activationPreconditionViolation(state, perm, ability) === null;
}

/**
 * Build the Demands of **the permanent being cast**: the mana-costed activated
 * abilities it will have once it resolves, when they are activatable this turn
 * ("{R}, Sacrifice this artifact: …", usable at the next priority after it
 * resolves, CR 117.3b). Paying for the spell must not strand the ability
 * it was cast for.
 *
 * The permanent is read as it WILL be, never as the card in hand: on a clone of
 * the state the card leaves its zone, takes the face its cast mode gives it
 * (CR 601.2b), and enters under its caster's control — tapped or not
 * (CR 614.1d), summoning sick (CR 302.6), with its entry counters (CR 122.6a)
 * and under every live continuous effect (CR 613.1). Its abilities then pass
 * the very gates a board ability passes, so a {T} ability on a creature without
 * haste is no Demand. An instant or sorcery, whatever the card's other face,
 * yields nothing.
 *
 * `timing` is the window of the payment. A spell cast at sorcery timing hands
 * that same window back when it resolves (CR 117.3b: the active player receives
 * priority, on an empty stack); one cast in any other window does not, so a
 * sorcery-speed ability counts only in the former.
 *
 * Not modelled: what a player chooses as the permanent enters (CR 614.12a — a
 * copy, a named type), what the mana still being paid would give it (a Sunburst
 * count, a haste rider) and what its enters triggers would do (CR 603.6a —
 * Dash's haste among them).
 */
export function buildCastPermanentAbilityDemands(
    state: GameState,
    pending: PendingCast,
    castCard: CardInstanceState,
    timing: AbilityDemandTiming
): Demand[] {
    const sim = structuredClone(state);
    const perm = structuredClone(castCard);
    stampCastFace(sim, perm, pending);
    const permanentTypes: readonly string[] = CASTABLE_PERMANENT_TYPES;
    if (!perm.types.some((t) => permanentTypes.includes(t))) return [];
    const playerList = sim.players;
    for (let i = 0; i < playerList.length; i++) {
        const player = playerList[i];
        const others = (c: CardInstanceState) => c.id !== perm.id;
        player.hand = player.hand.filter(others);
        player.library = player.library.filter(others);
        player.graveyard = player.graveyard.filter(others);
        player.exile = player.exile.filter(others);
    }
    const caster = playerList.find((p) => p.id === pending.playerId);
    if (!caster) return [];
    perm.zone = "battlefield";
    perm.controllerId = caster.id;
    const def = tryGetDefinition((perm.card as { id?: string }).id ?? "");
    // The entry funnel's order (`finalizeSpellResolution`, state.ts).
    perm.isTapped = shouldEnterTapped(sim, perm);
    markEnteredThisTurn(perm, sim.turn);
    if (pending.chosenX !== undefined) perm.chosenXOnCast = pending.chosenX;
    if (totalKickerCount(pending.kickerPayments) >= 1) perm.wasKicked = true;
    caster.battlefield.push(perm);
    applyEntersWithCounters(
        perm,
        def ?? undefined,
        {
            chosenX: pending.chosenX,
            kickerCount: totalKickerCount(pending.kickerPayments),
            kickerPayments: pending.kickerPayments,
            impended: pending.impended,
            manaSpentToCast: {},
        },
        sim
    );
    applyExistingGrantsTo(sim, perm);
    beginApplyingStaticEffects(sim, perm);
    return permanentAbilityDemands(sim, perm, timing);
}

/** The ManaCost keys a static untap price is read from (CR 202.1): a cost
 *  with any other key (life, sacrifice, a dynamic leg) has no mana price. */
const UNTAP_PRICE_MANA_KEYS = new Set(["W", "U", "B", "R", "G", "C", "X"]);

/** Total mana of a static mana cost, or `undefined` when the cost is not pure
 *  mana (a life leg, a sacrifice, a dynamic amount). A `{ mana: … }` leg is
 *  read through when it is the only leg. */
function staticManaTotal(cost: unknown): number | undefined {
    if (!cost || typeof cost !== "object") return undefined;
    const entries = Object.entries(cost as Record<string, unknown>);
    if (entries.length === 1 && entries[0][0] === "mana") {
        return staticManaTotal(entries[0][1]);
    }
    let total = 0;
    for (let i = 0; i < entries.length; i++) {
        const [key, value] = entries[i];
        if (!UNTAP_PRICE_MANA_KEYS.has(key) || typeof value !== "number") {
            return undefined;
        }
        total += value;
    }
    return total;
}

/** True when the script untaps its own source (`tapUntap` untap `$source`),
 *  at top level or inside an `if` branch (CR 701.26b). */
export function scriptUntapsItsSource(
    effects: readonly EffectOp[] | undefined
): boolean {
    const opList = effects ?? [];
    for (let i = 0; i < opList.length; i++) {
        const op = opList[i];
        if (
            op.op === "tapUntap" &&
            op.action === "untap" &&
            "ref" in op.target &&
            op.target.ref === "$source"
        ) {
            return true;
        }
        if (
            op.op === "if" &&
            (scriptUntapsItsSource(op.then) || scriptUntapsItsSource(op.else))
        ) {
            return true;
        }
    }
    return false;
}

/** The mana a triggered ability's `mayPay` asks before its script untaps its
 *  own source ("you may pay {4}. If you do, untap this artifact"). */
function mayPayUntapPrice(
    effects: readonly EffectOp[] | undefined
): number | undefined {
    if (!scriptUntapsItsSource(effects)) return undefined;
    const opList = effects ?? [];
    for (let i = 0; i < opList.length; i++) {
        const op = opList[i];
        if (op.op === "mayPay") return staticManaTotal(op.cost);
    }
    return undefined;
}

/** Fixed damage a triggered ability deals to its controller (Mana Vault's
 *  "it deals 1 damage to you"). */
function damageToController(effects: readonly EffectOp[] | undefined): number {
    let total = 0;
    const opList = effects ?? [];
    for (let i = 0; i < opList.length; i++) {
        const op = opList[i];
        if (
            op.op === "dealDamage" &&
            typeof op.amount === "number" &&
            "player" in op.to &&
            op.to.player === "controller"
        ) {
            total += op.amount;
        }
    }
    return total;
}

/**
 * **Untap price** of a mana source that will not untap by itself (CR 502.3:
 * an effect keeps it from untapping during its controller's untap step), or
 * `undefined` for a source that untaps normally.
 *
 * Read from the permanent's EFFECTIVE characteristics, never per card:
 * `does-not-untap` from the post-layer `staticAbilities` (a granted keyword
 * counts, a removed one does not), the untap routes from its effective
 * activated abilities and, while it keeps its abilities, its triggered ones:
 *  - an activated ability whose only cost is mana and whose script untaps its
 *    own source (Basalt Monolith 3, Grim Monolith 4);
 *  - a triggered `mayPay` whose script untaps its own source (Mana Vault 4).
 * The cheapest route wins; each fixed damage a triggered ability of the
 * source deals to its controller adds 1 (Mana Vault: 4 + 1 = 5). No mana
 * route = `Infinity`: no benefit ever buys the tap.
 *
 * CR-neutral: a planning price for Auto-Tap (CR 601.2g gives the player the
 * chance to activate mana abilities, never which), not a rule.
 */
export function sourceUntapPrice(card: CardInstanceState): number | undefined {
    if (!card.staticAbilities.includes("does-not-untap")) return undefined;
    let cheapest = Number.POSITIVE_INFINITY;
    const entries = getEffectiveActivatedAbilities(card);
    for (let i = 0; i < entries.length; i++) {
        const { ability } = entries[i];
        if (!scriptUntapsItsSource(ability.effects)) continue;
        const price = staticManaTotal(ability.cost);
        if (price !== undefined) cheapest = Math.min(cheapest, price);
    }
    let damage = 0;
    if (!abilitiesSuppressed(card)) {
        const cardId = (card.card as { id?: string }).id;
        const triggers = cardId
            ? (tryGetDefinition(cardId)?.triggeredAbilities ?? [])
            : [];
        for (let i = 0; i < triggers.length; i++) {
            const trigger = triggers[i];
            const price = mayPayUntapPrice(trigger.effects);
            if (price !== undefined) cheapest = Math.min(cheapest, price);
            damage += damageToController(trigger.effects);
        }
    }
    return cheapest + damage;
}
