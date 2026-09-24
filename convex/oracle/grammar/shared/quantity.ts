/**
 * Shared sub-grammar: QUANTITY — "a", "two", "X", "for each Goblin you
 * control" (CR 107.1, CR 107.3).
 *
 * ── Why a count is its own sub-grammar ─────────────────────────────────────
 *
 * "For each" collapsed to a constant is one of the competitor's named misparse
 * shapes: the card still does something, and what it does is wrong by a factor
 * of the board. A quantity is therefore a computed expression in the IR or the
 * card does not compile — there is no branch here that turns an unrecognised
 * count phrase into 1.
 *
 * The same three phrases appear at every effect site there is ("Draw two
 * cards", "deals 3 damage", "You gain 2 life", "Sacrifice two creatures",
 * "Remove two carrion counters"), which is why this parses a bare count phrase
 * rather than one site's wrapper. `forEachRule` is the multiplier SUFFIX as its
 * own span, because English puts the noun between the two ("draw a card for
 * each Forest you control") and a rule that tried to span both would have to
 * know the noun.
 */

import { fail, ok, rule, type Rule, subGrammar } from "../../rule";
import type { PlayerRefIR } from "./playerRef";
import { descriptorRule, type DescriptorIR } from "./targetFilter";

export const QUANTITY = "quantity";

export type QuantityIR =
    /** A printed cardinal — "a", "one", "two", "3". */
    | { readonly kind: "fixed"; readonly value: number }
    /** CR 107.3 — the announced value of {X}. */
    | { readonly kind: "x" }
    /** CR 107.1 — "for each <descriptor>", a count of matching objects. */
    | { readonly kind: "for-each"; readonly per: DescriptorIR };

/**
 * CR 107.1 — number words Magic prints. Bounded on purpose: Oracle text spells
 * out small numbers and digits everything else, so a word past "twenty" is a
 * phrase we have misread rather than a number we forgot.
 */
const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
    ["a", 1],
    ["an", 1],
    ["one", 1],
    ["two", 2],
    ["three", 3],
    ["four", 4],
    ["five", 5],
    ["six", 6],
    ["seven", 7],
    ["eight", 8],
    ["nine", 9],
    ["ten", 10],
    ["eleven", 11],
    ["twelve", 12],
    ["thirteen", 13],
    ["fourteen", 14],
    ["fifteen", 15],
    ["sixteen", 16],
    ["seventeen", 17],
    ["eighteen", 18],
    ["nineteen", 19],
    ["twenty", 20],
]);

/** Exposed so a caller that has already split the phrase can reuse the table. */
export function readNumberWord(word: string): number | null {
    const spelled = NUMBER_WORDS.get(word.toLowerCase());
    if (spelled !== undefined) return spelled;
    // A printed digit run. Bounded so a stray year or id cannot become a count.
    return /^\d{1,3}$/.test(word) ? Number(word) : null;
}

/** `"for each <descriptor>"` — the multiplier suffix (CR 107.1). */
export const forEachRule: Rule<QuantityIR> = rule("for-each", (span, ctx) => {
    if (!span.startsWith("for each "))
        return fail('not a "for each" phrase', span);
    const descriptor = descriptorRule.run(span.slice("for each ".length), ctx);
    if (!descriptor.ok) return descriptor;
    if (descriptor.value.plural === true)
        return fail('"for each" counts a singular descriptor', span);
    return ok({ kind: "for-each" as const, per: descriptor.value });
});

/**
 * A whole count phrase: a cardinal, `X`, or a "for each" clause.
 *
 * Note there is no "any number of" and no "up to" here — both change the
 * ARITY of the effect (a player choice), not only its magnitude, and folding
 * them into a count would hide the choice.
 */
export const quantityRule: Rule<QuantityIR> = subGrammar(
    QUANTITY,
    rule(QUANTITY, (span, ctx) => {
        if (span === "X") return ok({ kind: "x" as const });
        const number = readNumberWord(span);
        if (number !== null)
            return ok({ kind: "fixed" as const, value: number });
        if (span.startsWith("for each ")) return forEachRule.run(span, ctx);
        return fail("not a quantity this grammar knows", span);
    })
);

/**
 * The SET an effect site counts (CR 107.1) — the noun phrase behind
 * "N life for each …". Two shapes, and only the two the corpus prints at a
 * life-change site: the controller's permanents a descriptor names ("for each
 * Swamp you control"), and the cards in a hand ("for each card in target
 * opponent's hand" — a hidden zone whose SIZE is public, CR 402.3).
 */
export type CountedSetIR =
    | { readonly kind: "permanents"; readonly descriptor: DescriptorIR }
    | { readonly kind: "cards-in-hand"; readonly player: PlayerRefIR };

/** CR 402.3 — the two hands a count is printed over. */
const CARDS_IN_HAND = /^for each card in (your|target opponent's) hand$/;

/**
 * `"for each Swamp you control"`, `"for each card in target opponent's hand"`.
 *
 * The permanent form is `forEachRule`'s descriptor read whole — this rule adds
 * no vocabulary of its own — and asks nothing of the descriptor beyond
 * "counts something": whether the engine's `count` can express every clause it
 * carries is the LOWERING's refusal to make, because only there is a clause
 * that would be dropped visible.
 */
export const countedSetRule: Rule<CountedSetIR> = subGrammar(
    "counted set",
    rule<CountedSetIR>("counted set", (span, ctx) => {
        const hand = span.match(CARDS_IN_HAND);
        if (hand !== null)
            return ok({
                kind: "cards-in-hand" as const,
                player:
                    hand[1] === "your"
                        ? ({ kind: "you" } as const)
                        : ({ kind: "target", opponent: true } as const),
            });
        const each = forEachRule.run(span, ctx);
        if (!each.ok) return each;
        if (each.value.kind !== "for-each")
            return fail("not a counted set", span);
        return ok({
            kind: "permanents" as const,
            descriptor: each.value.per,
        });
    })
);

/**
 * CR 107.1 — "the number of Mountains you control": the same counted set as
 * "for each Mountain you control", printed as a plural noun phrase after
 * "equal to". The descriptor is `descriptorRule`'s read whole and must be
 * plural (a singular "the number of Mountain" is a phrase we have misread);
 * whether the engine's `count` can express every clause it carries is the
 * LOWERING's refusal to make, as for `countedSetRule`.
 */
export const numberOfSetRule: Rule<CountedSetIR> = subGrammar(
    "number of set",
    rule<CountedSetIR>("number of set", (span, ctx) => {
        if (!span.startsWith("the number of "))
            return fail('not a "the number of" phrase', span);
        const descriptor = descriptorRule.run(
            span.slice("the number of ".length),
            ctx
        );
        if (!descriptor.ok) return descriptor;
        if (descriptor.value.plural !== true)
            return fail('"the number of" counts a plural descriptor', span);
        return ok({
            kind: "permanents" as const,
            descriptor: descriptor.value,
        });
    })
);
