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
import type { ResolveCardMeta } from "./limited/eventLogic";

/** Resolves a drawn Booster card's Scryfall id to the canonical Card ID +
 *  display name a Pool entry carries (the `ResolveCardMeta` injection
 *  `generateSealedPools` / `generateRoundPacks` need).
 *
 *  Returns `null` — never throws, never a placeholder — for an id the registry
 *  cannot resolve. Every caller turns that `null` into the id itself
 *  (`meta?.cardId ?? scryfallId`), so an unresolvable card keeps a stable
 *  identity and stays visible in the Pool rather than disappearing from it.
 *  `printById` (`catalogue.ts`) aliases every printing into the registry, so a
 *  print-level Scryfall id resolves to its definition's canonical `cardId`,
 *  which is what a reprint's Pool entry must store. */
export const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};
