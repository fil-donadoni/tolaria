import { tryGetDefinition } from "@convex/cards";
import type { CardImageFace } from "@convex/cards/types";

export * from "./imageUrls";

/** Every id shape this engine SYNTHESIZES rather than taking from a printing.
 *  None of them is a Scryfall id, so none may ever reach a Scryfall URL.
 *
 *   - `token:Name|…` — a token's content-derived id (CR 111, 707.1).
 *   - an id containing `#` — an inset spell's twin (ADR 0120, `${printId}#kind`)
 *     and any future `${parent}#suffix` derivation. `#` is the URL FRAGMENT
 *     delimiter, so such an id does not merely 404: it truncates the URL,
 *     taking the file extension with it, and the request that leaves the
 *     browser is a directory path (issue #3321).
 *
 *  Matched by SHAPE, not by an enumerated list of prefixes, so the next
 *  synthetic id is covered on the day it is minted rather than on the day
 *  someone notices its art is missing. */
function isSyntheticCardId(cardId: string): boolean {
    return cardId.startsWith("token:") || cardId.includes("#");
}

/** Resolves the Scryfall id to use for fetching art for a given card id.
 *
 *  For printed cards: returns the same id (each printing has its own
 *  Scryfall id). For a SYNTHETIC id ({@link isSyntheticCardId}) — a token
 *  (CR 111, 707.1), an inset spell's twin (CR 715.2c) — returns the def's
 *  `imagePrintId` when one is declared (The Hive's Wasp from 10E; an
 *  adventurer card's own printing) and `null` otherwise so the caller can fall
 *  back to an in-app placeholder.
 *
 *  **Never returns a synthetic id itself.** That was already this function's
 *  stated contract, written against the `token:` form alone; the twin ids
 *  added by ADR 0120 are a second class, and the id-shaped test is what keeps
 *  the contract true for the third (issue #3321). */
export function resolveCardImageId(cardId: string): string | null {
    if (!isSyntheticCardId(cardId)) return cardId;
    const def = tryGetDefinition(cardId);
    const printId = def?.imagePrintId;
    // Fail closed: a definition whose own `imagePrintId` is itself synthetic
    // (a token whose art was pinned to another token) yields the placeholder
    // rather than a URL that cannot resolve.
    return printId && !isSyntheticCardId(printId) ? printId : null;
}

/** The Scryfall id whose `back/` CDN path serves the BACK face art of the
 *  double-faced card `frontId` (CR 712, issue #3552), for a preview of a card
 *  that has NOT turned that face up.
 *
 *  Never the modal twin's id: `${parentId}#back` is synthetic, and a real
 *  double-faced printing shares ONE Scryfall id across both faces, each served
 *  under its own `front/`/`back/` path. So this is the back face's own
 *  declared `imagePrintId` when it is a real id, else the front face's print
 *  id — the same precedence `modalBackTwinDefinition` (`cards/modalDfc.ts`)
 *  and `backFaceAsTokenSpec` (`cards/backFaceSpec.ts`) register the turned-up
 *  face with, so the preview and the transformed permanent show one art.
 *  Callers pair it with face `"back"`. */
export function resolveBackFaceImageId(frontId: string): string | null {
    const backPrintId = tryGetDefinition(frontId)?.backFace?.imagePrintId;
    if (backPrintId && !isSyntheticCardId(backPrintId)) return backPrintId;
    return resolveCardImageId(frontId);
}

/** Resolves which face's URL segment to request for `cardId` (issue #1595,
 *  CR 712). A transformed permanent's `card.card.id` is swapped by
 *  `transformPermanent` (`gre/transform.ts`) to a synthesized `CardDefinition`
 *  registered by `registerBackFaceDefinition`, which stamps
 *  `imagePrintFace: "back"` on it — so this is a pure lookup on the SAME
 *  `cardId` every `resolveCardImageId` caller already has, no
 *  `CardInstanceState` needed. Every other def (including one that simply
 *  hasn't transformed yet) has no `imagePrintFace` and resolves to the
 *  default `"front"`. */
export function resolveCardImageFace(cardId: string): CardImageFace {
    return tryGetDefinition(cardId)?.imagePrintFace ?? "front";
}
