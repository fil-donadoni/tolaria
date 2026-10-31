// CR 701.42 / 712.4 (ADR 0161) — the card-level half of meld: which cards
// are meld cards, which two form a pair, and the registered twin a melded
// permanent presents.
//
// A meld card is a flat `CardDefinition` (its FRONT face — CR 712.8a/712.8b
// leave only the front face's characteristics outside a melded permanent)
// carrying `backFace.kind: "meld"`: the pair's COMBINED back face, declared
// on BOTH halves. The declaration is the marker that says "I am a meld
// card", and it is a LAYOUT fact, never a copiable value — a token copy of
// The Mightstone and Weakstone takes the front face's characteristics
// (CR 707.2) and stays a token, which is exactly why CR 701.42b refuses to
// meld it.
//
// The twin is registered under `${parentId}#meld` for each half, through
// the ADR 0120 §2 seam (`preloadDefinitions`, `cards/registry.ts`) — never in
// `catalogue.ts`'s `allCards`, so deck legality, the Limited pool,
// `check:index` and `getAllCardNames` never see a third card (CR 712.4b:
// the back face is no card of its own). A melded permanent presents the twin
// of the half whose ability melded it; the two twins of one pair are
// identical by construction, since both halves declare the same face.

import type { CardDefinition, ManaCost } from "./types";
import { backFaceKind, backFaceTwinDefinition } from "./modalDfc";
import { parentIdOfTwin, twinDefinitionId } from "./twinId";

/** The twin-id suffix a meld pair's combined back face is registered under,
 *  in the shared twin namespace (`cards/twinId.ts`). */
export const MELD_BACK_FACE_SUFFIX = "meld";

/** CR 712.4 — `true` when `def` is a MELD card: its back face is half of a
 *  meld pair's combined back face. */
export function isMeldCard(def: CardDefinition | undefined): boolean {
    return def?.backFace !== undefined && backFaceKind(def.backFace) === "meld";
}

/** The registry id of the combined back face `parentId` melds into. */
export function meldResultDefinitionId(parentId: string): string {
    return twinDefinitionId(parentId, MELD_BACK_FACE_SUFFIX);
}

/** `true` when `cardId` is a meld twin id — the definition a melded
 *  permanent presents. */
export function isMeldResultDefinitionId(cardId: string): boolean {
    return meldResultParentId(cardId) !== undefined;
}

/** The inverse of {@link meldResultDefinitionId}: the front card's id when
 *  `cardId` is a meld twin id, `undefined` for any other id. */
export function meldResultParentId(cardId: string): string | undefined {
    const parent = parentIdOfTwin(cardId);
    return parent !== undefined && cardId === meldResultDefinitionId(parent)
        ? parent
        : undefined;
}

/** CR 712.8g — the twin definition a melded permanent presents: ONLY the
 *  combined back face's characteristics. Its printed `manaCost` is absent
 *  (a combined back face has none); the melded permanent's mana value is the
 *  sum of its front faces' (`meldedManaValueCost`), read off the instance's
 *  `meldedFrom`, so a COPY of it — which presents this twin without
 *  `meldedFrom` — has mana value 0. */
export function meldResultTwinDefinition(
    parent: CardDefinition
): CardDefinition | undefined {
    const back = parent.backFace;
    if (!back || backFaceKind(back) !== "meld") return undefined;
    const twin = backFaceTwinDefinition(
        parent,
        back,
        meldResultDefinitionId(parent.id)
    );
    delete twin.manaCost;
    // Scryfall publishes a combined back face as a card of its OWN (Urza,
    // Planeswalker has its own id and a single face), so the twin's art is
    // the FRONT image of the print `backFace.imagePrintId` names — never the
    // missing back face of a front card's print.
    delete twin.imagePrintFace;
    return twin;
}

/** CR 701.42b — `true` when the two definitions form ONE meld pair: two
 *  different meld cards whose declared combined back faces are the same
 *  face. Token-ness is the caller's half of the rule (an instance fact, not a
 *  definition one). */
export function formMeldPair(
    a: CardDefinition | undefined,
    b: CardDefinition | undefined
): boolean {
    if (!a || !b || a.id === b.id) return false;
    if (!isMeldCard(a) || !isMeldCard(b)) return false;
    return a.backFace!.name === b.backFace!.name;
}

/** CR 712.8g — "its mana value is the sum of the mana values of its front
 *  faces": the two front costs merged pip by pip, so `manaValue` (CR 202.3)
 *  of the result is the sum of theirs. Mana VALUE only — a melded permanent
 *  has no mana cost to pay. A front face's variable `{X}` marker counts 0
 *  off the stack (CR 202.3e) and is dropped. */
export function meldedManaValueCost(
    fronts: readonly (ManaCost | undefined)[]
): ManaCost {
    const out: ManaCost = {};
    const numeric = ["X", "W", "U", "B", "R", "G", "C", "generic"] as const;
    for (const cost of fronts) {
        if (!cost) continue;
        for (const key of numeric) {
            const v = cost[key];
            if (typeof v === "number")
                out[key] = ((out[key] as number) ?? 0) + v;
        }
        for (const [color, n] of Object.entries(cost.phyrexian ?? {})) {
            out.phyrexian ??= {};
            const c = color as keyof NonNullable<ManaCost["phyrexian"]>;
            out.phyrexian[c] = (out.phyrexian[c] ?? 0) + (n ?? 0);
        }
        if (cost.hybrid) out.hybrid = [...(out.hybrid ?? []), ...cost.hybrid];
        if (cost.hybridGeneric) {
            out.hybridGeneric = [
                ...(out.hybridGeneric ?? []),
                ...cost.hybridGeneric,
            ];
        }
    }
    return out;
}
