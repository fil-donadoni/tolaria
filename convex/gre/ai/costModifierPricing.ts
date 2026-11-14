// Cost-modifier pricing for the Brain's leaf evaluation (issue #5363).
//
// A static that raises or lowers what spells cost (CR 601.2f — Sphere of
// Resistance, Trinisphere, Thorn of Amethyst, a Medallion) changes nothing
// the layer system or the effect scripts show, so each of them read as
// `base + MV` on every board. This reads it as MANA ECONOMY, from the
// controller's point of view, on the board it stands on: per known spell in
// each player's hand, the mana that spell costs its caster WITH the source
// minus WITHOUT it. A tax on the opponent's spells is a gain, one on the
// controller's own a loss; a reduction the other way round. Each mana is
// priced at the fitted `costTaxWeight` (`EvalWeights`).
//
// The opponent's side is the case the issue starts from — a taxing artifact
// facing a hand of cheap spells is worth more than one facing a hand of
// spells it barely touches (Trinisphere against one-drops versus six-drops).
// The controller's own side is read by the SAME function, never a second
// shape: a symmetric tax (Sphere of Resistance) is a Symmetric Effect read by
// Differential Reading (ADR 0151) — the opponent's taxed mana minus the
// controller's own — so it carries no fixed sign on the card, and a
// reduction on its controller's spells (a Medallion) reads positive through
// the same subtraction.
//
// The effective cost is the castability reader's (`castCostTotal`,
// `manaAvailability.ts`, post issue #3727): `getCostModifiers` +
// `applyCostModifiers`, the pair the real cast gate and payment path share.
// The "without" side asks that same reader on the board with the source
// removed from the battlefield — the counterfactual is a different board,
// never a second copy of the cost arithmetic. Two sources taxing one spell
// therefore each price what removing that source alone changes (two Spheres:
// one mana each; a Trinisphere beside a Sphere on a one-drop: what each one
// adds on top of the other).
//
// "Known spells" are the cards in a player's hand the state holds a mana cost
// for: in a determinized search world the opponent's hand is the sampled one;
// a hidden placeholder carries no cost and is skipped. Lands are never cast
// (CR 305.1), so never taxed.
//
// Known limits, listed so nobody reads a zero as a verdict:
//   - the reading is taken at the leaf, so a modifier gated on whose turn it
//     is (Defense Grid, `onlyOutsideAnnouncersTurn`) or on spells already cast
//     this turn (Damping Sphere, `perOtherSpellCastByAnnouncerThisTurn`) reads
//     what it would charge right now;
//   - cards outside the hand (a flashback card, the library) are not read;
//   - activated-ability cost modifiers (`appliesToAbility`), alternative and
//     additional costs are out (issue #5363's scope).
//
// Non-creature permanents only (`declaresSpellCostModifier`): a creature's
// hand face does not read a standing worth (`declaresStandingLock`'s same
// limit), so reading the board face alone would open a hand/board gap.
// PURE: no mutation of `state`, no randomness.

import type { CardDefinition } from "../../cards/types";
import { getInstanceManaCost } from "../../cards";
import { isLand, liveStaticDefinition } from "../constants";
import { castCostTotal } from "../manaAvailability";
import type { CardInstanceState, GameState } from "../state";

/** What the reading needs of the weight vector. */
export interface CostModifierWeights {
    /** Margin points per mana one known spell's cost moves. */
    costTaxWeight: number;
}

/** True when `def` is a non-creature, non-land permanent whose static
 *  effects are ALL spell cost modifiers (CR 601.2f) the reading prices whole.
 *  Excluded, like `declaresStandingLock` excludes them: an Aura or a card
 *  choosing as it enters (the board a card in hand would leave behind holds
 *  no host or choice yet), and any other static beside the modifier (a clause
 *  the reading does not price, so the card keeps its unmeasured floor). An
 *  ability-cost modifier (`appliesToAbility`) is not read. */
export function declaresSpellCostModifier(def: CardDefinition): boolean {
    const statics = def.staticEffects;
    if (!statics || statics.length === 0) return false;
    if (
        def.types.includes("Creature") ||
        def.types.includes("Land") ||
        def.types.includes("Planeswalker") ||
        def.types.includes("Instant") ||
        def.types.includes("Sorcery")
    ) {
        return false;
    }
    if (def.subtypes?.includes("Aura") || def.entersWith?.asEnters?.length) {
        return false;
    }
    return statics.every(
        (effect) =>
            effect.kind === "cost-modifier" &&
            effect.appliesToSpell !== undefined &&
            effect.appliesToAbility === undefined
    );
}

/** `state` with `source` taken off its controller's battlefield — the board
 *  the "without" side of the counterfactual prices on. Shallow: only the one
 *  battlefield array is replaced. */
function withoutSource(state: GameState, source: CardInstanceState): GameState {
    return {
        ...state,
        players: state.players.map((p) =>
            p.id === source.controllerId
                ? {
                      ...p,
                      battlefield: p.battlefield.filter(
                          (c) => c.id !== source.id
                      ),
                  }
                : p
        ),
    };
}

/** The standing worth of `source`'s spell cost modifiers on this board, to
 *  its controller: per known spell in each hand, the mana it costs with the
 *  source minus without it, the opponent's a gain and the controller's own a
 *  loss, at `costTaxWeight` per mana. Zero for a permanent that declares
 *  none. Read by the board term (once), `permanentRealisedValue` (once — the
 *  source's own credit is all a removal takes away) and the hand face
 *  (`standingLockWorth`), so the faces are one number. */
export function costModifierStandingWorth(
    state: GameState,
    source: CardInstanceState,
    weights: CostModifierWeights
): number {
    // CR 613.1f — a source that lost its abilities modifies nothing.
    const def = liveStaticDefinition(source);
    if (!def || !declaresSpellCostModifier(def)) return 0;
    const without = withoutSource(state, source);
    let manaMoved = 0;
    for (let i = 0; i < state.players.length; i++) {
        const caster = state.players[i];
        const casterWithout = without.players[i];
        let side = 0;
        for (const card of caster.hand) {
            if (isLand(card)) continue;
            const cost = getInstanceManaCost(card);
            if (!cost) continue;
            side +=
                castCostTotal(cost, { state, caster, card }) -
                castCostTotal(cost, {
                    state: without,
                    caster: casterWithout,
                    card,
                });
        }
        manaMoved += caster.id === source.controllerId ? -side : side;
    }
    return manaMoved * weights.costTaxWeight;
}
