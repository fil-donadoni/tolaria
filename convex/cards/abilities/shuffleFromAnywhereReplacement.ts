// `shuffleFromAnywhereReplacement` — declarative template for CR 614.1a's
// self-referential "If [this card] would be put into a graveyard from
// anywhere, ... shuffle it into its owner's library instead" clause (issue
// #2106; the shape Blightsteel Colossus, `sets/mbs/colorless.cards.ts`, uses).
//
// This is a TRUE replacement effect ("would... instead", CR 614.1a): the
// object never occupies the graveyard, not even momentarily — no
// `CREATURE_DIED` (or `CARD_DISCARDED`/`CARD_MILLED`/`CARD_PUT_INTO_GRAVEYARD`)
// may fire for it, so an unrelated "whenever a creature dies" permanent
// (Soul Net, `sets/lea/colorless.cards.ts`) never spuriously sees it. This is
// DISTINCT FROM a card worded "When [this] IS put into a graveyard from
// anywhere, shuffle it into its owner's library" (no "would"/"instead") —
// that phrasing (Worldspine Wurm `sets/rtr/green.cards.ts`, Emrakul, the Aeons
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
// The "reveal" clause (CR 701.20a) rides the rewritten event: `replace` also
// sets `revealed`, and `graveyardDestinationFor` raises the public reveal
// notification for every player, whatever the origin zone and whether or not a
// stack item is resolving.
import type { CardDefinition, ReplacementEffect } from "../types";

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
                event: { ...event, destination: "library", revealed: true },
            };
        },
    };
}

/** The clause as printed, with the card's own name (CR 201.5) where Oracle
 *  says "this card". The compiler accepts exactly this sentence, so the
 *  rebuilt text is the printed one. */
export function shuffleFromAnywhereOracleText(name: string): string {
    return `If ${name} would be put into a graveyard from anywhere, reveal ${name} and shuffle it into its owner's library instead.`;
}

/** `blightsteel-colossus-shuffle` — the id the hand-written catalogue gives
 *  the entry, derived from the name so a compiled card and its hand-written
 *  twin carry one id. */
export function shuffleFromAnywhereId(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${slug}-shuffle`;
}

/**
 * ADR 0054 seam — rebuild the Oracle compiler's JSON-pure
 * `CardDefinition.shuffleFromAnywhere` flag into the `replacementEffects[]`
 * entry above, and REMOVE the flag from the expanded definition, for the
 * reason `expandCompiledStatics` gives: the expanded definition is what every
 * engine read sees and what the gold harness compares against the
 * hand-written card, so a leftover flag would read as a compiler defect.
 */
export function expandShuffleFromAnywhere(
    base: CardDefinition
): CardDefinition {
    if (base.shuffleFromAnywhere !== true) return base;
    const id = shuffleFromAnywhereId(base.name);
    const existing = base.replacementEffects ?? [];
    const expanded: CardDefinition = {
        ...base,
        // Idempotence guard: a definition that already spells the entry out
        // by hand must not end up replacing the event twice.
        replacementEffects: existing.some((r) => r.id === id)
            ? existing
            : [
                  ...existing,
                  shuffleFromAnywhereReplacement({
                      id,
                      oracleText: shuffleFromAnywhereOracleText(base.name),
                  }),
              ],
    };
    delete expanded.shuffleFromAnywhere;
    return expanded;
}
