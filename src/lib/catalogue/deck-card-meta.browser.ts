// Browser stand-in for `convex/cards` as `convex/formats.ts` imports it
// (`vite.config.ts` → `formats-cards-browser-seam`, issue #4854).
//
// `formats.ts` only reaches for `resolveDeckCardMeta` as the DEFAULT of
// `validateDeck`/`assertDeckLegal`'s `resolve` parameter. On the server that
// default is the whole catalogue; in a browser the catalogue is a lazy chunk,
// and a default that imported it would put every set module back in the entry
// graph of the login page and the lobby. A client caller owes its own
// resolver (`useDeckPrintResolver`), so reaching this one is a wiring bug,
// not a state to paper over.
import type { DeckCardMeta } from "@convex/cards/catalogue";

export function resolveDeckCardMeta(_cardId: string): DeckCardMeta | null {
    throw new Error(
        "validateDeck was called in the browser without a `resolve` argument — pass one (issue #4854)"
    );
}
