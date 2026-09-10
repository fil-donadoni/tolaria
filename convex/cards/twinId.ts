// The TWIN-ID vocabulary — the one namespace in which a `CardDefinition` that
// is HALF of a printed card is resolvable.
//
// Two rules mint such a definition, and they mint it for the same reason: the
// half is a real object with its own characteristics while it is on the stack,
// and CR says the printed card is still ONE card everywhere else.
//
//   * CR 715.2 / 722.2 — the inset spell (Adventure, prepare), ADR 0120,
//     `${parentId}#adventure` / `${parentId}#prepare`;
//   * CR 709.3b — a split card's chosen half ("while on the stack, only the
//     characteristics of the half being cast exist"), ADR 0121,
//     `${parentId}#left` / `${parentId}#right`.
//
// The vocabulary is shared rather than duplicated because its two CONSUMERS
// are shared: `tryGetPlaceableCardByName` (`catalogue.ts`) and the scenario
// builder (`gre/scenarioBuilder.ts`) both ask "is this id a printed card or a
// half?", and neither has any business asking which rule minted it. A second
// separator, or a second predicate keyed on one rule's suffixes, is how the
// scenario editor would have started offering "Deliver" as a placeable card.

/** Separator between a parent card's id and the suffix naming one of its
 *  halves. `#` is absent from every Scryfall UUID and from every print id, so
 *  a twin id can never collide with a real card's (asserted catalogue-wide by
 *  `insetSpell.test.ts` and `splitCard.test.ts`). */
export const TWIN_ID_SEPARATOR = "#";

/** The registry id of `parentId`'s half named `suffix`. Derived, stable, and
 *  the ONLY shape this engine mints — {@link parentIdOfTwin} is its inverse. */
export function twinDefinitionId(parentId: string, suffix: string): string {
    return `${parentId}${TWIN_ID_SEPARATOR}${suffix}`;
}

/** `true` when `cardId` names a HALF rather than a printed card — an inset
 *  spell's twin (CR 715.2) or a split card's half (CR 709.3b) alike. */
export function isTwinDefinitionId(cardId: string): boolean {
    return cardId.includes(TWIN_ID_SEPARATOR);
}

/** The id of the printed card a twin id belongs to — the identity the object
 *  reverts to the moment it stops being on the stack as that half (CR 715.4 /
 *  CR 709.4). `undefined` for an ordinary card id. */
export function parentIdOfTwin(cardId: string): string | undefined {
    const at = cardId.indexOf(TWIN_ID_SEPARATOR);
    return at <= 0 ? undefined : cardId.slice(0, at);
}
