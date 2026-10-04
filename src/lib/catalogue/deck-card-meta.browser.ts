// Browser stand-in for `convex/cards` as `convex/formats.ts` imports it
// (`vite.config.ts` → `formats-cards-browser-seam`, issue #4854).
//
// `formats.ts` reaches for `resolveDeckCardMeta` as the DEFAULT of
// `validateDeck`/`assertDeckLegal`'s `resolve` parameter, and the deck builder
// does lean on it while its own print resolver is still loading. On the server
// that default is the catalogue; in a browser the catalogue is a lazy chunk,
// and a default that imported it would put every set module back in the entry
// graph of the login page and the lobby. So the default is a late binding:
// `src/lib/catalogueArtifact.ts` — the module that only loads with the
// catalogue, i.e. before any gated surface renders — installs the real
// resolver here at module load.
import type { DeckCardMeta } from "@convex/cards/catalogue";

type DeckCardMetaResolver = (cardId: string) => DeckCardMeta | null;

let bound: DeckCardMetaResolver | null = null;

/** Installed once by `catalogueArtifact.ts` with the catalogue's resolver. */
export function bindDeckCardMetaResolver(resolver: DeckCardMetaResolver): void {
    bound = resolver;
}

/** Unbound = the catalogue has not loaded, so no card resolves: the same
 *  answer an unknown id gets, never a throw in the middle of a render. */
export function resolveDeckCardMeta(cardId: string): DeckCardMeta | null {
    return bound === null ? null : bound(cardId);
}
