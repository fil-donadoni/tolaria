// Client-side card-registry adapters for the Draft Lab (issue #1612, ADR
// 0074, PRD #1607 slice 5).
//
// `draftEngine.ts`/`botDrafter.ts` are deliberately decoupled from the card
// registry — they take `ResolveCardMeta`/`GetCardEvalMeta` as INJECTED
// dependencies so the pure engine never touches it directly. The server's
// real instances are private closures inside `convex/limitedEvents.ts`
// (`resolveCardMeta`, `getCardEvalMeta`) built from the exact same primitives
// re-exported here: `tryGetDefinition`/`resolveDeckCardMeta`
// (`convex/cards/index.ts`), `getCardColorIdentity` (`convex/cards/colors.ts`)
// and `manaValue` (`convex/gre/constants.ts`) — all pure, synchronous,
// in-memory lookups with no Convex `ctx`, so they run identically in the
// browser. This file is the Lab's OWN copy of those two six-line adapters
// (the server's are not exported) — not a reimplementation of pack
// generation, passing, or scoring, which stay entirely inside the shared
// `draftEngine.ts`/`botDrafter.ts` modules this file's exports are injected
// into.
import { tryGetDefinition } from "@convex/cards";
import { resolveDeckCardMeta } from "@convex/cards/catalogue";
import {
    getCardColorIdentity,
    getPipCountsFromCost,
} from "@convex/cards/colors";
import {
    getDefinitionProducibleColors,
    manaValue,
} from "@convex/gre/constants";
import type { ResolveCardMeta } from "@convex/limited/eventLogic";
import type { GetCardEvalMeta } from "@convex/limited/botDrafter";

/** Mirrors `convex/limitedEvents.ts`'s private `resolveCardMeta` — resolves a
 *  drawn Booster/Cube card's Scryfall id to the canonical Card ID + display
 *  name a Pool entry carries. */
export const draftLabResolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

/** Mirrors `convex/limitedEvents.ts`'s private `getCardEvalMeta` — resolves a
 *  drawn card's Scryfall id to the printed characteristics the Pick Heuristic
 *  (`botDrafter.ts`) scores on. */
export const draftLabGetCardEvalMeta: GetCardEvalMeta = (scryfallId) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
    };
};
