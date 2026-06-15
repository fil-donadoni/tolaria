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

import { FACE_DOWN_CARD_ID } from "../cards";
import type { CardInstanceState } from "./state";

/** Turns a permanent face down in place (CR 708.2). No-op if already face
 *  down. The real definition id is preserved in `faceDownOf`. */
export function turnFaceDown(card: CardInstanceState): void {
    if (card.faceDown) return;
    card.faceDownOf = (card.card as { id?: string }).id;
    card.card = { id: FACE_DOWN_CARD_ID };
    card.faceDown = true;
    card.types = ["Creature"];
    card.subtypes = [];
    card.power = 2;
    card.toughness = 2;
    card.staticAbilities = [];
}
