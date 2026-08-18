// `shuffleFromAnywhereReplacement` — declarative template for CR 614.1a's
// self-referential "If [this card] would be put into a graveyard from
// anywhere, ... shuffle it into its owner's library instead" clause (issue
// #2106; the shape Blightsteel Colossus, `sets/mbs/colorless.ts`, uses).
//
// This is a TRUE replacement effect ("would... instead", CR 614.1a): the
// object never occupies the graveyard, not even momentarily — no
// `CREATURE_DIED` (or `CARD_DISCARDED`/`CARD_MILLED`/`CARD_PUT_INTO_GRAVEYARD`)
// may fire for it, so an unrelated "whenever a creature dies" permanent
// (Soul Net, `sets/lea/colorless.ts`) never spuriously sees it. This is
// DISTINCT FROM a card worded "When [this] IS put into a graveyard from
// anywhere, shuffle it into its owner's library" (no "would"/"instead") —
// that phrasing (Worldspine Wurm `sets/rtr/green.ts`, Emrakul, the Aeons
// Torn `sets/roe/colorless.ts`) is a genuine CR 603 triggered ability: the
// object legitimately DOES die/enter the graveyard first (CR 700.4), so
// other permanents correctly observe that departure — modeling THOSE as a
// replacement would be a NEW divergence, not a fix. Verified against
// Scryfall's current oracle text for all three cards before this factory
// was written; do not reuse it for a card whose Oracle text lacks
// "would ... instead".
//
// Mechanism (`gre/replacements.ts`): `eventKind: "graveyard-bound"` +
// `appliesFromAnyZone: true` opts this INTO the zone-agnostic self-lookup
// `collectReplacements` runs for graveyard-bound events (in addition to its
// normal battlefield scan), so the effect is found and applied while the
// card is being milled from a library, discarded from a hand, or resolving
// off the stack — none of which has the source on a battlefield to carry a
// normal permanent-bound `replacementEffects[]` entry. `replace` only
// rewrites `event.destination` to `"library"`; the actual move + shuffle is
// performed by the CALLER (the `graveyardDestinationFor` chokepoint in
// `gre/state.ts`), exactly like the existing exile-redirect shape (Dauthi
// Voidwalker) — a replacement effect never moves cards itself.
//
// The "reveal" clause (CR 701.20a) on Blightsteel Colossus's own wording is
// NOT separately modeled: nothing in the card pool inspects whether this
// SPECIFIC card was revealed at this moment, and every zone this replacement
// can fire from (hand/library/battlefield/stack) is either already public or
// about to become so via the same redirect, so there is no
// externally-observable difference — an intentional simplification, not a
// deferred capability.
import type { ReplacementEffect } from "../types";

export function shuffleFromAnywhereReplacement(args: {
    id: string;
    oracleText: string;
}): ReplacementEffect {
    return {
        id: args.id,
        oracleText: args.oracleText,
        eventKind: "graveyard-bound",
        appliesFromAnyZone: true,
        appliesTo: (event, self) => {
            if (event.kind !== "graveyard-bound") return false;
            // Self-referential: the ONLY card this may ever apply to is the
            // exact instance carrying it (never a battlefield-wide scope
            // like "any opponent's card" — that shape stays permanent-bound,
            // e.g. Dauthi Voidwalker).
            return event.cardInstanceId === self.id;
        },
        replace: (event) => {
            if (event.kind !== "graveyard-bound") {
                throw new Error("unexpected event kind");
            }
            return {
                kind: "modified",
                event: { ...event, destination: "library" },
            };
        },
    };
}
