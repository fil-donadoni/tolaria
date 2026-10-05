// The ONE card-registry lookup the Limited/Draft stack performs on a stored
// card id, extracted here (issue #2507) because it now has TWO callers that
// must agree byte-for-byte:
//
//   - `convex/limitedEvents.ts` injects it into the pure engine
//     (`ResolveCardMeta`), which is how a Pool/pack entry got its `cardId` and
//     `cardName` in the first place;
//   - `convex/limitedSeatStore.ts` calls it on the way OUT of the database, to
//     rebuild those two fields from the `scryfallId` that is now the only card
//     identity `limitedSeats` persists.
//
// Both sides therefore run the SAME resolution, and the store's expansion
// reproduces the producer's output exactly — including its `null` case, which
// is the whole point of splitting this out rather than re-deriving it at the
// seam (see `expandPoolCard` there for the fallback expression the producers
// use verbatim).
import { tryGetDefinition } from "./cards/registry";
import { resolveDeckCardMeta } from "./cards/catalogue";
import type { ResolveCard } from "./formats";
import { getSheetPrintCardId } from "./limited/registry";
import type { ResolveCardMeta } from "./limited/eventLogic";

/** Resolves a drawn Booster card's Scryfall id to the canonical Card ID +
 *  display name a Pool entry carries (the `ResolveCardMeta` injection
 *  `generateSealedPools` / `generateRoundPacks` need).
 *
 *  Returns `null` — never throws, never a placeholder — for an id the registry
 *  cannot resolve. Every caller turns that `null` into the id itself
 *  (`meta?.cardId ?? scryfallId`), so an unresolvable card keeps a stable
 *  identity and stays visible in the Pool rather than disappearing from it.
 *  A Print ID is not in the registry (ADR 0140 §5): a printing resolves to its
 *  Card ID through the `cardPrints` rows, at the server boundary
 *  (`cards/printRows.ts`). What is resolved here without rows is a reprint on a
 *  checked-in sheet (`BoosterConfig.printCardIds`) — the client's Draft Lab has
 *  no table to read. */
export const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const cardId = getSheetPrintCardId(scryfallId) ?? scryfallId;
    const def = tryGetDefinition(cardId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(cardId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

/** `resolveDeckCardMeta` that also knows a checked-in sheet's reprints
 *  (`BoosterConfig.printCardIds`) — the fallback a Limited resolver built from
 *  `cardPrints` rows uses for an id the table has no row for (a deployment the
 *  sync has not reached), so a sheet's own reprint never reads as unknown. */
export const resolveSheetCardMeta: ResolveCard = (cardId) =>
    resolveDeckCardMeta(getSheetPrintCardId(cardId) ?? cardId);
