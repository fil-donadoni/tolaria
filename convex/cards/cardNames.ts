// CR 709.4a / 715.5 / 722.5 — WHICH NAMES A CARD HAS, for the one question the
// rules ask about a name that is not "what is this object called": "choose a
// card name."
//
// Two rules print more than one name on a card, and they answer the same
// question differently in exactly one respect:
//
//   * CR 715.5 / 722.5 — an adventurer (or preparation) card: "if an effect
//     instructs a player to choose a card name and the player wants to choose
//     an adventurer card's ALTERNATIVE name, the player may do so." The
//     printed name and the inset name are BOTH choosable.
//   * CR 709.4a — a split card: "each split card has two names. If an effect
//     instructs a player to choose a card name and the player wants to choose
//     a split card's name, the player must choose one of those names and NOT
//     BOTH." The two half names are choosable; the combined string is not a
//     name anyone may choose, because it is not one of "those names".
//   * CR 712.19 — a double-faced card: "the player may choose the name of
//     either face of a double-faced card but not both." Same answer as the
//     adventurer card, reached from the other side: the card's own name IS its
//     front face's (CR 712.8a), so the back face adds the second entry and
//     nothing has to be excluded.
//
// One module rather than a clause in each half's own file, because the
// CONSUMERS are shared: the client's name-card candidate list, the server's
// submit gate (`pendingChoiceSubmit.ts`), and Meddling Mage's own match
// (`sets/pls/multicolor.ts`) must agree, and a server that accepts a name the
// button never offered is the exact bug PR #3302 review finding 4 shipped.

import type { CardDefinition } from "./types";
import { chooseableModalBackName } from "./modalDfc";
import { chooseableSplitNames } from "./splitCard";

/** CR 709.4a / 715.5 / 722.5 — every card name an effect may be GIVEN for
 *  `def`, in the order a candidate list should show them.
 *
 *  An ordinary card: its one name. An adventurer card: its printed name plus
 *  the inset half's. A split card: its two HALF names and NOT the combined
 *  string — 709.4a's "one of those names and not both" makes "Wax // Wane" a
 *  label for the card, never a name a player may choose. */
export function chooseableNamesOf(def: CardDefinition): string[] {
    const split = chooseableSplitNames(def);
    if (split) return split;
    if (def.insetSpell) return [def.name, def.insetSpell.name];
    // CR 712.19 — "the player may choose the name of either face of a
    // double-faced card but not both." The card's own name is its FRONT
    // face's (CR 712.8a), so `def.name` already IS one of the two and the
    // back face adds the second. Unlike CR 709.4a's split card, nothing is
    // excluded here: both entries are printed names of real faces.
    const modalBack = chooseableModalBackName(def);
    return modalBack ? [def.name, modalBack] : [def.name];
}

/** CR 709.4a — "an object has the chosen name if ONE of its names is the
 *  chosen name."
 *
 *  THE predicate every "did this object get named?" site reads — never
 *  `def.name === chosen`, which is false for both halves of a split card and
 *  for an Adventure. Case-sensitive, like every other name comparison in the
 *  engine: the choice is canonicalised against the catalogue before it is
 *  stored (`pendingChoiceSubmit.ts`). */
export function hasName(
    def: CardDefinition | undefined,
    chosen: string | undefined
): boolean {
    if (!def || chosen === undefined) return false;
    return chooseableNamesOf(def).includes(chosen);
}

/** CR 709.4a — {@link hasName} for a card INSTANCE rather than a definition:
 *  "an object has the chosen name if one of its names is the chosen name."
 *
 *  The `StaticEffectContext.hasChosenName` implementation, shared by the three
 *  contexts that build one (`cards/castRestrictions.ts`,
 *  `cards/attackRestrictions.ts`, `gre/layers.ts`) so a name-keyed restriction
 *  cannot disagree with a name-keyed static about what an object is called.
 *
 *  An EMBEDDED name (a synthesized token, a fixture card with no registry
 *  definition) answers for itself: it has exactly one name and no halves. */
export function objectHasChosenName(
    card: { card?: unknown },
    name: string,
    resolve: (cardId: string) => CardDefinition | null | undefined
): boolean {
    const cardId = (card.card as { id?: string } | undefined)?.id;
    const def = cardId ? resolve(cardId) : undefined;
    if (def) return chooseableNamesOf(def).includes(name);
    return ((card.card as { name?: string } | undefined)?.name ?? "") === name;
}
