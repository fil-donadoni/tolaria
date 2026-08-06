import type { Color } from "../cards/types";
import {
    getActivatedManaAbility,
    getManaChoiceCounterCost,
    getManaTapOptionRestriction,
    getManaTapOptionsDetailed,
    isTapLockedBySummoningSickness,
    MANA_COLORS,
    normalizedHybridPips,
} from "./constants";
import type { CardInstanceState } from "./state";
import { isManaCostCovered, type ManaSubstitution } from "./state";
import { extraTapManaForOption } from "./tapManaBonus";

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

/** Total the mana an executed {@link AutoTapPlan} adds to the pool, summed over
 *  each tapped source's chosen option (CR 605.1a). Pairs `solveSmartAutoTap` /
 *  `solveAutoTap` with a way to apply the plan when the caller taps sources
 *  directly into a pool rather than through the per-click payment mutation —
 *  used by a controlled cast (Word of Command) auto-tapping the opponent's
 *  lands inside a resolve step. Sources not present in `sources` are skipped. */
export function manaFromPlan(
    sources: AutoTapSource[],
    plan: AutoTapPlan
): ManaContribution {
    const byId = new Map(sources.map((s) => [s.cardId, s]));
    const total: ManaContribution = {};
    for (const step of plan) {
        const src = byId.get(step.cardId);
        if (!src) continue;
        const opt =
            step.manaChoiceIndex !== undefined
                ? src.options.find(
                      (o) => o.manaChoiceIndex === step.manaChoiceIndex
                  )
                : src.options[0];
        if (!opt) continue;
        for (const color of MANA_COLORS) {
            const v = opt.mana[color];
            if (v) total[color] = (total[color] ?? 0) + v;
        }
    }
    return total;
}

/** Strip X and zero/negative entries from a ManaCost into a color contribution. */
function toContribution(cost: {
    // Value union widened to admit the `phyrexian` object key AND the `hybrid`
    // array key (CR 107.4f / 202.1a — issue #1338) on a real `CardManaCost` —
    // this reads only numeric colour pips and ignores everything else, so the
    // extra members are harmless here.
    [k: string]:
        | number
        | string
        | Partial<Record<Color, number>>
        | Array<[Color, Color]>
        | undefined;
}): ManaContribution {
    const out: ManaContribution = {};
    for (const color of MANA_COLORS) {
        const v = cost[color];
        if (typeof v === "number" && v > 0) out[color] = v;
    }
    return out;
}

/** Fold the extra mana a Wild-Growth-style triggered mana ability adds when
 *  `card` (a land) is tapped for this `base` option into the option's output
 *  (CR 605.4). No-op when no bonus applies, so ordinary sources are unchanged. */
function withTapBonus(
    battlefield: CardInstanceState[],
    card: CardInstanceState,
    base: ManaContribution
): ManaContribution {
    const extra = extraTapManaForOption(battlefield, card, base);
    const merged: ManaContribution = { ...base };
    for (const color of MANA_COLORS) {
        const v = extra[color];
        if (v) merged[color] = (merged[color] ?? 0) + v;
    }
    return merged;
}

/** Build the solver's source list from a player's battlefield, excluding
 *  tapped sources, summoning-sick creature dorks (CR 302.1), sacrifice mana
 *  abilities, and anything that produces no known mana output.
 *
 *  A source's options come from the SAME authority the payment primitive uses
 *  to validate the tap — `getManaTapOptionsDetailed` (CR 605.1a / 305.6): the
 *  card's own mana abilities PLUS one intrinsic `{T}: Add` per distinct basic
 *  land subtype, deduped by produced mana. The emitted `manaChoiceIndex` is an
 *  index into that unified list, exactly what `tapSourceIntoPayment` /
 *  `resolveManaTapChoice` resolve it against. Enumerating options any other
 *  way desyncs planner and payment: the old single-colour `getBasicLandMana`
 *  path modelled every land as ONE fixed option, so under a subtype-granting
 *  effect (Urborg, Tomb of Yawgmoth — every land is also a Swamp) the planner
 *  emitted a step with no index while the payment primitive demanded one, and
 *  auto-tap threw "Must choose a mana color". It also hid the granted colour
 *  from the solver entirely.
 *
 *  `battlefields` (issue #2240) is the full multi-player board snapshot —
 *  the same `{ playerId, battlefield }[]` shape produced by
 *  `manaGateBattlefields(state)` and threaded to `resolveManaTapChoice` /
 *  `tapSourceIntoPayment` at the actual payment site. A board-derived choice
 *  ability (`getManaChoices` — a Verge land scanning the CONTROLLER's own
 *  lands, a Mana Battery reading its own counters; `manaColorSource` —
 *  Fellwar Stone scanning every OPPONENT's lands) can only be enumerated
 *  correctly against that same snapshot: `getManaTapOptionsDetailed` resolves
 *  the chooser dynamically from whichever `battlefields` it is handed, so a
 *  narrower snapshot here than the one payment resolves against would compute
 *  a *different* option list — and a `manaChoiceIndex` that means a different
 *  thing server-side (issue #2240's root cause: Verge lands were never
 *  auto-tapped even for their always-on primary colour, because the whole
 *  card was excluded rather than only its narrower-than-payment enumeration).
 *  When the full snapshot IS supplied, a board-derived chooser is a normal
 *  auto-tap candidate — no special-casing, same code path as a static
 *  `manaChoices` source. When it is NOT supplied (a caller with only one
 *  player's battlefield in hand), the pre-existing conservative behaviour
 *  stands: leave board-derived choosers manual rather than risk an index that
 *  resolves differently downstream.
 *
 *  Sorted restricted-first (fewest options) so the minimal solution prefers
 *  inflexible sources (basics) and keeps flexible ones (Birds) for last. */
export function buildAutoTapSources(
    battlefield: CardInstanceState[],
    battlefields?: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): AutoTapSource[] {
    const sources: AutoTapSource[] = [];
    for (const card of battlefield) {
        if (card.isTapped) continue;
        const ability = getActivatedManaAbility(card);

        // Side-effect mana abilities stay manual (sacrifice, e.g. Black Lotus).
        if (ability?.cost.sacrifice === true) continue;
        // Summoning-sick creature mana dorks can't pay a {T} cost (CR 302.1).
        if (ability && isTapLockedBySummoningSickness(card)) continue;
        // Board-derived choosers need the full snapshot to enumerate safely —
        // see the doc comment above. Without one, leave them manual exactly as
        // before the unified enumeration (issue #2240).
        const isBoardDependentChoice = !!(
            ability?.getManaChoices || ability?.manaColorSource
        );
        if (isBoardDependentChoice && !battlefields) continue;

        const options = getManaTapOptionsDetailed(
            card,
            card.controllerId,
            battlefields ?? [{ playerId: card.controllerId, battlefield }]
        );
        if (options.length === 0) continue; // non-mana source: leave manual
        // CR 605.1a — an index is submitted only when the payment primitive
        // actually demands one (`manaTapNeedsChoice` in `game.ts`, the same
        // authority): 2+ options, or a choice-based ability even with a
        // single entry — `manaChoices` (static), `getManaChoices` (board-
        // derived hook) or `manaColorSource` (declarative). Restated here
        // rather than imported because `manaTapNeedsChoice` is private to
        // `game.ts`; keep the two conditions identical (issue #2240 review) —
        // a board-dependent chooser resolving to a single-entry list still
        // needs an index, since its list is choice-based, not fixed-output.
        const needsIndex =
            options.length >= 2 ||
            !!(
                ability?.manaChoices ||
                ability?.getManaChoices ||
                ability?.manaColorSource
            );
        // CR 106.6 — restricted mana (Mishra's Workshop; the SECOND, legendary-
        // spell-only ability on Delighted Halfling) can pay only for certain
        // spells; the solver reasons over the fungible pool and can't model
        // that constraint, so it drops restricted OPTIONS from its candidate
        // set — per-OPTION, not per-source (issue #1559 review), so a card
        // mixing a free ability with a restricted one (Halfling's OTHER,
        // unrestricted "{T}: Add {C}.") stays auto-tappable on its free
        // option; only Mishra's-Workshop-style wholly-restricted sources end
        // up excluded entirely (their only option is filtered out below).
        // CR 122.6 (issue #2240 review, BLOCKING) — a `manaChoiceRemovesCounters`
        // option (Mana Battery / storage lands) whose choice index is > 0
        // spends the player's stored counters as PART OF the option's cost,
        // exactly the same "stored resource the player must not have spent on
        // their behalf" category as the `cost.sacrifice` skip above. Before
        // #2240 threaded the board snapshot, the blanket `getManaChoices` skip
        // kept these choosers manual as a side effect; now that they are real
        // auto-tap candidates, `solveSmartAutoTap` (which minimizes tap COUNT)
        // will always prefer a single counter-burning tap over two ordinary
        // lands, silently draining every counter the ability can reach. Drop
        // every counter-burning option (`getManaChoiceCounterCost(...).count >
        // 0`) here, keeping only the free index-0 "remove 0 counters" pick —
        // the battery stays auto-tappable for its base mana, never for a
        // scaling tap the player didn't choose.
        // Indices are kept against the FULL unified `options` list — the same
        // list `tapSourceIntoPayment` / `resolveManaTapChoice` resolve
        // `manaChoiceIndex` against — so filtering never renumbers them.
        const usable = options
            .map((opt, index) => ({ opt, index }))
            .filter(
                ({ opt }) =>
                    getManaTapOptionRestriction(card, opt.source) === null &&
                    getManaChoiceCounterCost(card, opt.source) === null
            );
        if (usable.length === 0) continue; // wholly restricted: leave manual
        sources.push({
            cardId: card.id,
            options: usable.map(({ opt, index }) => ({
                ...(needsIndex ? { manaChoiceIndex: index } : {}),
                mana: withTapBonus(battlefield, card, toContribution(opt.mana)),
            })),
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
    // CR 202.1a (issue #1739) — a guild-hybrid pip is a colour need too: it
    // must consume one mana of one of its two colours. Purely a search-ORDER
    // heuristic (the DFS still explores every option), but without it the
    // solver tries generic-only options first on a hybrid-heavy cost.
    const hybridPips = normalizedHybridPips(cost);
    if (hybridPips.length > 0) {
        const hybridColors = new Set<string>();
        for (const pip of hybridPips) {
            hybridColors.add(pip[0]);
            hybridColors.add(pip[1]);
        }
        if (!isManaCostCovered(pool, cost, subs)) {
            for (const color of MANA_COLORS) {
                if (mana[color] && hybridColors.has(color)) return true;
            }
        }
    }
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

/** Weight of one preserved Demand inside the unified auto-tap position score
 *  (issue #794 review fix). Chosen to strictly dominate any single-position
 *  source-quality bonus from `evaluateAutoTapPosition` (color breadth
 *  W_SOURCE_BREADTH=4, dual-purpose W_SOURCE_DUAL_PURPOSE=20 — tens at most),
 *  so a concrete color-critical demand is never sacrificed for a generic
 *  breadth/dual bonus. Plans that TIE on preserved demands then rank on the
 *  eval's source-quality term, keeping the dual-purpose / color-flex wins. */
export const W_PRESERVED_DEMAND = 1000;

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
export function floatingAfterPlan(
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

/** Static score of the position a candidate plan leaves behind, higher = better
 *  for the paying player (issue #794). Supplied by the caller (the server-side
 *  payment path) as a closure over the live `GameState` — it simulates the taps
 *  + leftover floating mana and returns the Brain's STATIC `evaluate()` of the
 *  resulting position (no ISMCTS search). Pure. When omitted, smart auto-tap
 *  falls back to the demand-count scorer alone (state.ts feasibility callers,
 *  which only need *a* minimal plan, pass nothing). */
export type PlanPositionScorer = (plan: AutoTapPlan) => number;

/**
 * Smart auto-tap (PRD #472, ADR 0034; evaluation-scored, issue #794). Among all
 * minimal-tap-count plans that cover `cost`, returns the one whose resulting
 * position the Brain's static Evaluation (`scorePlan`) rates highest for the
 * paying player, so dual-purpose permanents (Mishra's Factory) and
 * color-critical sources are left untapped whenever an equal-tap-count plan can
 * pay without them. Plans are ranked by the deterministic order:
 *   (0) highest UNIFIED position score = `scorePlan` (post-payment position value)
 *       + W_PRESERVED_DEMAND × preserved-Demand count — a single scalar in which a
 *       color-critical demand dominates any source-quality breadth/dual bonus, yet
 *       demand-tied plans still rank on the eval's source quality (issue #794 fix),
 *   (1) most remaining-source flexibility (colorless/basics spent first),
 *   (2) lexicographic by tapped cardId.
 * With no `scorePlan` the eval term is 0 across plans, so the unified score reduces
 * to the preserved-Demand count — the legacy demand→flex→lex order exactly.
 *
 * Preserves the minimal-tap-count invariant: it only ever enumerates plans at
 * the smallest covering tap count, so it never taps more sources than
 * `solveAutoTap` would. Returns `[]` when the pool already covers the cost and
 * `null` when no combination of sources can pay it (caller falls back to the
 * partial solver). `demands` should exclude the spell being paid for.
 *
 * `selfSourceId` (issue #544, CR 602.1 / 605.1a): the instance id of the
 * permanent whose own activated ability is being paid for. Its own mana
 * ability is deprioritized — Auto-Tap taps it only when no plan that spares it
 * can cover the cost (strictly necessary). Repro: Mishra's Factory `{1}:`
 * animate must not tap the Factory's own `{T}: Add {C}` while another mana
 * source can pay, or the freshly-animated creature lands tapped. Class-wide:
 * applies to any activated ability whose source also has a mana ability. Pure
 * convenience UX — CR 602.1 never dictates which legal sources a player taps.
 */
export function solveSmartAutoTap(
    pool: Record<string, number>,
    cost: Record<string, number>,
    substitutions: ManaSubstitution[],
    sources: AutoTapSource[],
    demands: Demand[] = [],
    selfSourceId?: string,
    scorePlan?: PlanPositionScorer
): AutoTapPlan | null {
    // Deprioritize the activating permanent's own mana ability (issue #544):
    // first try to cover the cost without it. Only if that is impossible — the
    // self-source is *strictly necessary* — do we fall through to the full
    // source set that includes it. This preserves the minimal-tap invariant on
    // each attempt and keeps the manland untapped whenever an alternative
    // covers the cost.
    if (selfSourceId !== undefined) {
        const withoutSelf = sources.filter((s) => s.cardId !== selfSourceId);
        if (withoutSelf.length !== sources.length) {
            const plan = solveSmartAutoTapCore(
                pool,
                cost,
                substitutions,
                withoutSelf,
                demands,
                scorePlan
            );
            if (plan !== null) return plan;
            // Self-source is strictly necessary: fall through, taps included.
        }
    }
    return solveSmartAutoTapCore(
        pool,
        cost,
        substitutions,
        sources,
        demands,
        scorePlan
    );
}

/** Core demand-aware minimal-tap selection (no self-source handling). */
function solveSmartAutoTapCore(
    pool: Record<string, number>,
    cost: Record<string, number>,
    substitutions: ManaSubstitution[],
    sources: AutoTapSource[],
    demands: Demand[] = [],
    scorePlan?: PlanPositionScorer
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

    // Unified position score (issue #794 + review fix): a SINGLE scalar combining
    // the post-payment Evaluation (`scorePlan`) with the preserved-Demand count as
    // a heavily-weighted term. `evaluateAutoTapPosition` (evaluate.ts) is demand-
    // BLIND — it only prices raw source breadth / dual-purpose quality of the
    // sources a plan spares. Ranking the eval as the strict PRIMARY key regressed
    // demand preservation: a plan sparing a higher-breadth-but-UNNEEDED source
    // (Tropical Island) could outrank one sparing a lower-breadth source a still-
    // castable HELD SPELL actually needs (Plains, held {W}) — the eval's +breadth
    // bonus taps the Plains and strands the {W}. Folding demand preservation in as
    // a term of the SAME scalar (weighted by W_PRESERVED_DEMAND, which dwarfs the
    // source-quality bonuses of ~tens) makes a concrete color-critical demand
    // dominate any breadth/dual bonus, while plans that TIE on demand still fall to
    // the eval's source-quality term — so the dual-purpose / color-flex
    // improvements are retained. With no scorer the eval term is a constant (0)
    // across plans, so the legacy demand→flex→lex order is recovered exactly.
    // Flexibility then lexicographic remain the lower tie-breaks. CR-neutral
    // (601.2g — auto-tap never dictates *which* legal sources are tapped).
    let best: AutoTapPlan | null = null;
    let bestPosition = -Infinity;
    let bestFlex = -1;
    let bestLex = "";
    for (const plan of plans) {
        const evalScore = scorePlan ? scorePlan(plan) : 0;
        const demandScore = scorePreservedDemands(
            pool,
            cost,
            substitutions,
            sources,
            plan,
            liveDemands
        );
        const position = evalScore + W_PRESERVED_DEMAND * demandScore;
        const flex = remainingFlexibility(sources, plan);
        const lex = planLexKey(plan);
        // Lexicographic on (position desc, flex desc, lex asc).
        const better =
            best === null ||
            position > bestPosition ||
            (position === bestPosition && flex > bestFlex) ||
            (position === bestPosition && flex === bestFlex && lex < bestLex);
        if (better) {
            best = plan;
            bestPosition = position;
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
