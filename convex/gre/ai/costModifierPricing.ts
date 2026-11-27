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
// The DECK, past the hand: a tax keeps charging every spell its victim draws
// while it stands, so a Trinisphere facing a deck of one-drops is worth more
// than one facing a hand of them over a deck of six-drops. The library is
// read as the EXPECTED tax on the next draw (CR 504.1): the mean, over every
// card in it, of the mana the source adds to it (a land, or a placeholder
// with no cost, adds zero and still counts in the mean — it is a draw the
// tax does not touch), priced at the fitted `costTaxLibraryWeight`. Order is
// never read, so the determinized shuffle cannot move it.
//
// Known limits, listed so nobody reads a zero as a verdict:
//   - the reading is taken at the leaf, so a modifier gated on whose turn it
//     is (Defense Grid, `onlyOutsideAnnouncersTurn`) or on spells already cast
//     this turn (Damping Sphere, `perOtherSpellCastByAnnouncerThisTurn`) reads
//     what it would charge right now;
//   - cards in the graveyard or exile (a flashback card) are not read;
//   - activated-ability cost modifiers (`appliesToAbility`), alternative and
//     additional costs are out (issue #5363's scope).
//
// The hand face reads non-creature permanents only (`declaresSpellCostModifier`):
// a creature's hand face does not read a standing worth (`declaresStandingLock`'s
// same limit). The BOARD face also reads a creature source (Thalia, Guardian of
// Thraben — `declaresStandingSpellCostModifier`), under `permanents` beside its
// body, as a creature restriction source is read (issue #5154): what her tax
// does to the rest of the board is a presence fact, and a removal choosing
// between her and an identical body must see it. Its hand face keeps the body.
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
    /** Margin points per mana of the expected tax on the next draw (the
     *  library's mean). */
    costTaxLibraryWeight: number;
}

/** True when `def` is a non-creature, non-land permanent whose static
 *  effects are ALL spell cost modifiers (CR 601.2f) the reading prices whole.
 *  Excluded, like `declaresStandingLock` excludes them: an Aura or a card
 *  choosing as it enters (the board a card in hand would leave behind holds
 *  no host or choice yet), and any other static beside the modifier (a clause
 *  the reading does not price, so the card keeps its unmeasured floor). An
 *  ability-cost modifier (`appliesToAbility`) is not read. */
export function declaresSpellCostModifier(def: CardDefinition): boolean {
    return !def.types.includes("Creature") && spellCostModifierShape(def);
}

/** The board face's gate: `declaresSpellCostModifier`, plus a CREATURE whose
 *  static effects are all spell cost modifiers (its keywords aside). Read by
 *  the standing worth only, never by the hand face. */
export function declaresStandingSpellCostModifier(
    def: CardDefinition
): boolean {
    return spellCostModifierShape(def);
}

function spellCostModifierShape(def: CardDefinition): boolean {
    const statics = def.staticEffects;
    if (!statics || statics.length === 0) return false;
    if (
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

/** Mana `source` adds to one known card's cost for `caster`: its effective
 *  cost (`castCostTotal`) on this board minus on the board without the
 *  source. Zero for a land or a card with no known cost. */
function manaMovedOn(
    state: GameState,
    without: GameState,
    i: number,
    card: CardInstanceState
): number {
    if (isLand(card)) return 0;
    const cost = getInstanceManaCost(card);
    if (!cost) return 0;
    return (
        castCostTotal(cost, { state, caster: state.players[i], card }) -
        castCostTotal(cost, {
            state: without,
            caster: without.players[i],
            card,
        })
    );
}

/** The margin points `source`'s spell cost modifiers move on the spells of
 *  the player at index `i`, unsigned: the mana added to each known card in
 *  hand at `costTaxWeight`, plus the library's mean added mana (the expected
 *  tax on the next draw) at `costTaxLibraryWeight`. Positive for a tax,
 *  negative for a reduction. */
function taxOnSeat(
    state: GameState,
    without: GameState,
    i: number,
    weights: CostModifierWeights
): number {
    const caster = state.players[i];
    let hand = 0;
    for (let j = 0; j < caster.hand.length; j++) {
        hand += manaMovedOn(state, without, i, caster.hand[j]);
    }
    let library = 0;
    const deck = caster.library;
    for (let j = 0; j < deck.length; j++) {
        library += manaMovedOn(state, without, i, deck[j]);
    }
    const expectedDraw = deck.length > 0 ? library / deck.length : 0;
    return (
        hand * weights.costTaxWeight +
        expectedDraw * weights.costTaxLibraryWeight
    );
}

/** The standing worth of `source`'s spell cost modifiers on this board, to
 *  its controller: per player, the tax it lays on that player's known spells
 *  (`taxOnSeat` — the hand, and the expected next draw), the opponent's a gain
 *  and the controller's own a loss. Zero for a permanent that declares none.
 *  Read by the board term (once), `permanentRealisedValue` (once — the
 *  source's own credit is all a removal takes away) and the hand face
 *  (`standingLockWorth`), so the faces are one number. */
export function costModifierStandingWorth(
    state: GameState,
    source: CardInstanceState,
    weights: CostModifierWeights
): number {
    // CR 613.1f — a source that lost its abilities modifies nothing.
    const def = liveStaticDefinition(source);
    if (!def || !declaresStandingSpellCostModifier(def)) return 0;
    const without = withoutSource(state, source);
    let worth = 0;
    for (let i = 0; i < state.players.length; i++) {
        const side = taxOnSeat(state, without, i, weights);
        worth += state.players[i].id === source.controllerId ? -side : side;
    }
    return worth;
}

/** The part of an OPPOSING `source`'s standing worth that is the tax it lays
 *  on `holderId`'s own spells (`taxOnSeat`): what a removal spell in
 *  `holderId`'s hand does NOT relieve by being held. Zero for the holder's
 *  own permanent or one that declares no spell cost modifier. */
export function costModifierTaxOnHolder(
    state: GameState,
    source: CardInstanceState,
    holderId: string,
    weights: CostModifierWeights
): number {
    if (source.controllerId === holderId) return 0;
    const def = liveStaticDefinition(source);
    if (!def || !declaresStandingSpellCostModifier(def)) return 0;
    const i = state.players.findIndex((p) => p.id === holderId);
    if (i < 0) return 0;
    return taxOnSeat(state, withoutSource(state, source), i, weights);
}
