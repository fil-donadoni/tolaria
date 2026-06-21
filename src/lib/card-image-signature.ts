import type { CardInstance } from "~/types/game";

/** A live `CardInstance` or a bare `{ id }` placeholder (hand-back, library
 *  count, deck builder), the two shapes `CardImage` is rendered with. */
type CardLike = CardInstance | { id: string };

function isCardInstance(card: CardLike): card is CardInstance {
    return "controllerId" in card;
}

/** Definition id, regardless of which shape `card` is. */
export function getCardImageDefId(card: CardLike): string {
    return isCardInstance(card) ? card.card.id : card.id;
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

    // Layer-5 color override drives the "Color: …" badge.
    if (card.colorOverride) parts.push(`c:${card.colorOverride.join(",")}`);

    return parts.join("|");
}
