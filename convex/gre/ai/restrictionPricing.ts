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
//     the untap restrictions the untap dispatcher itself hard-skips on.
//
// OUT (by the issue, or by this module's reach — listed so nobody reads a
// zero as a verdict): cost taxes (a mana-economy term, tracker issue #5156);
// the board-dependent SIGN of a symmetric lock (Stasis) — the asymmetric
// reading only, sign-correct by construction; keyword rows (issue #5152); an
// untap CAP (`maxUntap: 1`, Smoke / Winter Orb — not a per-creature fact);
// the `does-not-untap` keyword grant and the pay-to-untap escape (Thelon's
// Curse), which are not `untap-restriction` statics; declared-set
// restrictions ("can only attack alone"); a block restriction with a
// `bypassCost` (Hipparion — the block is still legal for a price).
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
    PermanentFilter,
    PermanentView,
    StaticAttackRestriction,
    StaticBlockRestriction,
    StaticGlobalAttackRestriction,
} from "../../cards/types";
import { ATTACK_RESTRICTION_CTX } from "../../cards/attackRestrictions";
import { matchesPermanentFilter } from "../../cards/filters";
import { tryGetDefinition } from "../../cards";
import { declaresCombatRestrictionStaticEffect } from "../../cards/registry";
import { collectAttackRestrictions, collectBlockRestrictions } from "../combat";
import { isCreature } from "../constants";
import { creatureAttackShareRaw, creatureBlockShareRaw } from "../creatureBody";
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
};

const EMPTY_ENTRIES: ReadonlyMap<string, RestrictedEntry> = new Map();

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
        return { state, entries: EMPTY_ENTRIES };
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
    const hardSkips: { sourceId: string; filter: PermanentFilter }[] =
        collectUntapRestrictions(state)
            .filter((r) => r.restriction.maxUntap === 0)
            .map((r) => ({
                sourceId: r.source.id,
                filter: r.restriction.filter,
            }));

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
            const attackShare = creatureAttackShareRaw(
                Math.max(0, lasting.power),
                card.staticAbilities
            );
            const blockShare = creatureBlockShareRaw(
                Math.max(0, lasting.toughness),
                card.staticAbilities
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
                    if (restriction.predicate(card, opponentBattlefield)) {
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
                for (const { sourceId, filter } of hardSkips) {
                    if (matchesPermanentFilter(view, filter)) {
                        untapBy.add(sourceId);
                    }
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
    return { state, entries };
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
