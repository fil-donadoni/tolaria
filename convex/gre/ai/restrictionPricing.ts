// Restriction pricing for the Brain's leaf evaluation (issue #5154).
//
// A static effect that forbids a creature from attacking (CR 508.1c), from
// blocking (CR 509.1b) or from untapping (CR 502.3) changes nothing the layer
// system outputs: the creature keeps its P/T and its keywords, so
// `evaluateCreature` read a Pacifism'd 6/6 as a 6/6 and a Moat on the
// opponent's side as a generic 4-drop. The catalogue carries hundreds of these
// (439 statics on 341 hand-written cards at the 2026-10-07 census) and the
// evaluator saw none of them.
//
// Two readings, one number each, both off the ENGINE's own legality
// collections — never a re-implementation of the match:
//
//   * The RESTRICTED side: a creature that cannot attack loses its attack
//     share (`creatureAttackShareRaw` — the same fact `defender` prices for
//     the printed keyword), one that cannot block loses its block share for
//     the fraction of the attackers on the board it may not block, and one
//     that will not untap while it sits tapped loses both. Scaled by the
//     fitted `cannotAttackShare` / `cannotBlockShare` units (`EvalWeights`).
//   * The SOURCE: a restriction's standing worth is what it takes from the
//     opponent's creatures minus what it takes from its controller's own —
//     per source, COUNTERFACTUALLY (the discount with the source minus the
//     discount without it), so two sources grounding one creature do not both
//     claim its whole share and removing one of them is priced at what it
//     actually changes. The board term credits it once; the removal lens
//     (`permanentRealisedValue`) adds it twice — the source's own worth plus
//     what the restricted side recovers — so the lens equals the margin a
//     removal actually moves (see the note there).
//
//     Known limit of the counterfactual: REDUNDANT sources (two Moats, a Moat
//     plus a Pacifism on the same creature's attack) each price at zero, since
//     removing either alone frees nothing. A sweep that takes both reads the
//     lock at zero through `sweepUnits`; the exact single-target reading was
//     preferred over an equal split that would over-price every single
//     removal under redundancy.
//
// Legality is read from:
//   - `collectAttackRestrictions` / `collectBlockRestrictions` (`gre/combat.ts`)
//     — called WITHOUT `state` on the creature's own definition and on each
//     Aura attached to it (CR 303.4), so the source permanent of every
//     restriction is known by INSTANCE id (two copies of one Aura are two
//     sources), and the predicates are the declaration validators' own;
//   - `globalAttackProhibitionReason`'s scan, here per source so the forbidding
//     source is known (`cards/attackRestrictions.ts`, Moat / Akron Legionnaire);
//   - `collectUntapRestrictions` (`gre/phases.ts`), kept to `maxUntap: 0` —
//     the untap restrictions the untap dispatcher itself hard-skips on. A
//     lock that declares an `untapEscapeCost` (Thelon's Curse, Magnetic
//     Mountain; CR 503.1a) holds a creature only when its controller cannot
//     buy it out: the escape is payable from the controller's mana BASE (the
//     lands untap before the upkeep it is paid in) AND cheaper than the
//     creature costs (`manaValue` of the escape < the creature's own).
//     Known limit: each held creature is asked alone, so a controller who can
//     afford one escape but not three reads all three as free.
//     The base census also counts sources another lock keeps tapped, and
//     `buildManaLocks` still reads a blue mana source under such a lock as
//     fully held (the creature axis reads it as escaped).
//
// The MANA axis (issue #5163, ADR 0151 — a symmetric lock read by
// Differential Reading). An untap restriction on MANA SOURCES (Winter Orb's
// cap, Stasis's hard skip) takes away what the `mana` term prices a source
// for: that it comes back every untap step (CR 502.3, issue #3377). A locked
// source that sits TAPPED is dead mana until something else untaps it, and
// loses its whole `tappedManaWeight`; one still UNTAPPED keeps exactly one
// activation — the price of one use that does not come back,
// `finiteManaUseWeight` (issue #3530) — and loses the rest of its
// `manaWeight`. Under a CAP (`maxUntap: k`) over n matched sources, k of them
// keep renewing each untap step and which k is the player's pick, so every
// matched source carries the pool's share (n − k) / n of its loss — the pool
// total is the n − k sources locked, and no source's price depends on its id.
//
// Unlike the creature axes, the mana axis is counted ONCE: the restricted
// side's `mana` term carries the loss (`manaSourceLockDiscount`), and the
// source's board term credits nothing for it. A locked land is still a land
// to its controller (presence, plus what the lock leaves it); crediting the
// source as well would price an extra land under its controller's own Orb
// below nothing. The removal lens and the hand face read the netting once
// (`manaLockSourceWorth`, inside `standingLockMargin`): the opponent's locked
// mana minus the controller's own, so the SIGN of a Winter Orb is each side's
// land count, read off the board at every leaf, never a fixed sign on the
// card. Stasis skips the whole untap step (CR 502.3 is the reading of what it
// keeps tapped; untap-step triggers are not priced).
//
// OUT (by the issue, or by this module's reach — listed so nobody reads a
// zero as a verdict): cost taxes (a mana-economy term, tracker issue #5156);
// keyword rows (issue #5152); an untap CAP on CREATURES (`maxUntap: 1` over
// creatures, Smoke — which creature untaps is not a per-creature fact; its
// mana creatures ARE read by the mana axis); the `does-not-untap` keyword
// grant; declared-set restrictions ("can only attack alone"); a block
// restriction with a `bypassCost` (Hipparion — the block is still legal for a
// price).
//
// One walk per leaf: the plan is built lazily on the layer-7 pass
// (`Layer7Pass.restrictions`) the first time a creature is priced, like the
// layer-7 source plan, and every creature and every source of that leaf reads
// it. The walk is skipped outright — one registry `Set.has` per permanent —
// when nothing on the battlefield declares a restriction kind
// (`declaresCombatRestrictionStaticEffect`), which is nearly every board.
// PURE: no mutation of `state`, no randomness.

import type { CardInstanceState, GameState } from "../state";
import type {
    ManaCost,
    PermanentFilter,
    PermanentView,
    StaticAttackRestriction,
    StaticBlockRestriction,
    StaticGlobalAttackRestriction,
} from "../../cards/types";
import { ATTACK_RESTRICTION_CTX } from "../../cards/attackRestrictions";
import { matchesPermanentFilter } from "../../cards/filters";
import { getInstanceManaCost, tryGetDefinition } from "../../cards";
import { declaresCombatRestrictionStaticEffect } from "../../cards/registry";
import { collectAttackRestrictions, collectBlockRestrictions } from "../combat";
import {
    finiteManaUsesRemaining,
    hasManaAbility,
    isCreature,
    manaValue,
} from "../constants";
import { canPayCost } from "../manaAvailability";
import { censusOf } from "../manaCensusMemo";
import { creatureAttackShareRaw, creatureBlockShareRaw } from "../creatureBody";
import { lastingStaticAbilities } from "./defensiveGrants";
import { getEffectivePT, type Layer7Pass } from "../layers";
import { effectivePermanentView } from "../permanentView";
import { collectUntapRestrictions } from "../phases";

/** The two fitted units this module prices with — `Pick`ed so a caller with
 *  a whole `EvalWeights` passes it as is, and one without (a test, a
 *  context-free valuation) names the two numbers. */
export type RestrictionShareWeights = {
    /** Fraction of a creature's attack share lost when it cannot attack. */
    readonly cannotAttackShare: number;
    /** Fraction of a creature's block share lost when it cannot block. */
    readonly cannotBlockShare: number;
    /** Issue #5163 — the `mana` term's own prices (`EvalWeights`): an
     *  untapped renewable source, a tapped one, and one activation that does
     *  not come back. The mana axis prices a locked source with exactly the
     *  numbers the term priced it at, so nothing new is fitted. */
    readonly manaWeight: number;
    readonly tappedManaWeight: number;
    readonly finiteManaUseWeight: number;
};

/** Issue #5163 — one untap restriction over one player's renewable mana
 *  sources: the source permanent's id, its cap (`maxUntap`, 0 = hard skip)
 *  and the sources it matches. Recorded only when it matches more sources
 *  than its cap, i.e. when it locks something. */
type ManaLock = {
    readonly sourceId: string;
    readonly maxUntap: number;
    readonly matched: readonly CardInstanceState[];
};

/** What binds ONE creature, by source instance id. Weight-free, so the plan
 *  is a function of the board alone and the fit can bump a unit without
 *  rebuilding it. */
type RestrictedEntry = {
    readonly card: CardInstanceState;
    /** Attack share at the lasting (non-temporary) P/T — the body the
     *  creature term prices. */
    readonly attackShare: number;
    readonly blockShare: number;
    /** Source ids whose attack restriction forbids this creature's attack. */
    readonly attackBy: ReadonlySet<string>;
    /** Source id → the probe attackers its block restriction rejects this
     *  creature against. */
    readonly blockRejectsBy: ReadonlyMap<string, ReadonlySet<string>>;
    /** How many probe attackers the block axis was measured over — zero
     *  with no opposing creature (nothing to block, no block axis). */
    readonly blockProbes: number;
    /** Source ids whose hard-skip untap restriction holds this creature
     *  tapped. */
    readonly untapBy: ReadonlySet<string>;
};

/** The plan: every creature on the battlefield with what binds it. Opaque
 *  outside this module (`Layer7Pass.restrictions`); `state` pins the board
 *  it was walked over, so a pass reused on another state rebuilds. */
export type RestrictionPlan = {
    readonly state: GameState;
    readonly entries: ReadonlyMap<string, RestrictedEntry>;
    /** Issue #5163 — per player id, the untap restrictions that lock some of
     *  that player's renewable mana sources. */
    readonly manaLocks: ReadonlyMap<string, readonly ManaLock[]>;
};

const EMPTY_ENTRIES: ReadonlyMap<string, RestrictedEntry> = new Map();
const EMPTY_MANA_LOCKS: ReadonlyMap<string, readonly ManaLock[]> = new Map();

function cardId(card: CardInstanceState): string | undefined {
    return (card.card as { id?: string }).id;
}

/** Every permanent on the battlefield, both seats, board order. */
function battlefieldOf(state: GameState): CardInstanceState[] {
    const out: CardInstanceState[] = [];
    for (const player of state.players) out.push(...player.battlefield);
    return out;
}

/** A restriction with the INSTANCE it comes from: the creature itself for its
 *  own definition's, the attached Aura for an aura-granted one (CR 303.4).
 *  `collect` is one of the validators' own collectors, called without `state`
 *  so it reads exactly one definition per call — the walk over attachments
 *  is done here, once, so the source is an instance and not a definition. */
function restrictionsBySource<R>(
    card: CardInstanceState,
    attachments: readonly CardInstanceState[],
    collect: (perm: CardInstanceState) => R[]
): { sourceId: string; restriction: R }[] {
    const out: { sourceId: string; restriction: R }[] = [];
    for (const r of collect(card))
        out.push({ sourceId: card.id, restriction: r });
    for (const aura of attachments) {
        for (const r of collect(aura)) {
            out.push({ sourceId: aura.id, restriction: r });
        }
    }
    return out;
}

/** Whether `card`'s controller would buy `card` out of an untap lock for
 *  `escapeCost` (CR 503.1a): payable from their mana base — their lands untap
 *  before the upkeep the cost is paid in — and cheaper than the creature
 *  itself (a 4-mana buy-out of a 2-drop is a lock). */
function escapeWorthPaying(
    state: GameState,
    card: CardInstanceState,
    escapeCost: ManaCost
): boolean {
    if (manaValue(escapeCost) >= manaValue(getInstanceManaCost(card))) {
        return false;
    }
    const controller = state.players.find((p) => p.id === card.controllerId);
    if (!controller) return false;
    return canPayCost(censusOf(state, controller).base, escapeCost);
}

/** Walk the board ONCE and record, per creature, which sources forbid its
 *  attack, reject its blocks and hold it tapped. */
function buildRestrictionPlan(
    state: GameState,
    pass: Layer7Pass
): RestrictionPlan {
    const permanents = battlefieldOf(state);
    // The precheck: nearly every board declares no restriction at all, and
    // that answer is one `Set.has` per permanent off the registry index.
    if (
        !permanents.some((perm) => {
            const id = cardId(perm);
            return (
                id !== undefined && declaresCombatRestrictionStaticEffect(id)
            );
        })
    ) {
        return { state, entries: EMPTY_ENTRIES, manaLocks: EMPTY_MANA_LOCKS };
    }

    const entries = new Map<string, RestrictedEntry>();

    // CR 508.1c — the battlefield-scanned prohibitions, keyed by source so the
    // forbidding permanent is known (the shared scan returns only the text).
    const globalAttackSources: {
        source: CardInstanceState;
        effect: StaticGlobalAttackRestriction;
    }[] = [];
    // CR 303.4 — attachments by host, walked once for the whole board.
    const attachmentsOf = new Map<string, CardInstanceState[]>();
    for (const perm of permanents) {
        if (perm.attachedTo !== undefined) {
            let list = attachmentsOf.get(perm.attachedTo);
            if (!list) {
                list = [];
                attachmentsOf.set(perm.attachedTo, list);
            }
            list.push(perm);
        }
        const id = cardId(perm);
        if (id === undefined || !declaresCombatRestrictionStaticEffect(id)) {
            continue;
        }
        const def = tryGetDefinition(id);
        for (const effect of def?.staticEffects ?? []) {
            if (effect.kind !== "global-attack-restriction") continue;
            globalAttackSources.push({ source: perm, effect });
        }
    }

    // CR 502.3 — the hard-skip untap restrictions, with their sources: the
    // untap dispatcher's own collection (`collectUntapRestrictions`, every
    // gate applied and every host-/self-scoped filter already synthesized),
    // kept to the `maxUntap: 0` ones exactly as `computeHardSkipFilters` does.
    const untapRestrictions = collectUntapRestrictions(state);
    const hardSkips: {
        sourceId: string;
        filter: PermanentFilter;
        escapeCost?: ManaCost;
    }[] = untapRestrictions
        .filter((r) => r.restriction.maxUntap === 0)
        .map((r) => ({
            sourceId: r.source.id,
            filter: r.restriction.filter,
            escapeCost: r.restriction.untapEscapeCost,
        }));
    const manaLocks = buildManaLocks(state, untapRestrictions);

    // Probe views for the block axis: every creature with its EFFECTIVE power,
    // exactly as `validateBlockerEligibility` enriches both sides (power only,
    // CR 613.4c — a predicate reading toughness sees the printed value there
    // too, so the two readings cannot disagree).
    const probeView = new Map<string, CardInstanceState>();
    for (const perm of permanents) {
        if (!isCreature(perm)) continue;
        const pt = getEffectivePT(state, perm, { pass });
        probeView.set(perm.id, { ...perm, power: pt.power });
    }

    const collectAttack = (
        perm: CardInstanceState
    ): StaticAttackRestriction[] => collectAttackRestrictions(perm);
    const collectBlock = (perm: CardInstanceState): StaticBlockRestriction[] =>
        collectBlockRestrictions(perm, "blocker").filter(
            (r) => r.bypassCost === undefined
        );

    for (const player of state.players) {
        const opponents = state.players.filter((p) => p.id !== player.id);
        const opponentBattlefield = opponents.flatMap((p) => p.battlefield);
        const opposingCreatures = opponentBattlefield.filter(isCreature);
        for (const card of player.battlefield) {
            if (!isCreature(card)) continue;
            const attachments = attachmentsOf.get(card.id) ?? [];
            const lasting = getEffectivePT(state, card, {
                includeTemporary: false,
                pass,
            });
            // Issue #5927 — a keyword granted until end of turn earns no flat
            // credit in `evaluateCreature`, so the share a restriction takes
            // off is read from the LASTING keywords only; otherwise a
            // Pacified creature given flying would lose the bonus twice.
            const lastingKeywords = lastingStaticAbilities(state, card);
            const attackShare = creatureAttackShareRaw(
                Math.max(0, lasting.power),
                lastingKeywords
            );
            const blockShare = creatureBlockShareRaw(
                Math.max(0, lasting.toughness),
                lastingKeywords
            );

            // --- attack axis (CR 508.1c) ---
            const attackBy = new Set<string>();
            // CR 702.3b — a printed `defender` is already priced by the body
            // table; a "can't attack" on top of it takes nothing more away.
            if (!card.staticAbilities.includes("defender")) {
                for (const { sourceId, restriction } of restrictionsBySource(
                    card,
                    attachments,
                    collectAttack
                )) {
                    if (
                        restriction.predicate(
                            card,
                            opponentBattlefield,
                            player.battlefield
                        )
                    ) {
                        continue;
                    }
                    attackBy.add(sourceId);
                }
                for (const { source, effect } of globalAttackSources) {
                    if (
                        effect.forbids(
                            card as unknown as PermanentView,
                            source as unknown as PermanentView,
                            state as never,
                            ATTACK_RESTRICTION_CTX
                        )
                    ) {
                        attackBy.add(source.id);
                    }
                }
            }

            // --- block axis (CR 509.1b) --- measured against the attackers
            // actually on the board. With none there is nothing to block and
            // no block share to lose (a creature cannot be priced against
            // itself: a "can't block power 3 or greater" would read its own
            // power).
            const blockRejectsBy = new Map<string, Set<string>>();
            const self = probeView.get(card.id) ?? card;
            const probes = opposingCreatures.map(
                (c) => probeView.get(c.id) ?? c
            );
            if (probes.length > 0) {
                for (const { sourceId, restriction } of restrictionsBySource(
                    card,
                    attachments,
                    collectBlock
                )) {
                    for (const probe of probes) {
                        if (restriction.predicate(self, probe, state)) continue;
                        let rejected = blockRejectsBy.get(sourceId);
                        if (!rejected) {
                            rejected = new Set<string>();
                            blockRejectsBy.set(sourceId, rejected);
                        }
                        rejected.add(probe.id);
                    }
                }
            }

            // --- untap axis (CR 502.3) ---
            const untapBy = new Set<string>();
            if (hardSkips.length > 0) {
                const view = effectivePermanentView(state, card);
                for (const { sourceId, filter, escapeCost } of hardSkips) {
                    if (!matchesPermanentFilter(view, filter)) continue;
                    // CR 503.1a — a pay-to-untap escape the controller can
                    // buy and that costs less than the creature: not held.
                    if (
                        escapeCost !== undefined &&
                        escapeWorthPaying(state, card, escapeCost)
                    ) {
                        continue;
                    }
                    untapBy.add(sourceId);
                }
            }

            if (
                attackBy.size === 0 &&
                blockRejectsBy.size === 0 &&
                untapBy.size === 0
            ) {
                continue;
            }
            entries.set(card.id, {
                card,
                attackShare,
                blockShare,
                attackBy,
                blockRejectsBy,
                blockProbes: probes.length,
                untapBy,
            });
        }
    }
    return { state, entries, manaLocks };
}

/** Issue #5163 — CR 502.3: per player, every untap restriction that matches
 *  more of that player's RENEWABLE mana sources than it lets untap. A finite
 *  source (a depletion land, issue #3530) is left out: the `mana` term does not
 *  price it as renewable (`finiteManaUses` does, by its charges), so an untap
 *  lock takes nothing from it that the evaluation counted. */
function buildManaLocks(
    state: GameState,
    untapRestrictions: ReturnType<typeof collectUntapRestrictions>
): ReadonlyMap<string, readonly ManaLock[]> {
    if (untapRestrictions.length === 0) return EMPTY_MANA_LOCKS;
    const out = new Map<string, ManaLock[]>();
    for (const player of state.players) {
        const sources = player.battlefield
            .filter(
                (perm) =>
                    hasManaAbility(perm, undefined, player.battlefield) &&
                    finiteManaUsesRemaining(perm) === 0
            )
            .map((perm) => ({
                perm,
                view: effectivePermanentView(state, perm),
            }));
        if (sources.length === 0) continue;
        const locks: ManaLock[] = [];
        for (const { source, restriction } of untapRestrictions) {
            const matched = sources
                .filter(({ view }) =>
                    matchesPermanentFilter(view, restriction.filter)
                )
                .map(({ perm }) => perm);
            if (matched.length <= restriction.maxUntap) continue;
            locks.push({
                sourceId: source.id,
                maxUntap: restriction.maxUntap,
                matched,
            });
        }
        if (locks.length > 0) out.set(player.id, locks);
    }
    return out;
}

/** The plan for `state`, built on first read and kept on `pass`; rebuilt
 *  when the pass is read against another state object. */
function planFor(state: GameState, pass: Layer7Pass): RestrictionPlan {
    if (pass.restrictions === undefined || pass.restrictions.state !== state) {
        pass.restrictions = buildRestrictionPlan(state, pass);
    }
    return pass.restrictions;
}

/** The body points `entry` loses to its restrictions, with the source in
 *  `exclude` treated as absent. The counterfactual the source worth needs. */
function discountOf(
    entry: RestrictedEntry,
    shares: RestrictionShareWeights,
    exclude?: string
): number {
    let attackLost = 0;
    let blockLost = 0;
    const holds = (sources: ReadonlySet<string>) =>
        exclude === undefined
            ? sources.size > 0
            : [...sources].some((s) => s !== exclude);
    if (holds(entry.attackBy)) attackLost = entry.attackShare;
    if (entry.blockProbes > 0 && entry.blockRejectsBy.size > 0) {
        const rejected = new Set<string>();
        for (const [sourceId, probes] of entry.blockRejectsBy) {
            if (sourceId === exclude) continue;
            for (const p of probes) rejected.add(p);
        }
        blockLost = (rejected.size / entry.blockProbes) * entry.blockShare;
    }
    // CR 502.3 — a creature its controller's untap step will not untap, while
    // it sits tapped, neither attacks nor blocks until something else untaps
    // it. Untapped, it is whole: the one attack it has left is the search's
    // to price, since the leaf after that attack sees it tapped and locked.
    if (entry.card.isTapped && holds(entry.untapBy)) {
        attackLost = entry.attackShare;
        blockLost = entry.blockShare;
    }
    return (
        shares.cannotAttackShare * attackLost +
        shares.cannotBlockShare * blockLost
    );
}

/** Issue #5163 — what ONE locked mana source loses off its `mana` term
 *  price: tapped, all of it (dead until something else untaps it); untapped,
 *  all but the one activation it still holds. */
function lockedManaLoss(
    source: CardInstanceState,
    shares: RestrictionShareWeights
): number {
    return source.isTapped
        ? shares.tappedManaWeight
        : Math.max(0, shares.manaWeight - shares.finiteManaUseWeight);
}

/** Issue #5163 — the share of its loss each mana source matched by `locks`
 *  carries, with the lock source `exclude` treated as absent: 1 under a hard
 *  skip, (n − k) / n under a cap of k over n matched sources, the largest
 *  share where two locks overlap. */
function lockedManaShares(
    locks: readonly ManaLock[],
    exclude?: string
): Map<string, { perm: CardInstanceState; share: number }> {
    const out = new Map<string, { perm: CardInstanceState; share: number }>();
    for (const lock of locks) {
        if (lock.sourceId === exclude) continue;
        const n = lock.matched.length;
        const share = lock.maxUntap === 0 ? 1 : (n - lock.maxUntap) / n;
        for (const perm of lock.matched) {
            const prior = out.get(perm.id);
            if (!prior || prior.share < share)
                out.set(perm.id, { perm, share });
        }
    }
    return out;
}

function lockedManaTotal(
    shares: ReadonlyMap<string, { perm: CardInstanceState; share: number }>,
    weights: RestrictionShareWeights
): number {
    let total = 0;
    for (const { perm, share } of shares.values()) {
        total += share * lockedManaLoss(perm, weights);
    }
    return total;
}

/** What an untap lock takes off `source`'s `mana` term price as a MANA
 *  SOURCE (issue #5163): zero for a source nothing locks, which is every
 *  source on a board with no untap restriction. Read by the `mana` term and
 *  by `permanentRealisedValue`, so a locked land's removal is priced at what
 *  it was still worth. */
export function manaSourceLockDiscount(
    state: GameState,
    source: CardInstanceState,
    shares: RestrictionShareWeights,
    pass: Layer7Pass
): number {
    const locks = planFor(state, pass).manaLocks.get(source.controllerId);
    if (!locks) return 0;
    const entry = lockedManaShares(locks).get(source.id);
    return entry ? entry.share * lockedManaLoss(source, shares) : 0;
}

/** Issue #5163 — the standing worth of `source` as a MANA lock: per side,
 *  the locked mana with it minus without it, the opponent's a gain and the
 *  controller's own a loss. A Winter Orb beside two lands of its
 *  controller's and six of the opponent's earns the five renewals the
 *  opponent loses minus the one its controller does. Counted once — read
 *  only through `standingLockMargin`, never by the board term (see the
 *  header). */
export function manaLockSourceWorth(
    state: GameState,
    source: CardInstanceState,
    shares: RestrictionShareWeights,
    pass: Layer7Pass
): number {
    let worth = 0;
    for (const [playerId, locks] of planFor(state, pass).manaLocks) {
        if (!locks.some((lock) => lock.sourceId === source.id)) continue;
        const taken =
            lockedManaTotal(lockedManaShares(locks), shares) -
            lockedManaTotal(lockedManaShares(locks, source.id), shares);
        worth += playerId === source.controllerId ? -taken : taken;
    }
    return worth;
}

/** Issue #5163 — the margin `source`'s standing restrictions move on this
 *  board: the creature axes twice (the source's own `permanents` credit plus
 *  the restricted creatures' discount, issue #5154) and the mana axis once.
 *  What its removal moves (`permanentRealisedValue`) and what it is worth in
 *  hand once entered (`standingLockWorth`), so the two faces are one number. */
export function standingLockMargin(
    state: GameState,
    source: CardInstanceState,
    shares: RestrictionShareWeights,
    pass: Layer7Pass
): number {
    return (
        2 * restrictionSourceWorth(state, source, shares, pass) +
        manaLockSourceWorth(state, source, shares, pass)
    );
}

/** What `card`'s restrictions take off its realized body (issue #5154):
 *  zero for a creature nothing binds, which is every creature on a board with
 *  no restriction source. Read by `evaluateCreature`. */
export function creatureRestrictionDiscount(
    state: GameState,
    card: CardInstanceState,
    shares: RestrictionShareWeights,
    pass: Layer7Pass
): number {
    const entry = planFor(state, pass).entries.get(card.id);
    if (!entry) return 0;
    return discountOf(entry, shares);
}

/** The standing worth of `source` AS a restriction source (issue #5154): what
 *  it takes from the opponent's creatures minus what it takes from its
 *  controller's own, each creature's loss read counterfactually (with the
 *  source minus without it). Zero for a permanent that restricts nothing. A
 *  creature's OWN restriction on itself is excluded — that discount already
 *  sits in its `evaluateCreature`. Read by the board term (once) and by
 *  `permanentRealisedValue` (twice: the source's worth and the restricted
 *  side's recovery), so the lens equals the margin a removal moves. */
export function restrictionSourceWorth(
    state: GameState,
    source: CardInstanceState,
    shares: RestrictionShareWeights,
    pass: Layer7Pass
): number {
    const plan = planFor(state, pass);
    if (plan.entries.size === 0) return 0;
    let worth = 0;
    for (const entry of plan.entries.values()) {
        if (entry.card.id === source.id) continue;
        if (
            !entry.attackBy.has(source.id) &&
            !entry.blockRejectsBy.has(source.id) &&
            !entry.untapBy.has(source.id)
        ) {
            continue;
        }
        const taken =
            discountOf(entry, shares) - discountOf(entry, shares, source.id);
        worth +=
            entry.card.controllerId === source.controllerId ? -taken : taken;
    }
    return worth;
}
