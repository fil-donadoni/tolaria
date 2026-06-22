import type { Color } from "../cards/types";
import {
    getActivatedManaAbility,
    getActivatedManaColor,
    getActivatedManaRestriction,
    getBasicLandMana,
    getFixedManaAmount,
    isTapLockedBySummoningSickness,
    MANA_COLORS,
} from "./constants";
import type { CardInstanceState } from "./state";
import { isManaCostCovered, type ManaSubstitution } from "./state";

/**
 * Auto-tap mana solver (issue #154).
 *
 * Given the player's floating mana, a normalized cost, the active mana
 * substitutions (CR 609.4b), and the set of untapped mana sources, finds a
 * minimal subset of sources to tap that makes the pool cover the cost.
 *
 * Scope (CR 601.2g — paying costs): only "pure" mana abilities participate.
 * Sources with a side effect on payment are excluded so the player keeps
 * manual control over them:
 *   - sacrifice mana abilities (`ability.cost.sacrifice`, e.g. Black Lotus)
 *   - damage / life mana abilities (not yet modeled in the LEA set)
 * Cost reduction and alternative costs are out of scope: the solver only
 * sees the already-normalized cost the GRE entered into pendingCast.
 *
 * The solver never over-taps: it returns a minimum-cardinality combination,
 * and returns `[]` when the pool already covers the cost. Manual tapping is
 * unaffected — this is an additive convenience action.
 */

/** Mana a source contributes when tapped (colors → amount). */
export type ManaContribution = Partial<Record<Color, number>>;

/**
 * A tappable mana source reduced to what the solver needs: its instance id and
 * the mutually-exclusive mana outputs it offers. Fixed sources (basic lands,
 * Mox, Sol Ring) have a single option; choice sources (dual lands, Birds of
 * Paradise) expose one option per `manaChoices` entry, carrying the index the
 * tap mutation needs.
 */
export type AutoTapSource = {
    cardId: string;
    options: { manaChoiceIndex?: number; mana: ManaContribution }[];
};

/** Ordered list of taps to perform (card + chosen mana option). */
export type AutoTapPlan = { cardId: string; manaChoiceIndex?: number }[];

/** Strip X and zero/negative entries from a ManaCost into a color contribution. */
function toContribution(cost: {
    [k: string]: number | string | undefined;
}): ManaContribution {
    const out: ManaContribution = {};
    for (const color of MANA_COLORS) {
        const v = cost[color];
        if (typeof v === "number" && v > 0) out[color] = v;
    }
    return out;
}

/** Build the solver's source list from a player's battlefield, excluding
 *  tapped sources, summoning-sick creature dorks (CR 302.1), sacrifice mana
 *  abilities, and anything that doesn't produce a single known mana output.
 *  Sorted restricted-first (fewest options) so the minimal solution prefers
 *  inflexible sources (basics) and keeps flexible ones (Birds) for last. */
export function buildAutoTapSources(
    battlefield: CardInstanceState[]
): AutoTapSource[] {
    const sources: AutoTapSource[] = [];
    for (const card of battlefield) {
        if (card.isTapped) continue;
        const ability = getActivatedManaAbility(card);

        // Side-effect mana abilities stay manual (sacrifice, e.g. Black Lotus).
        if (ability?.cost.sacrifice === true) continue;
        // Restricted mana (CR 106.6, e.g. Mishra's Workshop) can pay only for
        // certain spells; the solver reasons over the fungible pool and can't
        // model that constraint, so leave those sources manual (the player
        // floats the restricted mana, then casts an eligible spell).
        if (getActivatedManaRestriction(card)) continue;
        // Summoning-sick creature mana dorks can't pay a {T} cost (CR 302.1).
        if (ability && isTapLockedBySummoningSickness(card)) continue;

        if (ability?.manaChoices) {
            const options = ability.manaChoices.map((mc, index) => ({
                manaChoiceIndex: index,
                mana: toContribution(mc),
            }));
            // A choice with no usable color (e.g. Black Lotus's {C}{C}{C}
            // entry survives toContribution; that's fine) — keep all options.
            sources.push({ cardId: card.id, options });
            continue;
        }

        const color = getBasicLandMana(card) ?? getActivatedManaColor(card);
        if (!color) continue; // non-mana or multi-color fixed: leave manual
        // CR 106.1 — board-conditional output (Urza trio) computed from the
        // controller's battlefield so the solver reasons over the real yield.
        const amount = getFixedManaAmount(card, color, battlefield);
        sources.push({
            cardId: card.id,
            options: [{ mana: { [color]: amount } }],
        });
    }

    // Restricted-first: single-option sources before multi-option ones.
    sources.sort((a, b) => a.options.length - b.options.length);
    return sources;
}

/**
 * A preservable **Demand** (PRD #472 / ADR 0034): another play the paying
 * player might still make this turn whose castability we try not to strand.
 * The #474 spine models hand spells — each carries its normalized mana cost.
 * Timing filters (#475), on-board activated abilities (#476) and X-spell
 * inflation (#477) layer on top by producing the same shape from richer
 * candidate sets; the scorer here is agnostic to where a Demand came from.
 */
export type Demand = {
    /** Stable id for determinism / debugging (e.g. the hand card instance id). */
    id: string;
    /** Normalized mana cost (output of `normalizeManaCost`). */
    cost: Record<string, number>;
};

function addContribution(
    pool: Record<string, number>,
    mana: ManaContribution
): Record<string, number> {
    const next = { ...pool };
    for (const color of MANA_COLORS) {
        const v = mana[color];
        if (v) next[color] = (next[color] ?? 0) + v;
    }
    return next;
}

/** True if tapping this option would advance an as-yet-unmet colored
 *  requirement (so the search prefers useful options before generic ones). */
function helpsColoredNeed(
    pool: Record<string, number>,
    cost: Record<string, number>,
    subs: ManaSubstitution[],
    mana: ManaContribution
): boolean {
    return MANA_COLORS.some((color) => {
        if (!mana[color]) return false;
        // Already covered without this option? Then it only helps generic.
        const need = cost[color] ?? 0;
        if (need <= 0) {
            // Could still satisfy another color via substitution.
            return subs.some((s) => s.from === color && (cost[s.to] ?? 0) > 0);
        }
        return (pool[color] ?? 0) < need;
    });
}

/**
 * Solve for a minimal set of taps. Returns the plan (possibly empty if the
 * pool already covers the cost), or `null` when no combination of the given
 * sources can pay it. Deterministic: iterative deepening on tap count, with
 * sources tried in their given order and useful options tried first.
 */
export function solveAutoTap(
    pool: Record<string, number>,
    cost: Record<string, number>,
    substitutions: ManaSubstitution[],
    sources: AutoTapSource[]
): AutoTapPlan | null {
    if (isManaCostCovered(pool, cost, substitutions)) return [];

    function dfs(
        index: number,
        trialPool: Record<string, number>,
        chosen: AutoTapPlan,
        limit: number
    ): AutoTapPlan | null {
        if (isManaCostCovered(trialPool, cost, substitutions)) return chosen;
        if (chosen.length >= limit) return null;
        if (index >= sources.length) return null;
        // Prune: not enough sources left to reach the tap budget.
        if (sources.length - index < limit - chosen.length) return null;

        const src = sources[index];
        const ordered = [...src.options].sort((a, b) => {
            const ha = helpsColoredNeed(trialPool, cost, substitutions, a.mana)
                ? 1
                : 0;
            const hb = helpsColoredNeed(trialPool, cost, substitutions, b.mana)
                ? 1
                : 0;
            return hb - ha;
        });

        // Prefer tapping this source (in option order) over skipping it.
        for (const opt of ordered) {
            const result = dfs(
                index + 1,
                addContribution(trialPool, opt.mana),
                [
                    ...chosen,
                    {
                        cardId: src.cardId,
                        ...(opt.manaChoiceIndex !== undefined
                            ? { manaChoiceIndex: opt.manaChoiceIndex }
                            : {}),
                    },
                ],
                limit
            );
            if (result) return result;
        }
        // Skip this source.
        return dfs(index + 1, trialPool, chosen, limit);
    }

    for (let limit = 1; limit <= sources.length; limit++) {
        const plan = dfs(0, pool, [], limit);
        if (plan) return plan;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Smart auto-tap: demand-aware minimal-tap selection (PRD #472, ADR 0034)
//
// CR-neutral UX. Auto-tap is a convenience — the CR (601.2g, paying costs)
// never dictates *which* legal sources a player taps, only that the cost is
// paid. We keep the minimal-tap-count invariant from `solveAutoTap` and, among
// all equally-minimal covering plans, pick the one that best preserves the
// paying player's other plays this turn (their **Demands**). #474 ships the
// spine for *hand-spell* Demands; #475/#476/#477 widen the candidate set.
// ---------------------------------------------------------------------------

/** Hard cap on collected minimal-tap plans before scoring (ADR 0034). A safety
 *  backstop against pathological dual/rock-heavy boards — effectively never hit
 *  on real boards (~≤10 sources). On overflow we keep the best plan so far. */
export const AUTO_TAP_PLAN_CAP = 512;

/** Smallest number of taps that covers `cost`, or `null` if uncoverable.
 *  Iterative deepening, identical contract to `solveAutoTap`'s budget loop. */
function minimalTapCount(
    pool: Record<string, number>,
    cost: Record<string, number>,
    substitutions: ManaSubstitution[],
    sources: AutoTapSource[]
): number | null {
    if (isManaCostCovered(pool, cost, substitutions)) return 0;
    const plan = solveAutoTap(pool, cost, substitutions, sources);
    return plan ? plan.length : null;
}

/**
 * Enumerate every covering plan of exactly `k` taps, in deterministic order
 * (sources in their given order, options in index order). Stops collecting once
 * `cap` plans are gathered (the caller scores what it has — best-so-far). Pure
 * synchronous DFS; `k` is the minimal covering count so the search is shallow.
 */
function enumerateKTapPlans(
    pool: Record<string, number>,
    cost: Record<string, number>,
    substitutions: ManaSubstitution[],
    sources: AutoTapSource[],
    k: number,
    cap: number
): { plans: AutoTapPlan[]; overflow: boolean } {
    const plans: AutoTapPlan[] = [];
    let overflow = false;

    function dfs(
        index: number,
        trialPool: Record<string, number>,
        chosen: AutoTapPlan
    ): void {
        if (plans.length >= cap) {
            overflow = true;
            return;
        }
        if (chosen.length === k) {
            if (isManaCostCovered(trialPool, cost, substitutions)) {
                plans.push(chosen);
            }
            return;
        }
        if (index >= sources.length) return;
        // Prune: not enough sources left to reach exactly k taps.
        if (sources.length - index < k - chosen.length) return;

        const src = sources[index];
        // Tap this source (one branch per mana option), in index order.
        for (const opt of src.options) {
            if (plans.length >= cap) {
                overflow = true;
                return;
            }
            dfs(index + 1, addContribution(trialPool, opt.mana), [
                ...chosen,
                {
                    cardId: src.cardId,
                    ...(opt.manaChoiceIndex !== undefined
                        ? { manaChoiceIndex: opt.manaChoiceIndex }
                        : {}),
                },
            ]);
        }
        // Or skip it.
        dfs(index + 1, trialPool, chosen);
    }

    dfs(0, pool, []);
    return { plans, overflow };
}

/** The untapped sources left after a plan taps some of them (by cardId). A
 *  source tapped for any option is fully consumed — sources are single-tap. */
function sourcesAfterPlan(
    sources: AutoTapSource[],
    plan: AutoTapPlan
): AutoTapSource[] {
    const tapped = new Set(plan.map((step) => step.cardId));
    return sources.filter((s) => !tapped.has(s.cardId));
}

/**
 * Floating mana left in the pool after this plan pays `cost` (CR 601.2g /
 * 609.4b). Adds every tapped source's chosen mana to the pool, then spends the
 * cost greedily: exact color first, then substitutions, then generic from any
 * leftover. The remainder is mana the player still has floating, which a later
 * Demand may lean on. Plans that over-produce (a dual tapped for the "wrong"
 * half) therefore leave usable floating mana, captured here.
 */
function floatingAfterPlan(
    pool: Record<string, number>,
    cost: Record<string, number>,
    substitutions: ManaSubstitution[],
    sources: AutoTapSource[],
    plan: AutoTapPlan
): Record<string, number> {
    const byId = new Map(sources.map((s) => [s.cardId, s]));
    let remaining = { ...pool };
    for (const step of plan) {
        const src = byId.get(step.cardId);
        if (!src) continue;
        const opt =
            step.manaChoiceIndex !== undefined
                ? src.options.find(
                      (o) => o.manaChoiceIndex === step.manaChoiceIndex
                  )
                : src.options[0];
        if (opt) remaining = addContribution(remaining, opt.mana);
    }

    // Spend the cost out of `remaining`: colored/colorless pips first (exact,
    // then substitutes), then the generic remainder from anything left.
    for (const color of MANA_COLORS) {
        let required = cost[color] ?? 0;
        if (required <= 0) continue;
        const direct = Math.min(remaining[color] ?? 0, required);
        remaining[color] = (remaining[color] ?? 0) - direct;
        required -= direct;
        for (const sub of substitutions) {
            if (required <= 0) break;
            if (sub.to !== color) continue;
            const take = Math.min(remaining[sub.from] ?? 0, required);
            remaining[sub.from] = (remaining[sub.from] ?? 0) - take;
            required -= take;
        }
    }
    let generic = cost.X ?? 0;
    for (const color of MANA_COLORS) {
        if (generic <= 0) break;
        const take = Math.min(remaining[color] ?? 0, generic);
        remaining[color] = (remaining[color] ?? 0) - take;
        generic -= take;
    }
    return remaining;
}

/** True if `demand.cost` is payable from `pool` + `sources` (CR 601.2g). Reuses
 *  the minimal-tap solver as a pure feasibility check. */
function isDemandAffordable(
    demand: Demand,
    pool: Record<string, number>,
    substitutions: ManaSubstitution[],
    sources: AutoTapSource[]
): boolean {
    return solveAutoTap(pool, demand.cost, substitutions, sources) !== null;
}

/**
 * Preserved-Demand score of a candidate plan (ADR 0034, per-demand isolation).
 * Counts Demands that survive the payment: still individually affordable from
 * the *remaining untapped sources + leftover floating mana* after the plan
 * pays the cost. Demands are pre-filtered by the caller to those affordable
 * *before* payment, so this measures only what the plan strands. Isolation
 * over-count (two Demands sharing one source both count) is accepted.
 */
export function scorePreservedDemands(
    pool: Record<string, number>,
    cost: Record<string, number>,
    substitutions: ManaSubstitution[],
    sources: AutoTapSource[],
    plan: AutoTapPlan,
    demands: Demand[]
): number {
    if (demands.length === 0) return 0;
    const remainingSources = sourcesAfterPlan(sources, plan);
    const leftover = floatingAfterPlan(
        pool,
        cost,
        substitutions,
        sources,
        plan
    );
    let score = 0;
    for (const demand of demands) {
        if (
            isDemandAffordable(
                demand,
                leftover,
                substitutions,
                remainingSources
            )
        ) {
            score += 1;
        }
    }
    return score;
}

/** Distinct colors a source can produce across all its mana options. */
function sourceColorBreadth(source: AutoTapSource): number {
    const colors = new Set<Color>();
    for (const opt of source.options) {
        for (const color of MANA_COLORS) {
            if ((opt.mana[color] ?? 0) > 0) colors.add(color);
        }
    }
    return colors.size;
}

/**
 * Flexibility of the sources a plan leaves untapped (ADR 0034 tie-break #2):
 * sum over still-untapped sources of the distinct colors each can produce.
 * This *is* the colorless/basics-first heuristic — leaving a 2-color dual up
 * scores higher than leaving a 1-color basic up, so the solver spends the
 * basic first by construction, no separate rule needed. Also the empty-hand
 * fallback (no Demands → all plans tie on score 0 → flexibility decides).
 */
export function remainingFlexibility(
    sources: AutoTapSource[],
    plan: AutoTapPlan
): number {
    return sourcesAfterPlan(sources, plan).reduce(
        (sum, src) => sum + sourceColorBreadth(src),
        0
    );
}

/** Lexicographic key of a plan's tapped cardIds (sorted), for the deterministic
 *  tertiary tie-break (ADR 0034 tie-break #3). */
function planLexKey(plan: AutoTapPlan): string {
    return [...plan.map((s) => s.cardId)].sort().join(" ");
}

/**
 * Smart auto-tap (PRD #472, ADR 0034). Among all minimal-tap-count plans that
 * cover `cost`, returns the one that best preserves the paying player's
 * `demands`, broken by the deterministic 3-tier order:
 *   (1) most preserved Demands,
 *   (2) most remaining-source flexibility (colorless/basics spent first),
 *   (3) lexicographic by tapped cardId.
 *
 * Preserves the minimal-tap-count invariant: it only ever enumerates plans at
 * the smallest covering tap count, so it never taps more sources than
 * `solveAutoTap` would. Returns `[]` when the pool already covers the cost and
 * `null` when no combination of sources can pay it (caller falls back to the
 * partial solver). `demands` should exclude the spell being paid for.
 */
export function solveSmartAutoTap(
    pool: Record<string, number>,
    cost: Record<string, number>,
    substitutions: ManaSubstitution[],
    sources: AutoTapSource[],
    demands: Demand[] = []
): AutoTapPlan | null {
    const k = minimalTapCount(pool, cost, substitutions, sources);
    if (k === null) return null;
    if (k === 0) return [];

    const { plans } = enumerateKTapPlans(
        pool,
        cost,
        substitutions,
        sources,
        k,
        AUTO_TAP_PLAN_CAP
    );
    // Defensive: if the cap were hit before any covering plan was collected,
    // fall back to the single minimal plan the base solver finds.
    if (plans.length === 0) {
        return solveAutoTap(pool, cost, substitutions, sources);
    }

    // Demands affordable *before* this payment — only those can be stranded
    // (ADR 0034 candidate filter (a)). Computed once, reused per plan.
    const liveDemands = demands.filter((d) =>
        isDemandAffordable(d, pool, substitutions, sources)
    );

    let best: AutoTapPlan | null = null;
    let bestScore = -1;
    let bestFlex = -1;
    let bestLex = "";
    for (const plan of plans) {
        const score = scorePreservedDemands(
            pool,
            cost,
            substitutions,
            sources,
            plan,
            liveDemands
        );
        const flex = remainingFlexibility(sources, plan);
        const lex = planLexKey(plan);
        if (
            score > bestScore ||
            (score === bestScore && flex > bestFlex) ||
            (score === bestScore && flex === bestFlex && lex < bestLex)
        ) {
            best = plan;
            bestScore = score;
            bestFlex = flex;
            bestLex = lex;
        }
    }
    return best;
}

/**
 * Total still-unmet mana of a pool against a cost, after applying colored
 * requirements (with substitutions, CR 609.4b) and then the generic
 * remainder. This is the quantity the partial solver tries to drive down:
 * a source tap is "useful" iff it strictly reduces this number.
 */
function remainingDeficit(
    pool: Record<string, number>,
    cost: Record<string, number>,
    substitutions: ManaSubstitution[]
): number {
    const remaining = { ...pool };
    let deficit = 0;

    // Colored/colorless pips: spend exact color first, then substitutes.
    for (const color of MANA_COLORS) {
        let required = cost[color] ?? 0;
        if (required <= 0) continue;
        const direct = Math.min(remaining[color] ?? 0, required);
        remaining[color] = (remaining[color] ?? 0) - direct;
        required -= direct;
        for (const sub of substitutions) {
            if (required <= 0) break;
            if (sub.to !== color) continue;
            const take = Math.min(remaining[sub.from] ?? 0, required);
            remaining[sub.from] = (remaining[sub.from] ?? 0) - take;
            required -= take;
        }
        deficit += required;
    }

    // Generic remainder: any leftover mana counts toward it.
    const generic = cost.X ?? 0;
    if (generic > 0) {
        let available = 0;
        for (const color of MANA_COLORS) available += remaining[color] ?? 0;
        deficit += Math.max(0, generic - available);
    }

    return deficit;
}

/**
 * Maximal-useful partial plan (issue #321).
 *
 * Used when `solveAutoTap` returns `null` (the available pure-mana sources
 * cannot fully cover the cost, e.g. the rest must come from an excluded
 * sacrifice source like Black Lotus). Greedily taps every source that
 * strictly advances payment toward the cost, leaving the manual remainder
 * for the player. Caller commits only if the cost ends up fully covered;
 * otherwise the payment banner stays up.
 *
 * Guarantees mirroring the full solver's contract:
 *  - never taps a source whose mana is irrelevant to the cost's colors/amount
 *    (a tap that does not reduce the remaining deficit is skipped);
 *  - never over-taps: once the deficit reaches 0 the loop stops;
 *  - excluded sources are not present in `sources`, so they're never tapped.
 *
 * Returns `[]` when no source can make any progress (true no-op).
 */
export function solveAutoTapPartial(
    pool: Record<string, number>,
    cost: Record<string, number>,
    substitutions: ManaSubstitution[],
    sources: AutoTapSource[]
): AutoTapPlan {
    const plan: AutoTapPlan = [];
    let currentPool = { ...pool };
    // Sources are pre-sorted restricted-first; consume in order, skipping any
    // that can't help so flexible sources aren't spent on already-met needs.
    const remaining = [...sources];

    let deficit = remainingDeficit(currentPool, cost, substitutions);
    let progressed = true;
    while (deficit > 0 && progressed) {
        progressed = false;
        for (let i = 0; i < remaining.length; i++) {
            const src = remaining[i];
            // Best option = the one that reduces the deficit the most.
            let bestOpt: AutoTapSource["options"][number] | undefined;
            let bestDeficit = deficit;
            for (const opt of src.options) {
                const after = remainingDeficit(
                    addContribution(currentPool, opt.mana),
                    cost,
                    substitutions
                );
                if (after < bestDeficit) {
                    bestDeficit = after;
                    bestOpt = opt;
                }
            }
            if (!bestOpt) continue; // this source can't advance the cost
            currentPool = addContribution(currentPool, bestOpt.mana);
            plan.push({
                cardId: src.cardId,
                ...(bestOpt.manaChoiceIndex !== undefined
                    ? { manaChoiceIndex: bestOpt.manaChoiceIndex }
                    : {}),
            });
            remaining.splice(i, 1);
            deficit = bestDeficit;
            progressed = true;
            break;
        }
    }

    return plan;
}
