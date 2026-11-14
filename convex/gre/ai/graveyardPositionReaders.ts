// Graveyard-position readers (issue #9555) — the permanents a player controls
// whose text reads the TOP card of that player's graveyard, and so give the
// CR 404.3 arrangement of a graveyard batch a value the Bot can act on.
//
// The CLASS, never a card (ADR 0102): a reader is detected off the structured
// `fullText` field of its layer-1 definition (CR 612.6, `gre/fullText.ts`),
// never a name. Today that family is `from: "controller-graveyard-top"`; a
// second axis of readers (a "creature cards above it" count, a last-exiled
// reader) joins by widening `readTypesOf`, not by a registry row.
//
// `copiableDefId` is deliberate: a reader already presenting another card's
// text carries that card's id in `card.card.id`, and only the anchor still
// says it is a reader.

import type { CardType, FullTextEffect } from "../../cards/types";
import { declaresFullTextEffect, tryGetDefinition } from "../../cards";
import { copiableDefId } from "../fullText";
import type { CardInstanceState, GameState } from "../state";

/** The card types `effect` wants on top of its controller's graveyard. */
function readTypesOf(effect: FullTextEffect): CardType[] {
    return effect.from === "controller-graveyard-top"
        ? [effect.requiresType]
        : [];
}

/** The `fullText` effect `card` carries on its layer-1 text, if any (a
 *  face-down reader reads nothing, CR 708.2). */
function readerEffectOf(card: CardInstanceState): FullTextEffect | undefined {
    if (card.faceDown) return undefined;
    const layer1Id = copiableDefId(card);
    return declaresFullTextEffect(layer1Id)
        ? tryGetDefinition(layer1Id)?.fullText
        : undefined;
}

/** The card types the readers `playerId` controls want on top of
 *  `playerId`'s own graveyard. Empty when the player controls no reader —
 *  the gate every consumer tests first: with no reader the arrangement is
 *  not a decision (`graveyardOrderCandidates`, `choiceCandidates.ts`). */
export function graveyardTopReadTypes(
    state: GameState,
    playerId: string
): Set<CardType> {
    const out = new Set<CardType>();
    const player = state.players.find((p) => p.id === playerId);
    for (const card of player?.battlefield ?? []) {
        if (card.controllerId !== playerId) continue;
        const effect = readerEffectOf(card);
        if (!effect) continue;
        for (const type of readTypesOf(effect)) out.add(type);
    }
    return out;
}
