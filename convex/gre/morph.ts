// Morph (CR 702.37, issue #2705) — the face-down cast and the turn-face-up
// special action.
//
// Morph is TWO mechanisms wearing one keyword, and this module keeps both in
// one place so the cast side and the turn-up side can never disagree about
// which cost is which:
//
//   1. THE CAST (CR 702.37a/c). "You may cast this card as a 2/2 face-down
//      creature with no text, no name, no subtypes, and no mana cost by paying
//      {3} rather than paying its mana cost." That is an ALTERNATIVE COST
//      (CR 118.9) — the rule text says so explicitly ("This follows the rules
//      for paying alternative costs") — so it rides the engine's existing
//      `AlternativeCost` / `announceCast.alternativeCostId` plumbing rather
//      than a bespoke cast path. What makes it unlike every other alternative
//      cost the engine ships is that it ALSO changes the object put on the
//      stack: the spell is a face-down 2/2, not the printed card. That half is
//      `turnFaceDown` (gre/faceDown.ts, ADR 0013) applied to the StackItem at
//      the commit, the same seam `applyBestowCharacteristics` uses.
//
//      The {3} is a CONSTANT of the rule, not card data — synthesized here by
//      {@link morphCastAlternativeCost} for every card carrying
//      `CardDefinition.morph`, so no card can declare a face-down cast cost
//      that disagrees with CR 702.37a.
//
//   2. THE TURN-UP (CR 702.37e / 116.2b). "Any time you have priority, you may
//      turn a face-down permanent you control with a morph ability face up.
//      This is a special action; it doesn't use the stack." The cost paid is
//      the permanent's own PRINTED morph cost (`CardDefinition.morph`), read
//      off the real card through `CardInstanceState.faceDownOf` — per
//      permanent and VARIABLE, which is what distinguishes this special action
//      from `summon-companion` (fixed {3}, per player, once per game).
//
//      CR 702.37e's parenthetical — "If the permanent wouldn't have a morph
//      cost if it were face up, it can't be turned face up this way" — is the
//      whole reason {@link getMorphCost} may return `undefined` rather than
//      defaulting: a face-down permanent made by Illusionary Mask (CR 708.2,
//      ADR 0013) has no morph cost and therefore no special action, even
//      though the very same `turnFaceUp` primitive can still turn it up via
//      the sentinel definition's damage/tap replacement effects.
//
// Megamorph (CR 702.37b) is NOT implemented — see `CardDefinition.morph`.

import type { AlternativeCost, CardDefinition, ManaCost } from "../cards/types";
import { FACE_DOWN_CARD_ID, tryGetDefinition } from "../cards";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import { getManaSubstitutions, normalizeManaCost } from "./state";
import {
    buildAutoTapSources,
    solveSmartAutoTap,
    type AutoTapPlan,
} from "./autoTap";
import { manaGateBattlefields } from "./constants";

/** The `AlternativeCost.id` of the CR 702.37a face-down cast. Stable across
 *  every morph card (the cost is the rule's, not the card's), so the client's
 *  alt-cost picker, `announceCast.alternativeCostId` and the Bot's
 *  `cast-spell` Move all name the same string. */
export const MORPH_CAST_ALT_COST_ID = "morph-face-down";

/** CR 702.37a — "by paying {3} rather than paying its mana cost". Normalized
 *  the same way every mana cost in the engine is (`X` carries the generic
 *  portion) so it can be handed straight to `solveSmartAutoTap`. */
export const MORPH_CAST_MANA_COST: ManaCost = { X: 3 };

/** CR 702.37a — the synthesized face-down cast option for a card with morph,
 *  or `undefined` for a card without one. NOT stored on the card: see the
 *  module header. */
export function morphCastAlternativeCost(
    def: CardDefinition | undefined
): AlternativeCost | undefined {
    if (!def?.morph) return undefined;
    return {
        id: MORPH_CAST_ALT_COST_ID,
        description: "Cast face down as a 2/2 creature",
        mana: MORPH_CAST_MANA_COST,
    };
}

/** True iff `alt` is THIS card's CR 702.37a face-down cast option. Keyed on
 *  the id AND on the card actually having morph, so a hypothetical card that
 *  declared an ordinary `alternativeCosts[]` entry with the same id could not
 *  smuggle a face-down cast onto a card with no morph ability (fail closed —
 *  the id alone is an implicit invariant, this is an explicit one). */
export function isMorphCastAlternativeCost(
    def: CardDefinition | undefined,
    alt: AlternativeCost | undefined
): boolean {
    return isMorphCastId(def, alt?.id);
}

/** The by-id form of {@link isMorphCastAlternativeCost}, for the call sites that
 *  hold a `Move.alternativeCostId` string rather than a resolved cost object
 *  (`applyMove`/`search`). Same fail-closed conjunction — both must agree. */
export function isMorphCastId(
    def: CardDefinition | undefined,
    altCostId: string | undefined
): boolean {
    return altCostId === MORPH_CAST_ALT_COST_ID && def?.morph !== undefined;
}

/** CR 702.37c / 707.2 (issue #2970 review) — the characteristics a MORPH cast
 *  is priced against: "a 2/2 creature with no text, no name, no subtypes, and
 *  no mana cost", so any effect that would change what it costs to cast must be
 *  judged against THOSE, never the real card's. Returns a throwaway view of the
 *  announced card with the face-down sentinel swapped in — the same substitution
 *  `turnFaceDown` (`gre/faceDown.ts`) performs on a real permanent — so every
 *  def-derived reader (`getColors`, `getPrintedTypes`, `getName`) and every
 *  live-array reader (`types`, `subtypes`) sees the vanilla 2/2.
 *
 *  Without it, Gloom ("White spells cost {3} more to cast", `lea/black.ts`)
 *  taxes a face-down Exalted Angel — a colourless spell — and Sapphire Leech /
 *  Aura of Silence are the same shape on colour and card type. The card itself
 *  is NOT mutated: it is still face up in its zone, and only turns face down
 *  when the cast commits.
 *
 *  Shared by all three sites that price a cast: `announceCast`'s no-target
 *  alt-cost branch (`game.ts`), `getLegalActions`'s alt-cost affordance branch
 *  (`gre/rules.ts`) and the Bot's morph variant (`gre/moves.ts`) — one view, so
 *  the gate, the payment and the tap plan cannot disagree. */
export function faceDownCastView(card: CardInstanceState): CardInstanceState {
    return {
        ...card,
        card: { id: FACE_DOWN_CARD_ID },
        types: ["Creature"],
        subtypes: [],
        power: 2,
        toughness: 2,
        staticAbilities: [],
    };
}

/** CR 702.37e — the morph cost of a FACE-DOWN permanent, i.e. "what the
 *  permanent's morph cost would be if it were face up", read off the real card
 *  behind `faceDownOf`. `undefined` when the permanent is not face down, when
 *  its real identity is unknown to the registry, or when that real card has no
 *  morph ability — the parenthetical case that forbids the special action. */
export function getMorphCost(
    card: CardInstanceState | undefined
): ManaCost | undefined {
    if (!card?.faceDown || !card.faceDownOf) return undefined;
    return tryGetDefinition(card.faceDownOf)?.morph;
}

/** The auto-tap plan that pays `card`'s morph cost from `player`'s pool and
 *  untapped sources, or `null` when it cannot be paid. Shared by the legality
 *  predicate below and by the authoritative `turnPermanentFaceUp` mutation
 *  (game.ts), so "the button is offered" and "the payment succeeds" are one
 *  decision rather than two that can drift. */
export function morphTurnUpPaymentPlan(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): AutoTapPlan | null {
    const cost = getMorphCost(card);
    if (!cost) return null;
    const subs = getManaSubstitutions(state, player.id);
    const sources = buildAutoTapSources(
        player.battlefield,
        manaGateBattlefields(state)
    );
    return solveSmartAutoTap(
        player.manaPool,
        normalizeManaCost(cost),
        subs,
        sources
    );
}

/** CR 702.37e / 116.2b — true iff `player` may take the `turn-face-up` special
 *  action on `card` right now.
 *
 *  Deliberately WIDER than `canSummonCompanion`: CR 116.2b grants this action
 *  "any time they have priority", with no sorcery-timing and no empty-stack
 *  restriction — turning a morph creature up mid-combat, or in response to a
 *  removal spell already on the stack, is the mechanic's whole point. The only
 *  shared gate is the engine-hygiene one every macro-action observes: a player
 *  mid-payment on something else is not in an ordinary priority window, and
 *  `enumerateMoves` (moves.ts) surfaces nothing at all while such a
 *  continuation is open.
 *
 *  Single source of truth for the Bot enumerator (moves.ts), the wire
 *  affordance flag (`projectBattlefieldCard`, gameProjections.ts) and the
 *  `turnPermanentFaceUp` mutation (game.ts). */
export function canTurnFaceUp(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): boolean {
    if (state.priorityPlayerId !== player.id) return false;
    // CR 702.37e — "a face-down permanent YOU CONTROL". Control, not
    // ownership (CR 108.4): a stolen face-down creature is unmorphable by its
    // new controller, who pays the cost they are shown.
    if (card.controllerId !== player.id) return false;
    if (card.zone !== "battlefield") return false;
    if (
        state.pendingCast ||
        state.pendingActivation ||
        state.pendingCompanionPay ||
        state.pendingTarget ||
        (state.pendingChoices && state.pendingChoices.length > 0)
    ) {
        return false;
    }
    return morphTurnUpPaymentPlan(state, player, card) !== null;
}

/** Every face-down permanent `player` controls that may be turned face up right
 *  now (CR 702.37e). One place the enumerator, the projection and the tests all
 *  read, so "which permanents offer the action" is never re-derived. */
export function turnableFaceUpPermanents(
    state: GameState,
    player: PlayerState
): CardInstanceState[] {
    return player.battlefield.filter((c) => canTurnFaceUp(state, player, c));
}
