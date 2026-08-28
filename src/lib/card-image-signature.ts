import { FACE_DOWN_CARD_ID } from "@convex/cards";
import {
    faceDownProducer,
    faceDownRealCardId,
    isFaceDownCard,
} from "~/lib/face-down";
import type { CardInstance } from "~/types/game";

/** A live `CardInstance` or a bare `{ id }` placeholder (hand-back, library
 *  count, deck builder), the two shapes `CardImage` is rendered with. */
type CardLike = CardInstance | { id: string };

function isCardInstance(card: CardLike): card is CardInstance {
    return "controllerId" in card;
}

/** Definition id whose ART the BOARD FACE renders, regardless of which shape
 *  `card` is.
 *
 *  A FACE-DOWN object resolves to the CR 708.2a sentinel for EVERY viewer, its
 *  controller included (issue #2904). It used to prefer `knownCardId`, which
 *  painted the controller's own morph with the real card's Scryfall art —
 *  visually identical to a face-up copy of the same creature, so its own
 *  controller could not tell the two apart on their own board. CR 708.5
 *  entitles that viewer to LOOK at the card, which is what the preview's
 *  second face is for (`faceDownRealCardId`); it does not make the board face
 *  state the identity.
 *
 *  Display-only; never repoint a rules computation at this function. */
export function getCardImageDefId(card: CardLike): string {
    if (!isCardInstance(card)) return card.id;
    if (isFaceDownCard(card)) return FACE_DOWN_CARD_ID;
    return card.card.id;
}

/**
 * Cheap, render-stable signature of every live-instance field the zoom preview
 * and its badges render (#447). `CardImage` is memoized and invoked thousands
 * of times per frame, so the comparator must NOT do a deep object compare — it
 * compares two of these strings instead. Any runtime mutation the preview shows
 * (granted/lost keywords for landwalk AND every other keyword, effective P/T,
 * counters, granted activated/triggered abilities, types/subtypes, color
 * override) changes the signature and re-renders; anything the preview ignores
 * (combat flags, summoning sickness, tap state) is intentionally excluded so
 * unrelated state churn doesn't repaint.
 *
 * Bare `{ id }` placeholders carry no instance state — their signature is just
 * the def id (they have no preview deltas to track).
 */
export function cardImageSignature(card: CardLike): string {
    const defId = getCardImageDefId(card);
    if (!isCardInstance(card)) return defId;

    const parts: string[] = [defId];

    // Face-down identity (issue #2904). `defId` above collapses EVERY
    // face-down object to the one sentinel, so without these two segments a
    // memoized CardImage handed a different face-down permanent — or the same
    // one after its producer changed — would compare equal and never
    // re-render, and the preview's second face would keep showing the previous
    // card. Both are display-only reads; neither reaches a rules computation.
    const realId = faceDownRealCardId(card);
    if (realId) parts.push(`fd:${realId}`);
    const producer = faceDownProducer(card);
    if (producer) parts.push(`fdby:${producer}`);

    // Keyword grants/losses (landwalk and every other keyword): the resolved
    // `staticAbilities` array already reflects both, so it covers the diff
    // getDisplayAbilities computes against the def.
    parts.push((card.staticAbilities ?? []).join(","));

    // Effective P/T inputs — base P/T, counters, and one-shot mods. The preview
    // computes effective P/T from these, so any change must invalidate.
    parts.push(`${card.power ?? ""}/${card.toughness ?? ""}`);
    const counters = card.counters;
    if (counters) {
        const keys = Object.keys(counters).sort();
        parts.push(keys.map((k) => `${k}:${counters[k]}`).join(","));
    }
    const tmods = card.temporaryPTMods;
    if (tmods && tmods.length > 0) {
        parts.push(tmods.map((m) => `${m.power}/${m.toughness}`).join(";"));
    }

    // Type/subtype changes (layer 4 / text-changing) shift the type line.
    parts.push((card.types ?? []).join(","));
    parts.push((card.subtypes ?? []).join(","));

    // Granted activated / triggered abilities (CR 113.1) render their own rows.
    const ga = card.grantedActivatedAbilities;
    if (ga && ga.length > 0) {
        parts.push(ga.map((g) => `${g.sourceCardId}#${g.abilityId}`).join(";"));
    }
    const gt = card.grantedTriggeredAbilities;
    if (gt && gt.length > 0) {
        parts.push(gt.map((g) => `${g.sourceCardId}#${g.abilityId}`).join(";"));
    }

    // Layer-5 colour drives the "Color: …" badge and the overlay. Both shapes
    // count: the SET (`colorOverride`) and the GRANT (`grantedColors`, Dralnu's
    // Crusade) — omitting the grant leaves a stale overlay when the granting
    // permanent enters or leaves.
    if (card.colorOverride) parts.push(`c:${card.colorOverride.join(",")}`);
    if (card.grantedColors?.length) {
        parts.push(`gc:${card.grantedColors.map((g) => g.color).join(",")}`);
    }

    return parts.join("|");
}
