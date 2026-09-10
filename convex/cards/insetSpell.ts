// CR 715 / 722 — the INSET SPELL, as a registered TWIN `CardDefinition`
// (ADR 0120).
//
// An adventurer card prints two sets of characteristics, and CR 715.4 is what
// makes that cheap to model: "in every zone except the stack, and while on the
// stack not as an Adventure, an adventurer card has only its NORMAL
// characteristics." No zone ever shows two faces at once, so nothing that
// reads a hand, a graveyard, a library or a battlefield learns anything new —
// this is not layout work, and there is no `faces[]` schema.
//
// What DOES need an object is the half itself: the spell on the stack while it
// is an Adventure (CR 715.3b — "the spell has only its alternative
// characteristics"), and CR 722.3c's exiled copy, "which has only the
// characteristics of that permanent's prepare spell" as its NORMAL ones. Both
// are definitions. So the half is built into a real `CardDefinition` under the
// derived id `${parentId}#${kind}` and registered in the id-resolvable registry
// Map (`registry.ts`) that tokens and transform back faces already live in —
// and NOT in `catalogue.ts`'s enumerable `allCards`, which deck legality, the
// Limited pool and the card index read. Resolvable everywhere; invisible to
// every enumerator (CR 715.2c — one card is one card).
//
// The rejected alternative — a nested half read through at ~20 sites (`if it is
// an Adventure, read def.insetSpell instead`) — is recorded in ADR 0120 §2:
// every one of those conditionals fails OPEN when forgotten, which is the
// recurring bug class `.claude/rules/gre-development.md` § Frontend wiring
// analysis names.
//
// Unlike `registerBackFaceDefinition`, whose `tokenDefinitionId` ENCODES its
// spec into the id, this id is a plain derivation: client and server import
// this same module, so both resolve the twin's name, cost and art from the
// parent's own definition with no codec — which an `EffectOp[]` could not pass
// through anyway.

import type { CardDefinition, InsetSpellKind } from "./types";

/** Separator between a parent card's id and its inset spell's kind. `#` is
 *  absent from every Scryfall UUID and from every print id, so a twin id can
 *  never collide with a real card's (asserted catalogue-wide by
 *  `insetSpell.test.ts`). */
export const INSET_SPELL_ID_SEPARATOR = "#";

/** Per-kind facts the rest of the engine keys on. `Record<InsetSpellKind, …>`
 *  is the guard ADR 0120 §1 asks for: a second kind cannot be added to the
 *  union without answering, here, whether the PARENT offers a cast option for
 *  it — CR 715.3 says yes for an Adventure, CR 722.3 says never for a prepare
 *  spell. A surface that asks "may this be cast?" reads this table rather than
 *  string-matching the kind. */
export const INSET_SPELL_KINDS: Record<
    InsetSpellKind,
    {
        /** CR 715.3 vs CR 722.3 — whether playing the parent card offers the
         *  choice of casting the inset half. */
        castableFromParent: boolean;
    }
> = {
    adventure: { castableFromParent: true },
    prepare: { castableFromParent: false },
};

/** The registry id of `parentId`'s inset spell of `kind`. Derived, stable, and
 *  the ONLY shape this engine mints — `parentIdOfInsetSpell` is its inverse. */
export function insetSpellDefinitionId(
    parentId: string,
    kind: InsetSpellKind
): string {
    return `${parentId}${INSET_SPELL_ID_SEPARATOR}${kind}`;
}

/** `true` when `cardId` names a twin rather than a printed card. */
export function isInsetSpellDefinitionId(cardId: string): boolean {
    return cardId.includes(INSET_SPELL_ID_SEPARATOR);
}

/** CR 715.4 — the id of the card a twin id belongs to, i.e. the identity the
 *  object reverts to the moment it stops being on the stack as an Adventure.
 *  `undefined` for an ordinary card id. */
export function parentIdOfInsetSpell(cardId: string): string | undefined {
    const at = cardId.indexOf(INSET_SPELL_ID_SEPARATOR);
    return at <= 0 ? undefined : cardId.slice(0, at);
}

/** The twin `CardDefinition` for `parent`'s inset spell, or `undefined` when
 *  the card has none.
 *
 *  Pure and cheap: `preloadDefinitions` calls it once per catalogue card at
 *  hydration, and nothing calls it on a hot path — every later reader resolves
 *  the twin through `tryGetDefinition` like any other card.
 *
 *  What the twin does NOT inherit is as load-bearing as what it does. CR 715.3b
 *  — "while on the stack as an Adventure, the spell has only its ALTERNATIVE
 *  characteristics" — so the parent's keywords, statics, triggers, activated
 *  abilities, P/T and alternative costs are all absent by construction: the
 *  twin is built from the inset record alone. It carries the parent's `rarity`
 *  and `imagePrintId` because neither is a characteristic (CR 206.1 / 111.1) —
 *  they are the print's, and the print is one card. */
export function insetSpellTwinDefinition(
    parent: CardDefinition
): CardDefinition | undefined {
    const inset = parent.insetSpell;
    if (!inset) return undefined;
    return {
        id: insetSpellDefinitionId(parent.id, inset.kind),
        name: inset.name,
        rarity: parent.rarity,
        types: [...inset.types],
        ...(inset.subtypes ? { subtypes: [...inset.subtypes] } : {}),
        ...(inset.manaCost ? { manaCost: inset.manaCost } : {}),
        oracleText: inset.oracleText,
        ...(inset.effects ? { effects: inset.effects } : {}),
        ...(inset.targetRequirement
            ? { targetRequirement: inset.targetRequirement }
            : {}),
        // CR 715.2c / 111.1 — one card is one card, and one card is one
        // PRINTING: the inset half has no illustration of its own, so its art
        // is the adventurer card's. `?? parent.id` is the load-bearing half —
        // a hand-written card's `id` IS its home printing's Scryfall id and
        // almost none of them declare `imagePrintId`, so copying that field
        // alone left the twin with NO art id at all. It then fell through to
        // the "the id is the print id" path, where the twin's own `#`-bearing
        // id reached the Scryfall URL builder and truncated it at the fragment
        // delimiter into a 404 (issue #3321).
        imagePrintId: parent.imagePrintId ?? parent.id,
    };
}

/** CR 715.3 vs CR 722.3 — the inset kind `def` declares, but ONLY when the
 *  parent may cast it. `undefined` for a card with no inset spell and for one
 *  whose kind can never be cast from the parent (a prepare spell, CR 722.3).
 *
 *  THE castability authority, and the reason {@link INSET_SPELL_KINDS} is a
 *  `Record` rather than prose: every surface that offers or accepts an inset
 *  cast reaches the table through this, so a kind added to the union cannot
 *  reach a cast path without a row saying whether it may. It was possible to
 *  add one and have every cast site keep working off a literal
 *  `kind === "adventure"` check — the drift this module's header claims to
 *  prevent (PR #3302 review finding 6). */
export function castableInsetKind(
    def: CardDefinition | undefined
): InsetSpellKind | undefined {
    const kind = def?.insetSpell?.kind;
    if (kind === undefined) return undefined;
    return INSET_SPELL_KINDS[kind].castableFromParent ? kind : undefined;
}

/** CR 715.2a — "if an effect refers to a card, spell, or permanent that 'has an
 *  Adventure', it refers to an object that has the alternative characteristics
 *  of an Adventure spell, EVEN IF the object currently doesn't use them."
 *
 *  So this is a question about the CARD, answered off the printed declaration,
 *  and it stays true for a Brazen Borrower sitting in a graveyard as a plain
 *  3/1 Faerie.
 *
 *  A question about the KIND, deliberately NOT routed through
 *  {@link castableInsetKind}: 715.2a is about what the object HAS, and stays
 *  true for a half that could never be cast from the parent at all. Castability
 *  is the other predicate's job. */
export function hasAdventure(def: CardDefinition | undefined): boolean {
    return def?.insetSpell?.kind === "adventure";
}

/** CR 715.5 — every card name an effect may be given for `def`: its own, plus
 *  its inset spell's when it has one ("if an effect instructs a player to
 *  choose a card name and the player wants to choose an adventurer card's
 *  alternative name, the player may do so").
 *
 *  Both kinds, deliberately: CR 722.5 is CR 715.5 verbatim, so this is not
 *  gated on `castableFromParent`. */
export function chooseableCardNames(def: CardDefinition): string[] {
    return def.insetSpell ? [def.name, def.insetSpell.name] : [def.name];
}
