// Danger Clock — the race term of the Bot's position evaluation (ADR 0018,
// issue #196).
//
// Each player has a clock: how fast their board kills the other player. The
// evaluation rewards holding the FASTER clock, so the Bot defends when its own
// clock is short (an opposing board about to kill it) and presses damage when it
// holds the faster clock instead of turtling. This estimates the threat BEYOND
// the rollout's turn-boundary horizon (ADR 0015) — the rollout plays out one
// round of realized damage; the clock reads the steady state past it.
//
// PURE. The incoming-damage estimate is net of available blockers via a crude
// best-block assignment (the defender chumps the biggest threats), and respects
// the SAME keyword evasion the real combat resolver uses — `combatRegistry`'s
// `evaluateBlockerKeywords` / `evaluateAttackerKeywords` — so which blocks are
// legal never drifts from how combat actually resolves. (The combat resolver's
// own `bestDefenderBlocks` is eval-based; reusing it here would recurse through
// `evaluate`, so the Clock shares the legality rules and does its own crude,
// non-eval assignment, exactly as ADR 0018 specifies.)
//
// The NEXT OPPOSING COMBAT (issue #6909). The clock is steady-state on purpose,
// but one half of it is not symmetric in time: when the DEFENDER is the active
// player, the attacker's next combat comes BEFORE the defender's next untap
// step (CR 502.3 — only the active player's permanents untap), so a creature
// the defender tapped this turn — an attacker without vigilance (CR 702.20b),
// a mana creature — is no blocker in it. And the attacker's board is sized at
// what its mana buys, not its printed power: the mana-sink pumps and trample
// grants its permanents carry (`activatedCombatPumps`), paid from the mana
// base that untaps on its turn, so a firebreather or a Mantle-enchanted cat
// reads as the crackback it is. Both are read deterministically here rather
// than left to the rollout to sample: the lethal line needs the opponent to
// pump N times then swing, a sequence the ε-greedy playout rarely finds.

import {
    hasInfect,
    type CardInstanceState,
    type GameState,
    type PlayerState,
} from "./state";
import {
    beginLayer7Pass,
    getEffectivePT,
    type EffectivePT,
    type Layer7Pass,
} from "./layers";
import { isCreature, POISON_LOSS_COUNTERS } from "./constants";
import {
    evaluateBlockerKeywords,
    evaluateAttackerKeywords,
} from "./combatRegistry";
import {
    activatedCombatPumps,
    type ActivatedPump,
    type HeldPump,
} from "./heldInteraction";
import { spendCost, type ManaUnits } from "./manaAvailability";
import { censusOf, type ManaCensusMemo } from "./manaCensusMemo";

/** Reward magnitude for holding a one-combat-lethal clock (a full fraction).
 *  Forge-scale (ADR 0018) but kept below a creature's worth (~170) so the clock
 *  is a positional nudge — defend / press — not an override of material. */
const W_CLOCK = 150;

/** What one combat's unblocked attackers send at the defending player: `damage`
 *  reaches their life, `poison` — the infect attackers' share (CR 702.90b) —
 *  their poison counters. */
export type UnblockedThreat = { damage: number; poison: number };

/** Crude, pure prediction of the combat damage `attackerId`'s board pushes
 *  through `defenderId`'s blockers in one combat, assuming the defender blocks to
 *  minimise damage taken (chump the biggest threats first). Forward-looking: it
 *  ignores tapped / summoning-sickness (both transient — the creatures untap and
 *  lose sickness on the relevant future turn), so it reads the steady-state clock
 *  rather than just this turn. Respects keyword evasion via `combatRegistry`.
 *  Life damage only — see `predictUnblockedThreat` for the infect share. */
export function predictUnblockedDamage(
    state: GameState,
    attackerId: string,
    defenderId: string,
    /** See `predictUnblockedThreat`. */
    pass: Layer7Pass = beginLayer7Pass(state),
    memo?: ManaCensusMemo
): number {
    return predictUnblockedThreat(state, attackerId, defenderId, pass, memo)
        .damage;
}

/** `predictUnblockedDamage`'s assignment, with the unblocked infect attackers'
 *  power split out as `poison` (issue #5153).
 *
 *  The defender's blockers are its creatures — ALL of them in the steady
 *  state, but only the UNTAPPED ones when the defender is the active player
 *  (issue #6909): the attacker's next combat then precedes the defender's
 *  next untap step (CR 502.3), so what the defender tapped this turn stays
 *  tapped through it and cannot block (CR 509.1a). The attackers carry the
 *  mana-sink pumps and trample grants their controller's board can pay for
 *  (`activatedCombatPumps`, budgeted against the mana base by
 *  `crackbackPumpPlan`); a trampler blocked by one creature still pushes its
 *  power past that blocker's toughness through (CR 702.19b). */
export function predictUnblockedThreat(
    state: GameState,
    attackerId: string,
    defenderId: string,
    /** The evaluation's layer-7 pass (issue #4462), when the caller is one;
     *  omitted, this prediction is its own pass. */
    pass: Layer7Pass = beginLayer7Pass(state),
    /** The evaluation's mana census memo (issue #4461), when the caller is
     *  one — the pump budget reads the attacker's mana base through it. */
    memo?: ManaCensusMemo
): UnblockedThreat {
    const threat: UnblockedThreat = { damage: 0, poison: 0 };
    const attacker = state.players.find((p) => p.id === attackerId);
    const defender = state.players.find((p) => p.id === defenderId);
    if (!attacker || !defender) return threat;
    const ptOf = (c: CardInstanceState): EffectivePT =>
        getEffectivePT(state, c, { pass });

    // Potential attackers: creatures that may attack (not defender-restricted).
    const eligible = attacker.battlefield.filter(
        (c) => isCreature(c) && evaluateAttackerKeywords(c).eligible
    );
    const plan = crackbackPumpPlan(
        state,
        attacker,
        eligible.map((c) => ({ id: c.id, power: ptOf(c).power })),
        memo
    );
    const powerOf = (c: CardInstanceState): number =>
        ptOf(c).power + (plan.get(c.id)?.power ?? 0);
    const tramples = (c: CardInstanceState): boolean =>
        c.staticAbilities.includes("trample") ||
        (plan.get(c.id)?.trample ?? false);
    const attackers = eligible
        .filter((c) => powerOf(c) > 0)
        .sort((a, b) => powerOf(b) - powerOf(a));

    // CR 502.3 / 509.1a — the active player's tapped creatures do not untap
    // before the opponent's next combat, so they are no blockers in it.
    const tapsPersist = defender.id === state.activePlayerId;
    const blockers = defender.battlefield.filter(
        (c) => isCreature(c) && (!tapsPersist || !c.isTapped)
    );
    const usedBlocker = new Set<string>();

    for (const atk of attackers) {
        // The defender spends a blocker on the biggest threats first; one legal,
        // unused blocker stops ALL of an attacker's damage (crude — toughness /
        // trades are not modelled, only damage prevented) — except a
        // trampler's, which pushes past the blocker's toughness (CR 702.19b).
        const blocker = blockers.find(
            (b) =>
                !usedBlocker.has(b.id) &&
                evaluateBlockerKeywords(atk, b, defender.battlefield).eligible
        );
        let through = powerOf(atk);
        if (blocker) {
            usedBlocker.add(blocker.id);
            through = tramples(atk)
                ? Math.max(0, through - Math.max(0, ptOf(blocker).toughness))
                : 0;
        }
        if (through <= 0) continue;
        if (hasInfect(atk)) threat.poison += through;
        else threat.damage += through;
    }
    return threat;
}

/** What one attacker gains from its controller's mana-sink pumps in the
 *  predicted combat: the power added and whether trample was bought. */
export type CrackbackPump = { power: number; trample: boolean };

/** Allocate `player`'s mana-sink pumps (`activatedCombatPumps`) over the
 *  `attackers` for one combat, bounded by the mana base their permanents
 *  make — the lands untap on their turn (CR 502.3), so the base, not what
 *  is untapped now, is the budget. Deterministic and greedy: trample grants
 *  are bought first (one each — the keyword does not stack), then pumps in
 *  order of power per pip, each activated as long as the pool pays
 *  (`spendCost`) and its single-use limit (once per turn, or a `{T}` leg)
 *  allows. A host-bound pump lands
 *  on its host (nothing when the host is not among the attackers); a
 *  targeted pump lands on the biggest attacker. Pure. */
export function crackbackPumpPlan(
    state: GameState,
    player: PlayerState,
    attackers: ReadonlyArray<{ id: string; power: number }>,
    memo?: ManaCensusMemo
): Map<string, CrackbackPump> {
    const plan = new Map<string, CrackbackPump>();
    if (attackers.length === 0) return plan;
    const pumps = activatedCombatPumps(state, player, memo);
    if (pumps.length === 0) return plan;
    const ids = new Set(attackers.map((a) => a.id));
    const biggest = attackers.reduce((best, a) =>
        a.power > best.power ? a : best
    );
    const hostOf = (pump: ActivatedPump): string | null => {
        if (pump.hostId === undefined) return biggest.id;
        return ids.has(pump.hostId) ? pump.hostId : null;
    };
    const pips = (pump: ActivatedPump): number =>
        Math.max(
            1,
            Object.values(pump.cost).reduce<number>(
                (sum, v) => sum + (typeof v === "number" ? v : 0),
                0
            )
        );
    const ordered = [...pumps].sort((a, b) => {
        if (a.trample !== b.trample) return a.trample ? -1 : 1;
        return b.power / pips(b) - a.power / pips(a);
    });
    let pool: ManaUnits = censusOf(state, player, memo).base;
    const opts = { life: player.life };
    for (const pump of ordered) {
        const host = hostOf(pump);
        if (host === null) continue;
        const entry = plan.get(host) ?? { power: 0, trample: false };
        plan.set(host, entry);
        const limit =
            pump.singleUse || (pump.trample && pump.power <= 0)
                ? 1
                : Number.POSITIVE_INFINITY;
        for (let uses = 0; uses < limit; uses++) {
            const next = spendCost(pool, pump.cost, opts);
            // Unpayable, or paid with nothing (a cost the reader let through
            // with no pip): either way the budget is done with this pump.
            if (next === null || next.length === pool.length) break;
            pool = next;
            entry.power += pump.power;
            if (pump.trample) entry.trample = true;
        }
    }
    return plan;
}

/** The predicted result of a DECLARED combat: the damage that gets through —
 *  to the defending player and, separately, to each attacked planeswalker —
 *  and the creatures that die on each side. Pure and valuation-free — the leaf
 *  evaluation (ADR 0020 §3) values the dead creatures itself, keeping this
 *  module free of the `evaluate` valuation it would otherwise depend on. */
export type CombatOutcome = {
    /** Combat damage reaching the defender's life — never an attacker
     *  declared against a planeswalker (CR 508.1b), whose damage is
     *  `walkerDamage`'s. */
    faceDamage: number;
    /** Combat damage from infect attackers reaching the defender, which lands
     *  as poison counters instead of life loss (CR 702.90b). */
    facePoison: number;
    /** Ids of the attacking player's creatures expected to die. */
    deadAttackerIds: string[];
    /** Ids of the defending player's blockers expected to die. */
    deadBlockerIds: string[];
    /** Combat damage reaching each attacked planeswalker, by its id: removed
     *  loyalty, not life (CR 510.1b, CR 120.3c). An id that has since left the
     *  battlefield is still keyed here; its attacker deals nothing (CR 510.1b),
     *  which the consumer reads by not finding the walker. */
    walkerDamage: Record<string, number>;
};

/** Crude, pure prediction of how the combat ALREADY DECLARED in `state.combat`
 *  resolves, from a sensible defender (ADR 0020 §3). It reuses the Danger Clock's
 *  legality helpers and greedy, biggest-threat-first shape rather than adding a
 *  second combat subsystem; the only addition over `predictUnblockedDamage` is
 *  that it tracks trades (which creatures die), not just damage prevented.
 *
 *  Per declared attacker (processed biggest-power-first), the defender:
 *    1. takes a block that KILLS the attacker and SURVIVES (free removal), else
 *    2. takes a TRADE that kills the attacker if the blocker is not bigger by
 *       body (P+T) — an even-or-favourable exchange, else
 *    3. lets it through (the attacker's power hits the defender's life).
 *  Toughness-only chumps are not modelled (a blocker that cannot kill the
 *  attacker is kept back) — crude, exactly as ADR 0018 specifies for the clock. */
export function predictCombatOutcome(
    state: GameState,
    attackerId: string,
    defenderId: string,
    attackerHeldPump?: HeldPump,
    /** See `predictUnblockedDamage`. */
    pass: Layer7Pass = beginLayer7Pass(state)
): CombatOutcome {
    const empty: CombatOutcome = {
        faceDamage: 0,
        facePoison: 0,
        deadAttackerIds: [],
        deadBlockerIds: [],
        walkerDamage: {},
    };
    const attacker = state.players.find((p) => p.id === attackerId);
    const defender = state.players.find((p) => p.id === defenderId);
    const combat = state.combat;
    if (!attacker || !defender || !combat) return empty;
    const ptOf = (c: CardInstanceState): EffectivePT =>
        getEffectivePT(state, c, { pass });

    const declared = combat.attackerIds
        .map((id) => attacker.battlefield.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => !!c && isCreature(c))
        .sort((a, b) => ptOf(b).power - ptOf(a).power);

    // Interaction-aware (ADR 0021, issue #229): a pump the ATTACKER holds in
    // hand is modelled on the attacker MOST LIKELY to be contested — the biggest
    // declared attacker (already first after the power sort). It is a held trick
    // the attacker casts in response to blocks, so the predictor must not
    // pre-judge that attacker as dead: its effective P/T gains the pump for this
    // prediction only. One trick → one creature (CR 601 single target).
    const pumpedId =
        attackerHeldPump && declared.length > 0 ? declared[0].id : undefined;
    const pumpP = (atk: { id: string }) =>
        atk.id === pumpedId ? (attackerHeldPump?.power ?? 0) : 0;
    const pumpT = (atk: { id: string }) =>
        atk.id === pumpedId ? (attackerHeldPump?.toughness ?? 0) : 0;

    // CR 509.1a — a declared combat's blockers must be untapped: what the
    // defender tapped (this turn's attackers, a mana creature) sits it out.
    const blockers = defender.battlefield.filter(
        (c) => isCreature(c) && !c.isTapped
    );
    const used = new Set<string>();
    const out: CombatOutcome = {
        faceDamage: 0,
        facePoison: 0,
        deadAttackerIds: [],
        deadBlockerIds: [],
        walkerDamage: {},
    };

    for (const atk of declared) {
        const atkPT = ptOf(atk);
        const atkP = Math.max(0, atkPT.power + pumpP(atk));
        const atkT = Math.max(0, atkPT.toughness + pumpT(atk));
        const legal = blockers.filter(
            (b) =>
                !used.has(b.id) &&
                evaluateBlockerKeywords(atk, b, defender.battlefield).eligible
        );

        // 1. Kills the attacker and survives — always worth it for the defender.
        const survivingKiller = legal.find((b) => {
            const pt = ptOf(b);
            return pt.power >= atkT && pt.toughness > atkP;
        });
        if (survivingKiller) {
            used.add(survivingKiller.id);
            out.deadAttackerIds.push(atk.id);
            continue;
        }

        // 2. Trades with the attacker (both die) — taken only when the blocker is
        // not bigger by body (P+T), a crude even-or-favourable-exchange proxy.
        const aSize = atkP + atkT;
        const trade = legal.find((b) => {
            const pt = ptOf(b);
            if (pt.power < atkT) return false; // can't kill atk
            const bSize = Math.max(0, pt.power) + Math.max(0, pt.toughness);
            return bSize <= aSize;
        });
        if (trade) {
            used.add(trade.id);
            out.deadAttackerIds.push(atk.id);
            out.deadBlockerIds.push(trade.id);
            continue;
        }

        // 3. Free absorbing block — a blocker that SURVIVES (toughness > the
        // attacker's power) prevents all of this attacker's face damage at no
        // cost, so a sensible defender takes it: nothing dies, no damage gets
        // through. This models the Giant-Spider-eats-the-3/5 case, the reason a
        // non-lethal chip attack into a bigger-bodied blocker gains the attacker
        // nothing. (The steady-state Danger Clock deliberately omits this — it
        // does not perma-commit a blocker; see `predictUnblockedDamage` — but a
        // DECLARED one-shot combat, which is all this predictor scores, does get
        // the free absorb.) A pure non-surviving chump is still NOT modelled: the
        // defender keeps a creature it would only trade down, and takes the hit.
        const absorber = legal.find((b) => ptOf(b).toughness > atkP);
        if (absorber) {
            used.add(absorber.id);
            continue;
        }

        // 4. Unblocked — CR 510.1b: its power reaches what it is attacking. A
        // planeswalker loses that much loyalty (CR 120.3c, infect or not);
        // the player takes it as life, or as poison counters for an infect
        // attacker (CR 702.90b).
        const walkerId = combat.attackTargets?.[atk.id];
        if (walkerId !== undefined) {
            out.walkerDamage[walkerId] =
                (out.walkerDamage[walkerId] ?? 0) + atkP;
        } else if (hasInfect(atk)) out.facePoison += atkP;
        else out.faceDamage += atkP;
    }

    return out;
}

/** One player's clock reward: how fast they kill the other, as the fraction of
 *  the defender's life removed per combat or, for infect attackers, of the
 *  poison counters the defender can still take before the CR 704.5c loss
 *  (issue #5153) — whichever is faster, since the two are separate ways to
 *  lose and never add up to one. Capped at one combat = lethal on board. Zero
 *  when nothing gets through. */
function clockReward(
    threat: UnblockedThreat,
    defenderLife: number,
    defenderPoison: number
): number {
    const lifeFraction =
        threat.damage > 0 ? threat.damage / Math.max(1, defenderLife) : 0;
    const poisonFraction =
        threat.poison > 0
            ? threat.poison / Math.max(1, POISON_LOSS_COUNTERS - defenderPoison)
            : 0;
    return W_CLOCK * Math.min(1, Math.max(lifeFraction, poisonFraction));
}

/** Signed Danger Clock contribution to `evaluate`, from `playerId`'s view:
 *  my clock reward (how fast I kill the opponent) minus the opponent's (how fast
 *  they kill me). Positive when I hold the faster clock, negative when an
 *  opposing board threatens me — symmetric, so the Bot both presses when ahead
 *  and defends when behind. Pure; zero on a creatureless or mirrored board. */
export function dangerClock(
    state: GameState,
    playerId: string,
    /** See `predictUnblockedDamage`. */
    pass: Layer7Pass = beginLayer7Pass(state),
    /** See `predictUnblockedThreat`. */
    memo?: ManaCensusMemo
): number {
    const me = state.players.find((p) => p.id === playerId);
    const opp = state.players.find((p) => p.id !== playerId);
    if (!me || !opp) return 0;

    const mine = predictUnblockedThreat(state, me.id, opp.id, pass, memo);
    const theirs = predictUnblockedThreat(state, opp.id, me.id, pass, memo);
    return (
        clockReward(mine, opp.life, opp.poisonCounters ?? 0) -
        clockReward(theirs, me.life, me.poisonCounters ?? 0)
    );
}
