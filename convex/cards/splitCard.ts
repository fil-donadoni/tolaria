// CR 709 — the SPLIT CARD, as ONE definition whose combined characteristics are
// DERIVED and whose two halves are registered TWINS (ADR 0121).
//
// CR 709.4: "in every zone except the stack, the characteristics of a split
// card are those of its two halves COMBINED." So the combination is a FUNCTION
// of the halves, and the whole design follows from refusing to hand-author it:
//
//   * the definition's `name`, `manaCost` and `types` come from
//     `defineSplitCard` and nowhere else, so a card whose author typed a wrong
//     summed cost cannot exist (`cardDataConformance.test.ts` re-derives every
//     shipped split card and compares);
//   * 755 files name `CardDefinition` and every one of them keeps reading a
//     FLAT definition with one name, one cost, one type list — deck legality,
//     the Limited pool, `check:index`, the card-index lockfile, tutors and the
//     Bot's valuation are untouched, because 709.4 is satisfied by
//     construction rather than by a conditional at each reader (ADR 0121 §1).
//
// CR 709.3b — "while on the stack, only the characteristics of the half being
// cast exist" — is the other half of the design, and it is ADR 0120's twin
// mechanism unchanged: each half is a real `CardDefinition` under
// `${parentId}#left` / `${parentId}#right`, registered in the id-resolvable
// registry (`registry.ts`) and NEVER in `catalogue.ts`'s enumerable `allCards`
// (CR 709.2 — "each split card is only one card").
//
// What split does NOT share with Adventure: an adventurer card offers a normal
// cast AND an inset one, whereas CR 709.3 has the half chosen BEFORE the card
// is put onto the stack — so a split card offers two half options and no
// printed cast at all. That is `offersPrintedCast` below, read by every
// offering surface.

import type { CardDefinition, CardType, ManaCost, SplitHalf } from "./types";
import { isTwinDefinitionId, parentIdOfTwin, twinDefinitionId } from "./twinId";

/** Printed left, printed right — the order CR 709 speaks in, and the order the
 *  combined name is built in ("Wax // Wane", never "Wane // Wax"). */
export const SPLIT_HALF_SIDES = ["left", "right"] as const;
export type SplitHalfSide = (typeof SPLIT_HALF_SIDES)[number];

/** CR 709.4a — the separator Wizards prints and Scryfall records between a
 *  split card's two names. Shared with the corpus, so a combined name derived
 *  here matches the one the Oracle pipeline reads. */
export const SPLIT_NAME_SEPARATOR = " // ";

/** `true` when `def` is a split card — i.e. when its top-level characteristics
 *  are a CR 709.4 combination rather than something printed.
 *
 *  THE predicate every surface asks, and the reason it exists rather than each
 *  site testing `def.splitHalves !== undefined`: the question "is this card's
 *  name a combination?" has consequences at the name-choice seam (709.4a), at
 *  the cast-option list (709.3) and in the compiler, and one named predicate is
 *  what keeps those three agreeing. */
export function isSplitCard(def: CardDefinition | undefined): boolean {
    return def?.splitHalves !== undefined;
}

/** CR 709.3 — whether playing `def` offers a cast of the PRINTED card.
 *
 *  False for exactly one shape: a split card, because "a player chooses which
 *  half of a split card they are casting BEFORE putting it onto the stack" —
 *  there is no cast that ever puts the combined object there, and 709.4b's
 *  summed cost is a characteristic of the card in a zone, never a price anyone
 *  pays. True for every other card, including an adventurer card (CR 715.3
 *  offers the normal cast alongside the Adventure).
 *
 *  Read by every surface that offers or accepts a printed cast — the "cast"
 *  legality gate (`gre/rules.ts`), the cast-option list, `announceCast`
 *  (`game.ts`), `enumerateCastMoves` (`gre/moves.ts`) and the client picker.
 *  A surface that skipped it would offer a cast for {G}{W} that resolves to
 *  neither half. */
export function offersPrintedCast(def: CardDefinition | undefined): boolean {
    return !isSplitCard(def);
}

/** The registry id of `parentId`'s `side` half. */
export function splitHalfDefinitionId(
    parentId: string,
    side: SplitHalfSide
): string {
    return twinDefinitionId(parentId, side);
}

/** The side a twin id names, or `undefined` when `cardId` is not a split half's
 *  id. Keyed on the SUFFIX alone, so an inset spell's `#adventure` answers
 *  `undefined` — the two rules share the namespace, never the vocabulary. */
export function splitSideOfDefinitionId(
    cardId: string
): SplitHalfSide | undefined {
    if (!isTwinDefinitionId(cardId)) return undefined;
    const parent = parentIdOfTwin(cardId);
    if (parent === undefined) return undefined;
    const suffix = cardId.slice(parent.length + 1);
    return SPLIT_HALF_SIDES.find((s) => s === suffix);
}

/** CR 709.4b — "the mana cost of a split card is the combined mana costs of its
 *  two halves. A split card's colours and mana value are determined from its
 *  combined mana cost."
 *
 *  Addition, because `ManaCost` is counts per colour plus `generic`
 *  (`types.ts`): Stand `{W}` + Deliver `{2}{U}` = `{2}{W}{U}`, a white and blue
 *  card with mana value 4. Phyrexian pips and guild-hybrid pips concatenate,
 *  for the same reason — each entry is one printed symbol and the combined cost
 *  has both halves' symbols.
 *
 *  709.4b's third sentence — "an effect that refers specifically to the SYMBOLS
 *  in a split card's mana cost sees the separate symbols rather than the whole
 *  mana cost" (the Jegantha example: Fire // Ice contains `{1}` twice, not
 *  `{2}`) — is the one clause a summed record cannot answer, and it needs no
 *  new field: the halves stay declared on the definition, so a symbol-level
 *  reader reads `splitHalves`. Nothing in the shipped pool asks today.
 *
 *  A VARIABLE `{X}` (CR 107.3) is carried, never summed: a cost has one
 *  announced X, so a card printing a variable `{X}` on BOTH halves would need
 *  a rule this engine has no reading for, and it throws rather than inventing
 *  one. No printed split card does (measured against the vendored corpus: 6 of
 *  the 84 admitted have an `{X}` half, all of them on ONE side). */
export function combineSplitManaCosts(
    left: ManaCost | undefined,
    right: ManaCost | undefined
): ManaCost | undefined {
    if (!left && !right) return undefined;
    const a = left ?? {};
    const b = right ?? {};
    const combined: ManaCost = {};
    for (const key of ["W", "U", "B", "R", "G", "C"] as const) {
        const sum = (a[key] ?? 0) + (b[key] ?? 0);
        if (sum > 0) combined[key] = sum;
    }
    // `X` DOUBLES as the generic slot when it is a number (`types.ts`), so
    // generic mana arrives in two fields and both are summed: Fire `{1}{R}`
    // (`{ X: 1, R: 1 }`) + Ice `{1}{U}` = `{2}{U}{R}`. Reading only `generic`
    // here would have combined those two into `{U}{R}`.
    const numericGeneric =
        (typeof a.X === "number" ? a.X : 0) +
        (typeof b.X === "number" ? b.X : 0) +
        (a.generic ?? 0) +
        (b.generic ?? 0);
    const variable = [a, b].filter((c) => typeof c.X === "string");
    if (variable.length > 1) {
        throw new Error(
            "combineSplitManaCosts: both halves declare a variable {X} — CR 709.4b has no reading for two announced values"
        );
    }
    if (variable.length === 1) {
        combined.X = variable[0].X;
        if (variable[0].xFactor !== undefined) {
            combined.xFactor = variable[0].xFactor;
        }
        if (numericGeneric > 0) combined.generic = numericGeneric;
    } else if (numericGeneric > 0) {
        combined.X = numericGeneric;
    }
    const phyrexian: Record<string, number> = {};
    for (const source of [a.phyrexian, b.phyrexian]) {
        for (const [color, count] of Object.entries(source ?? {})) {
            phyrexian[color] = (phyrexian[color] ?? 0) + (count ?? 0);
        }
    }
    if (Object.keys(phyrexian).length > 0) {
        combined.phyrexian = phyrexian as ManaCost["phyrexian"];
    }
    const hybrid = [...(a.hybrid ?? []), ...(b.hybrid ?? [])];
    if (hybrid.length > 0) combined.hybrid = hybrid;
    return combined;
}

/** CR 709.4a — "each split card has two names", printed left then right and
 *  joined by the separator Wizards prints. */
export function combineSplitNames(
    halves: readonly [SplitHalf, SplitHalf]
): string {
    return `${halves[0].name}${SPLIT_NAME_SEPARATOR}${halves[1].name}`;
}

/** CR 709.4c — "a split card has each card type specified on either of its
 *  halves". A union, in left-then-right declaration order and deduplicated:
 *  Life // Death is an Instant AND a Sorcery, Wax // Wane is just an Instant. */
export function combineSplitTypes(
    halves: readonly [SplitHalf, SplitHalf]
): CardType[] {
    return [...new Set([...halves[0].types, ...halves[1].types])];
}

/** THE authoring seam for a split card: everything a `CardDefinition` normally
 *  declares, minus the three fields CR 709.4 says are a FUNCTION of the halves.
 *
 *  A set file exports `defineSplitCard({...})`'s result and never types a
 *  combined name, a summed cost or a merged type line — an authored combination
 *  can disagree with the rule in a way nothing detects, the same argument that
 *  keeps morph's `{3}` out of card data (ADR 0120 §3). The Oracle compiler's
 *  lowering calls this same function, so Guard C round-trips THROUGH the
 *  derivation rather than around it (ADR 0121 §5). */
export function defineSplitCard(
    spec: Omit<
        CardDefinition,
        "name" | "manaCost" | "types" | "splitHalves"
    > & {
        halves: readonly [SplitHalf, SplitHalf];
    }
): CardDefinition {
    const { halves, ...rest } = spec;
    return { ...rest, ...deriveSplitCombination(halves) };
}

/** THE derivation, as a spreadable record: the three fields CR 709.4 makes a
 *  function of the halves, plus the halves themselves.
 *
 *  Split out of {@link defineSplitCard} so the Oracle compiler's lowering can
 *  reach it too. `CompiledDefinition` (`oracle/types.ts`) is `CardDefinition`
 *  minus `id`, `rarity` and every closure field, so the compiler cannot call
 *  the authoring helper — and a second copy of the combination in the lowering
 *  is exactly what would let Guard C round-trip AROUND the derivation rather
 *  than through it (ADR 0121 §5). */
export function deriveSplitCombination(
    halves: readonly [SplitHalf, SplitHalf]
): Pick<CardDefinition, "name" | "types" | "splitHalves"> & {
    manaCost?: ManaCost;
} {
    const manaCost = combineSplitManaCosts(
        halves[0].manaCost,
        halves[1].manaCost
    );
    return {
        name: combineSplitNames(halves),
        ...(manaCost ? { manaCost } : {}),
        types: combineSplitTypes(halves),
        splitHalves: halves,
    };
}

/** CR 709.3b — the twin `CardDefinition` for one half, or `undefined` when
 *  `parent` is not a split card.
 *
 *  Built from the half's record ALONE: "while on the stack, only the
 *  characteristics of the half being cast exist. The other half's
 *  characteristics are treated as though they didn't exist." So the parent's
 *  combined name, combined cost and combined type line are all absent by
 *  construction — casting Deliver puts a `{2}{U}` Instant named "Deliver" on
 *  the stack, not a `{2}{W}{U}` anything.
 *
 *  It carries the parent's `rarity` and `imagePrintId` because neither is a
 *  characteristic (CR 206.1 / 111.1) — they are the PRINT's, and one split card
 *  is one printing with one illustration. `?? parent.id` is load-bearing: a
 *  hand-written card's `id` IS its home printing's Scryfall id, and without the
 *  fallback the twin's own `#`-bearing id reaches the Scryfall URL builder and
 *  truncates at the fragment delimiter into a 404 (issue #3321, the same trap
 *  the inset twin fell into). */
export function splitHalfTwinDefinition(
    parent: CardDefinition,
    side: SplitHalfSide
): CardDefinition | undefined {
    const half = parent.splitHalves?.[side === "left" ? 0 : 1];
    if (!half) return undefined;
    return {
        id: splitHalfDefinitionId(parent.id, side),
        name: half.name,
        rarity: parent.rarity,
        types: [...half.types],
        ...(half.subtypes ? { subtypes: [...half.subtypes] } : {}),
        ...(half.manaCost ? { manaCost: half.manaCost } : {}),
        oracleText: half.oracleText,
        ...(half.effects ? { effects: half.effects } : {}),
        ...(half.targetRequirement
            ? { targetRequirement: half.targetRequirement }
            : {}),
        imagePrintId: parent.imagePrintId ?? parent.id,
    };
}

/** CR 709.4a — every card name a player may CHOOSE for `def`.
 *
 *  "If an effect instructs a player to choose a card name and the player wants
 *  to choose a split card's name, the player must choose ONE of those names and
 *  NOT BOTH." So a split card contributes its two HALF names and never the
 *  combined string — which is the one place where this differs from CR 715.5's
 *  adventurer card, whose printed name is a real name a player may choose.
 *
 *  Union with the inset half's names, so a single predicate serves both rules
 *  ({@link hasName}). */
export function chooseableSplitNames(
    def: CardDefinition
): string[] | undefined {
    const halves = def.splitHalves;
    if (!halves) return undefined;
    return [halves[0].name, halves[1].name];
}
