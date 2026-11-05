// CR 702.99 — the half of Cipher that functions from exile. The keyword's spell
// ability is `cards/abilities/cipher.ts`; what it leaves behind is the
// `encodedOn` link on the exiled card, and everything here reads that link.
//
// Engine-owned rather than a `triggered-grant`: a template on the granting card
// cannot name WHICH encoded card a trigger is for, and the ability has to, since
// two cards encoded on one creature trigger separately and the creature may be
// gone by the time either resolves (CR 113.7a). What the grant would have decided
// is still decided at the same moment: CR 613.1f's ability loss outranks the
// encoding's own timestamp, and a creature that lost the ability keeps the card
// encoded and simply does not trigger. A copy of the creature inherits nothing
// (CR 707.2), because the link names one instance.

import type { DamageDealtEvent, EffectOp } from "../cards/types";
import {
    abilityLossTimestamp,
    grantOutrankedByAbilityLoss,
} from "./activatedAbilities";
import { INLINE_DELAYED_TRIGGER_ID } from "./effects/interpreter";
import { allocInstanceId, findPermanent } from "./lookup";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "./state/declarations";

/** CR 702.99a's quoted ability, verbatim, for the stack tile. */
const ENCODED_CARD_TRIGGER_TEXT =
    "Whenever this creature deals combat damage to a player, you may copy the encoded card and you may cast the copy without paying its mana cost.";

/** CR 702.99a — the event fields naming the cards encoded on `source` whose
 *  granted ability it still has: none, once a later CR 613.1f loss outranks the
 *  encoding. Empty, so an event with no encoded card carries no field at all. */
export function encodedCardsGrantingAbility(
    state: GameState,
    source: CardInstanceState
): Pick<DamageDealtEvent, "encodedCardIds"> {
    const strippedAt = abilityLossTimestamp(source);
    const ids: string[] = [];
    for (const player of state.players) {
        for (const card of player.exile) {
            if (card.encodedOn?.permanentId !== source.id) continue;
            if (grantOutrankedByAbilityLoss(card.encodedOn.seq, strippedAt)) {
                continue;
            }
            ids.push(card.id);
        }
    }
    return ids.length > 0 ? { encodedCardIds: ids } : {};
}

/** CR 702.99c — `card` is encoded on a permanent `playerId` controls now: a link
 *  naming a permanent that has left the battlefield is no encoding. The evaluator
 *  reads this, so losing the creature reads as losing the spell. */
export function isEncodedForController(
    state: GameState,
    card: Pick<CardInstanceState, "encodedOn">,
    playerId: string
): boolean {
    const permanentId = card.encodedOn?.permanentId;
    if (permanentId === undefined) return false;
    return findPermanent(state, permanentId)?.controllerId === playerId;
}

/** CR 702.99a — the triggered ability for one encoded card, controlled by whoever
 *  controlled the creature as it dealt the damage. The body rides the inline-body
 *  machinery with the card bound through the payload, so resolving needs neither
 *  the creature nor the link: a card that has left exile by then is a new object
 *  (CR 400.7), and is simply not found. */
export function buildEncodedCardTrigger(
    state: GameState,
    cardInstanceId: string,
    event: DamageDealtEvent
): StackItem | undefined {
    const card = state.players
        .flatMap((p) => p.exile)
        .find((c) => c.id === cardInstanceId);
    if (!card) return undefined;
    const controllerId = event.sourceControllerId;
    const cast: EffectOp = {
        op: "castDuringResolution",
        player: "controller",
        card: { ref: "$encodedCard" },
        source: "exile",
        free: true,
        asCopy: true,
    };
    return {
        id: allocInstanceId(state),
        card: { id: (card.card as { id?: string }).id ?? "" },
        controllerId,
        ownerId: controllerId,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: controllerId,
        triggerSourceId: event.sourceInstanceId,
        delayedTriggerId: INLINE_DELAYED_TRIGGER_ID,
        delayedEffects: [cast],
        // Payload keys drop the `$` sigil (Convex reserves it on field names);
        // `runDelayedTriggerBody` restores it.
        delayedPayload: { encodedCard: [card.id] },
        delayedOracleText: ENCODED_CARD_TRIGGER_TEXT,
        // CR 603.3b — an ordinary trigger, ordered in APNAP with every other
        // ability this damage fired.
        reflexiveTrigger: true,
    };
}
