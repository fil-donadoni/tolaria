// Escape (CR 702.138) — a keyword-cast capability that lets a card be cast from
// its owner's graveyard for an alternative ESCAPE COST: a mana cost PLUS exiling
// OTHER cards from that graveyard (CR 702.138a). A permanent cast this way
// "escaped" (CR 702.138e) — a flag the resulting permanent carries, read by
// "sacrifice it unless it escaped" / "as long as ~ escaped" clauses.
//
// 702.138a "Escape—[cost], Exile [number of] other cards from your graveyard"
//          means "You may cast this card from your graveyard by paying [cost]
//          and exiling [number of] other cards from your graveyard as an
//          additional cost to cast this spell."
// 702.138b A card in a graveyard with escape may be cast this way.
// 702.138e An object "escaped" if it was cast for its escape cost.
//
// Escape is engine/cost-system infrastructure, NOT an Effect Script Op — a
// card's on-resolution effect stays DSL; only the CAST permission and cost live
// here. Unlike Flashback (CR 702.34), the escaping card is NOT exiled as it
// resolves: it moves graveyard → stack → its normal destination.
import type { EscapeCost, ManaCost } from "../cards/types";
import { getInstanceManaCost, tryGetDefinition } from "../cards";
import { isLand } from "./constants";
import type { CardInstanceState, GameState, PlayerState } from "./state";

/** The escape cost PRINTED on `card`'s definition (Uro, Phlage, Nethergoyf), or
 *  undefined when the card has no printed escape. */
export function getPrintedEscape(
    card: CardInstanceState
): EscapeCost | undefined {
    const id = (card.card as { id?: string }).id;
    return id ? (tryGetDefinition(id)?.escape ?? undefined) : undefined;
}

/** CR 702.138 — the escape cost GRANTED to `card` by a battlefield permanent
 *  (Underworld Breach: "Each nonland card in your graveyard has escape. The
 *  escape cost is equal to the card's mana cost plus exile N other cards from
 *  your graveyard"), or undefined when no such grant reaches this card. The
 *  granting permanent must be controlled by the graveyard card's owner and the
 *  card must be nonland. */
export function getGrantedEscape(
    state: GameState,
    card: CardInstanceState
): EscapeCost | undefined {
    if (isLand(card)) return undefined; // "Each NONLAND card"
    const owner = state.players.find((p) => p.id === card.ownerId);
    if (!owner) return undefined;
    for (const perm of owner.battlefield) {
        const permId = (perm.card as { id?: string }).id;
        const grant = permId
            ? tryGetDefinition(permId)?.grantsEscapeToOwnGraveyard
            : undefined;
        if (grant) {
            const mana = getInstanceManaCost(card) ?? {};
            return { mana, exile: { count: grant.exileOtherCount } };
        }
    }
    return undefined;
}

/** The escape cost in effect for `card` right now — the printed cost if any,
 *  else a battlefield-granted cost (Underworld Breach). Undefined when the card
 *  has no escape (CR 702.138a). */
export function getEscapeCost(
    state: GameState,
    card: CardInstanceState
): EscapeCost | undefined {
    return getPrintedEscape(card) ?? getGrantedEscape(state, card);
}

/** True iff `card` currently has an escape cost (printed or granted). */
export function hasEscape(state: GameState, card: CardInstanceState): boolean {
    return getEscapeCost(state, card) !== undefined;
}

/** The MANA portion of `card`'s escape cost (CR 702.138a), or undefined when
 *  the card has no escape. */
export function getEscapeManaCost(
    state: GameState,
    card: CardInstanceState
): ManaCost | undefined {
    return getEscapeCost(state, card)?.mana;
}

/** CR 702.138b — the card in `player`'s graveyard with `instanceId` that can be
 *  cast via Escape right now (it carries an escape cost), or undefined. Only the
 *  graveyard zone is a legal escape source. */
export function findEscapeCastable(
    state: GameState,
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card) return undefined;
    return hasEscape(state, card) ? card : undefined;
}

/** CR 702.138a (Nethergoyf) — the number of DISTINCT card types among `cards`
 *  (artifact, battle, creature, enchantment, instant, kindred, land,
 *  planeswalker, sorcery, …). Used to validate the "exile any number of other
 *  cards … with N or more card types among them" variable escape cost. */
export function countDistinctCardTypes(cards: CardInstanceState[]): number {
    const types = new Set<string>();
    for (const c of cards) {
        for (const t of c.types) types.add(t);
    }
    return types.size;
}

/** CR 702.138a — how many OTHER graveyard cards `card` demands the caster exile
 *  for its escape cost, as a picker spec, or undefined when the card either has
 *  no escape or its escape mana-only (never — every escape exiles at least
 *  one other card in the current pool). Returns the fixed `count` shape or the
 *  Nethergoyf `minCardTypes` variable shape. */
export function getEscapeExileSpec(
    state: GameState,
    card: CardInstanceState
): { count: number } | { minCardTypes: number } | undefined {
    return getEscapeCost(state, card)?.exile;
}
