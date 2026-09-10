// CR 712.12 — WHICH FACE a `play-land` action puts onto the battlefield.
//
// "A player playing a modal double-faced card or a copy of a modal
// double-faced card as a land chooses one of its faces that's a land before
// putting it onto the battlefield. It enters the battlefield with that face
// up."
//
// So the face is a CHOICE made before the object exists — the exact mirror of
// CR 712.11c on the cast side ("only the face that will be face up on the
// stack is evaluated to determine if it can be cast"), and the reason the
// `play-land` Move carries one. For the ten `land // land` pathways in the
// corpus it is a choice with two answers; for the fifty `spell // land` cards
// it is a choice with one; for every ordinary land in the catalogue there is
// no choice at all and no marker is carried (absent === `"front"`).
//
// Everything ELSE about the play is ordinary and lives where it always did:
// CR 116.2a's "put that land onto the battlefield from the zone it was in",
// CR 305.2's once per turn, the main phase of the player's own turn with an
// empty stack (`getLegalActions`, `gre/rules.ts`), and the settlement in
// `gre/playLand.ts`. The face is a PARAMETER on a path that exists, not a
// second path (ADR 0122 §2).

import { tryGetDefinition } from "../cards";
import {
    isModalDoubleFaced,
    modalBackFaceDefinitionId,
    PLAY_LAND_FACES,
    type PlayLandFace,
} from "../cards/modalDfc";
import type { CardDefinition } from "../cards/types";
import type { CardInstanceState } from "./state";

export { PLAY_LAND_FACES, type PlayLandFace };

/** The definition id an instance's `face` names — the parent's own id for the
 *  front face (CR 712.8a: the card in hand IS its front face), the registered
 *  twin's for the back (CR 712.8f). `undefined` when the instance carries no
 *  resolvable definition (a synthesized fixture card). */
export function playLandFaceDefinitionId(
    card: CardInstanceState,
    face: PlayLandFace
): string | undefined {
    const cardId = (card.card as { id?: string } | undefined)?.id;
    if (!cardId) return undefined;
    return face === "front" ? cardId : modalBackFaceDefinitionId(cardId);
}

/** The `CardDefinition` an instance's `face` names, or `undefined` when it
 *  resolves to nothing. */
export function playLandFaceDefinition(
    card: CardInstanceState,
    face: PlayLandFace
): CardDefinition | undefined {
    const id = playLandFaceDefinitionId(card, face);
    return id ? (tryGetDefinition(id) ?? undefined) : undefined;
}

/** CR 712.12 — every face of `card` that IS a land, in printed order, i.e.
 *  every face this card may be played as. Empty for a nonland card with no
 *  land face, which is what makes this the whole "may this be played?" type
 *  test at every offering surface.
 *
 *  The FRONT face is asked of the INSTANCE's `types` rather than the
 *  definition's, deliberately and unchanged from the code this replaced: a
 *  continuous effect that turns a nonland permanent card in hand into a land
 *  card, or strips the type off one, is a layer-4 answer the instance already
 *  carries. The BACK face is asked of the printed face: CR 712.8a leaves it
 *  outside the game everywhere the question is asked, so no continuous effect
 *  has ever applied to it. */
export function landPlayFaces(card: CardInstanceState): PlayLandFace[] {
    const faces: PlayLandFace[] = [];
    if (card.types.includes("Land")) faces.push("front");
    const cardId = (card.card as { id?: string } | undefined)?.id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (
        isModalDoubleFaced(def ?? undefined) &&
        def?.backFace?.types.includes("Land")
    ) {
        faces.push("back");
    }
    return faces;
}

/** `true` when `face` is one `card` may be played as right now — the
 *  fail-closed gate every commit path runs before applying a `play-land` whose
 *  face came off the wire. A client that names `"back"` on an ordinary Forest
 *  gets a refusal, not a Forest that enters as nothing. */
export function isPlayableLandFace(
    card: CardInstanceState,
    face: PlayLandFace
): boolean {
    return landPlayFaces(card).includes(face);
}
