/**
 * Face-down permanents (CR 708, ADR 0013).
 *
 * A face-down creature is a 2/2 colourless nameless vanilla creature with no
 * abilities (CR 708.2), regardless of the real card underneath. Rather than
 * gate every def-derived reader on a `faceDown` flag, we swap the instance's
 * `card.id` to the face-down sentinel definition (a registered 2/2 vanilla
 * creature) and set the stored characteristic fields to the vanilla values —
 * so colours, triggered/activated abilities, static effects and P/T all read
 * as the 2/2 automatically. The real id is retained in `faceDownOf` for the
 * turn-up (#124) and for the controller's own projected view.
 */

import { FACE_DOWN_CARD_ID, tryGetDefinition } from "../cards";
import { rebuildCopiableValuesAndReplayOverlays } from "./identitySwap";
import type { CardInstanceState } from "./state";

/** Turns a permanent face down in place (CR 708.2). No-op if already face
 *  down. The real definition id is preserved in `faceDownOf`. */
export function turnFaceDown(card: CardInstanceState): void {
    if (card.faceDown) return;
    card.faceDownOf = (card.card as { id?: string }).id;
    card.card = { id: FACE_DOWN_CARD_ID };
    card.faceDown = true;
    // CR 708.2a — the 2/2 vanilla values are the permanent's new COPIABLE
    // VALUES (layer 1). Turning face down is not a zone change (CR 400.7), so
    // the permanent's own layers 2–7 are replayed on top (issue #1705).
    rebuildCopiableValuesAndReplayOverlays(card, {
        types: ["Creature"],
        subtypes: [],
        power: 2,
        toughness: 2,
        staticAbilities: [],
    });
}

/** Turns a face-down permanent face up in place (CR 708.9, ADR 0013) — the
 *  inverse of {@link turnFaceDown}. Restores the real card id from `faceDownOf`
 *  and re-reads the real characteristics from the registry, then clears the
 *  face-down markers so the permanent reads (and projects) as its true self to
 *  both players. No-op if the card isn't face down or its real id is missing
 *  from the registry. */
export function turnFaceUp(card: CardInstanceState): void {
    if (!card.faceDown || !card.faceDownOf) return;
    const def = tryGetDefinition(card.faceDownOf);
    if (!def) return;
    card.card = { id: def.id };
    // Every array is COPIED, never aliased: `def.staticAbilities` is the
    // shared printed `CardDefinition` array, and handing it to the instance
    // would let any later in-place writer corrupt the catalogue globally.
    rebuildCopiableValuesAndReplayOverlays(card, {
        types: [...def.types],
        subtypes: [...(def.subtypes ?? [])],
        power: def.power,
        toughness: def.toughness,
        staticAbilities: [...(def.staticAbilities ?? [])],
    });
    delete card.faceDown;
    delete card.faceDownOf;
}
