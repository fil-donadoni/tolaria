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
        const amount = getFixedManaAmount(card, color);
        sources.push({
            cardId: card.id,
            options: [{ mana: { [color]: amount } }],
        });
    }

    // Restricted-first: single-option sources before multi-option ones.
    sources.sort((a, b) => a.options.length - b.options.length);
    return sources;
}

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
