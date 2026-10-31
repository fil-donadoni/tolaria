// CR 701.42 / 712.4 / 712.21 (ADR 0161) — the engine half of meld: one
// melded permanent represented by two cards.
//
// A melded permanent is ONE `CardInstanceState`: it keeps the instance id of
// the half whose ability melded it, presents that half's registered meld twin
// (`${cardId}#meld`, `cards/meld.ts`) and remembers both cards in
// `meldedFrom`. Never two instances — SBAs, combat, targeting, the projection
// and the Bot's enumerator all see the one object CR 701.42a describes.
//
// "One card becomes two" happens in exactly two places:
//   - leaving the battlefield (`splitMeldedPermanent`, called by the single
//     departure funnel `removePermanentTo`): one permanent leaves, two cards
//     arrive (CR 712.21), both stamped with `meldGroupId`;
//   - acting on what an effect found afterwards (`expandMeldGroup`): an
//     effect that finds the new object finds both cards and the same action
//     is taken on each (CR 712.21c). The finding stays ONE reference
//     (`resolveObjectRef` keeps its single-selection signature), so an Op that
//     asks a question asks it once (the Mimic Vat example).

import type { CardDefinition, TargetSelection } from "../cards/types";
import { tryGetDefinition } from "../cards";
import { formMeldPair, meldResultDefinitionId } from "../cards/meld";
import { rebuildCopiableValuesAndReplayOverlays } from "./identitySwap";
import type { LayerStateView } from "./layers";
import type { CardInstanceState, GameState, MeldedCard } from "./state";

/** The non-battlefield zones a card of a split melded permanent can land in. */
type CardZone = "graveyard" | "exile" | "hand" | "library";

const CARD_ZONES: readonly CardZone[] = [
    "graveyard",
    "exile",
    "hand",
    "library",
];

/** The printed (front-face) copiable values of `def` — what a card shows in
 *  every zone but a melded permanent (CR 712.8a). */
function frontValues(def: CardDefinition) {
    return {
        types: [...def.types],
        subtypes: def.subtypes ? [...def.subtypes] : [],
        power: def.power,
        toughness: def.toughness,
        staticAbilities: def.staticAbilities ? [...def.staticAbilities] : [],
    };
}

/** CR 712.21 — split a melded permanent leaving the battlefield for
 *  `toZone` back into its two cards. `creature` (the departing object, which
 *  keeps the meld-ability half's instance id) becomes that half again in
 *  place; the OTHER card is returned as a fresh instance for the caller to
 *  put into ITS owner's `toZone` (CR 712.21a — "its owner's graveyard",
 *  per card). Both carry `meldGroupId` = the departed permanent's id, the
 *  CR 712.21c handle. `undefined` (and `creature` untouched) for an ordinary
 *  permanent.
 *
 *  Runs AFTER the departure's LKI snapshot, so leave triggers see the one
 *  melded object (CR 712.21's Chittering Host: "whenever a creature dies"
 *  triggers once). The destination is the one ALREADY rewritten by any
 *  replacement, which is CR 712.21d: one replacement applied to one card
 *  affects both. */
export function splitMeldedPermanent(
    state: LayerStateView,
    creature: CardInstanceState,
    toZone: CardZone
): CardInstanceState | undefined {
    const melded = creature.meldedFrom;
    if (!melded || melded.length !== 2) return undefined;
    const [lead, other] = melded;
    const leadDef = tryGetDefinition(lead.cardId);
    const otherDef = tryGetDefinition(other.cardId);
    if (!leadDef || !otherDef) return undefined;
    delete creature.meldedFrom;
    creature.card = { id: lead.cardId };
    if (lead.imagePrintId) creature.imagePrintId = lead.imagePrintId;
    else delete creature.imagePrintId;
    creature.ownerId = lead.ownerId;
    rebuildCopiableValuesAndReplayOverlays(
        state,
        creature,
        frontValues(leadDef)
    );
    creature.meldGroupId = creature.id;
    return {
        id: other.instanceId,
        card: { id: other.cardId },
        ...frontValues(otherDef),
        controllerId: other.ownerId,
        ownerId: other.ownerId,
        zone: toZone,
        isTapped: false,
        meldGroupId: creature.id,
        ...(other.imagePrintId ? { imagePrintId: other.imagePrintId } : {}),
    };
}

/** CR 701.42a / 712.14c — turn two EXILED cards into one melded permanent
 *  presenting `holder`'s meld twin, ready to be put onto the battlefield by
 *  the caller's entry funnel. `holder` keeps its instance id; `partner`'s
 *  waits in `meldedFrom`. Returns `false` (both cards untouched, where they
 *  are — CR 701.42c) when the two cannot be melded: CR 701.42b, "Only two
 *  cards belonging to the same meld pair can be melded. Tokens, cards that
 *  aren't meld cards, or meld cards that don't form a meld pair can't be
 *  melded." */
export function stampMeldedPermanent(
    state: LayerStateView,
    holder: CardInstanceState,
    partner: CardInstanceState
): boolean {
    if (holder.isToken || partner.isToken) return false;
    const holderId = (holder.card as { id?: string }).id;
    const partnerId = (partner.card as { id?: string }).id;
    if (!holderId || !partnerId) return false;
    if (
        !formMeldPair(
            tryGetDefinition(holderId) ?? undefined,
            tryGetDefinition(partnerId) ?? undefined
        )
    ) {
        return false;
    }
    const twin = tryGetDefinition(meldResultDefinitionId(holderId));
    if (!twin) return false;
    const card = (c: CardInstanceState, cardId: string): MeldedCard => ({
        cardId,
        ownerId: c.ownerId,
        instanceId: c.id,
        ...(c.imagePrintId ? { imagePrintId: c.imagePrintId } : {}),
    });
    holder.meldedFrom = [card(holder, holderId), card(partner, partnerId)];
    holder.card = { id: twin.id };
    delete holder.imagePrintId;
    delete holder.meldGroupId;
    rebuildCopiableValuesAndReplayOverlays(state, holder, frontValues(twin));
    return true;
}

/** Where a card sitting in a non-battlefield zone is: its owner's zone. */
function findCardInZones(
    state: Pick<GameState, "players">,
    id: string
): { card: CardInstanceState; zone: CardZone } | undefined {
    for (const player of state.players) {
        for (const zone of CARD_ZONES) {
            const card = player[zone].find((c) => c.id === id);
            if (card) return { card, zone };
        }
    }
    return undefined;
}

/** CR 712.21c — the OTHER cards of `cardId`'s meld group still sitting
 *  together in the zone the split put them in (any owner's zone of that
 *  name: the two cards may have different owners, CR 712.21a). Empty for a
 *  card that is in no group, or whose partner has since moved on (a new
 *  object, CR 400.7). */
export function meldGroupPartners(
    state: Pick<GameState, "players">,
    cardId: string
): CardInstanceState[] {
    const found = findCardInZones(state, cardId);
    const group = found?.card.meldGroupId;
    if (!found || group === undefined) return [];
    return state.players.flatMap((p) =>
        p[found.zone].filter((c) => c.id !== cardId && c.meldGroupId === group)
    );
}

/** CR 712.21c — "If an effect can find the new object that a melded
 *  permanent becomes as it leaves the battlefield, it finds both cards. If
 *  that effect causes actions to be taken upon those cards, the same actions
 *  are taken upon each of them."
 *
 *  THE expansion authority: every object-acting Op routes its resolved
 *  selection through here before acting (guarded catalogue-wide by
 *  `meldGroupExpansion.test.ts` over `EFFECT_OP_REGISTRY`). A selection of a
 *  card in a non-battlefield zone expands to itself plus its group partners;
 *  every other selection — a permanent (a melded permanent is ONE object), a
 *  player, a spell — is returned alone. */
export function expandMeldGroup(
    state: Pick<GameState, "players">,
    selection: TargetSelection
): TargetSelection[] {
    if (selection.type !== "graveyard-card" && selection.type !== "hand-card") {
        return [selection];
    }
    const partners = meldGroupPartners(state, selection.id);
    return [
        selection,
        ...partners.map(
            (c): TargetSelection => ({
                // The carrier the interpreter's ref resolution gives a card
                // in that zone: a hand card, else a public-zone card.
                type: c.zone === "hand" ? "hand-card" : "graveyard-card",
                id: c.id,
                playerId: c.ownerId,
            })
        ),
    ];
}

/** CR 400.7 — a card of a meld group that changes zones is a new object and
 *  no longer one of the two cards an effect could find. */
export function leaveMeldGroup(card: CardInstanceState): void {
    delete card.meldGroupId;
}

/** CR 712.21a / 712.21b — queue the arrangement of a split melded
 *  permanent's two cards when they landed TOGETHER in one player's
 *  graveyard, library or exile (two owners means two zones, each with one
 *  card: nothing to arrange). The graveyard and library are arranged by
 *  their owner ("that player may arrange the two cards in any order"); exile
 *  by the player who exiled the permanent ("that player determines the
 *  relative timestamp order"), read as the controller of the effect that
 *  exiled it, else the permanent's controller. A hand has no order. */
export function queueMeldArrangement(
    state: Pick<GameState, "pendingMeldArrangements">,
    first: CardInstanceState,
    second: CardInstanceState,
    zone: CardZone,
    exilerId: string | undefined
): void {
    if (zone === "hand" || first.ownerId !== second.ownerId) return;
    state.pendingMeldArrangements = [
        ...(state.pendingMeldArrangements ?? []),
        {
            chooserId:
                zone === "exile"
                    ? (exilerId ?? first.controllerId)
                    : first.ownerId,
            zoneOwnerId: first.ownerId,
            zone,
            cardIds: [first.id, second.id],
        },
    ];
}

/** The SBA-sweep half of {@link queueMeldArrangement}: raise the front
 *  arrangement as a `meld-arrange` prompt — pick the card that goes on TOP
 *  (of two cards, that is the whole order). An arrangement whose cards are no
 *  longer both in the zone (a later move made one a new object, CR 400.7) is
 *  dropped unasked. Returns true when a prompt was raised (the caller
 *  suspends). Never stacks a prompt on another pending choice. */
export function raiseMeldArrangement(state: GameState): boolean {
    if ((state.pendingChoices?.length ?? 0) > 0) return false;
    const queue = state.pendingMeldArrangements ?? [];
    while (queue.length > 0) {
        const next = queue[0];
        const owner = state.players.find((p) => p.id === next.zoneOwnerId);
        const zone = owner?.[next.zone] ?? [];
        const present = next.cardIds.every((id) =>
            zone.some((c) => c.id === id)
        );
        if (!present) {
            queue.shift();
            continue;
        }
        state.pendingChoices = [
            {
                stackItemId: "", // SBA-level (no stack item)
                step: 0,
                choiceId: `meld-arrange-${next.cardIds.join("-")}`,
                playerId: next.chooserId,
                zoneOwnerId: next.zoneOwnerId,
                kind: "meld-arrange",
                zone: next.zone,
                count: 1,
                candidateIds: [...next.cardIds],
                prompt:
                    next.zone === "exile"
                        ? "Choose which card of the melded permanent was exiled last."
                        : `Choose which card of the melded permanent goes on top of the ${next.zone}.`,
            },
        ];
        state.pendingMeldArrangements = queue.length > 0 ? queue : undefined;
        state.priorityPlayerId = next.chooserId;
        return true;
    }
    state.pendingMeldArrangements = undefined;
    return false;
}

/** CR 712.21a / 712.21b — commit the head `meld-arrange` choice: `topId`
 *  goes directly above its partner (the end of the zone array is its top, and
 *  in exile the later timestamp). Pops the choice and its queue entry. */
export function applyMeldArrangement(state: GameState, topId: string): void {
    const head = state.pendingChoices?.[0];
    if (!head || head.kind !== "meld-arrange") return;
    const owner = state.players.find((p) => p.id === head.zoneOwnerId);
    const zone = head.zone as CardZone;
    if (owner && zone !== "hand") {
        const cards = owner[zone];
        const ids = head.candidateIds ?? [];
        const lower = ids.find((id) => id !== topId);
        const topIdx = cards.findIndex((c) => c.id === topId);
        const lowIdx = cards.findIndex((c) => c.id === lower);
        // A graveyard's top is the END of its array (cards are appended) and
        // exile's latest timestamp likewise; a LIBRARY's top is index 0
        // (draws take `library[0]`).
        const topIsLow = zone === "library";
        const misordered = topIsLow ? topIdx > lowIdx : topIdx < lowIdx;
        if (topIdx !== -1 && lowIdx !== -1 && misordered) {
            // Swap the two positions: the pair stays where it lies in the
            // zone, only its internal order changes.
            [cards[topIdx], cards[lowIdx]] = [cards[lowIdx], cards[topIdx]];
        }
    }
    state.pendingMeldArrangements = state.pendingMeldArrangements?.slice(1);
    if (state.pendingMeldArrangements?.length === 0) {
        state.pendingMeldArrangements = undefined;
    }
    const queue = state.pendingChoices!.slice(1);
    state.pendingChoices = queue.length > 0 ? queue : undefined;
}
