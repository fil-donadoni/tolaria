// Client-side card-registry adapters for the Draft Lab (issue #1612, ADR
// 0074, PRD #1607 slice 5).
//
// `draftEngine.ts`/`botDrafter.ts` are deliberately decoupled from the card
// registry — they take `ResolveCardMeta`/`GetCardEvalMeta` as INJECTED
// dependencies so the pure engine never touches it directly. Both adapters
// are built from the same pure primitives — `tryGetDefinition` /
// `resolveDeckCardMeta` (`convex/cards/index.ts`), `getCardColorIdentity`
// (`convex/cards/colors.ts`), `manaValue` (`convex/gre/constants.ts`) — all
// synchronous, in-memory, no Convex `ctx`, so they run identically in the
// browser.
//
// `resolveCardMeta` is now SHARED outright (`convex/limitedCardMeta.ts`,
// issue #2507) rather than copied; `getCardEvalMeta` is still a private
// closure in `convex/limitedEvents.ts` and therefore still mirrored below.
// Neither is a reimplementation of pack generation, passing, or scoring —
// those stay entirely inside the shared `draftEngine.ts`/`botDrafter.ts`
// modules this file's exports are injected into.
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
import type { GetCardEvalMeta } from "@convex/limited/botDrafter";

/** The server's `resolveCardMeta`, re-exported under the Lab's name.
 *
 *  It used to be a hand-copied twin of a private closure in
 *  `convex/limitedEvents.ts`. It stopped being safe to copy in issue #2507:
 *  the same lookup now also decides what a STORED `limitedSeats` card means
 *  (`convex/limitedSeatStore.ts` resolves `cardId`/`cardName` from the
 *  persisted `scryfallId`), so a divergence between the two copies would no
 *  longer be a Lab-only cosmetic drift. `convex/limitedCardMeta.ts` is pure
 *  and Convex-`ctx`-free, so the browser runs the identical function (ADR
 *  0074 — shared module, no shared authority). */
export { resolveCardMeta as draftLabResolveCardMeta } from "@convex/limitedCardMeta";

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
