// The wire shape of a NUMERIC binding (CR 107.1b / 107.3f, issue #1701).
//
// Every mid-resolution answer is persisted into the resolving stack item's
// `collectedChoices` as a `string[]`, and three families already occupy the
// SINGLE-ELEMENT shape: a may-pay's `["yes"]` / `["no"]`, a `name-card`'s
// `[<card name>]`, and a `choice` Op's `[<instance id>]`. A numeric nomination
// is read back in a NUMBER position (`{ ref: "$paid" }` as an `EffectValue`),
// so it must be impossible to confuse with any of them — an untagged `["3"]`
// would be indistinguishable from a card whose name happens to be numeric, and
// worse, a bare `ref` to an OBJECT snapshot would silently read as `NaN`.
//
// Hence the leading tag: a numeric binding is `[NUMBER_BINDING_TAG, "<n>"]` and
// nothing else in the engine writes that first element. The two functions below
// are the only writer and the only reader; they live in their own module
// because both `gre/state.ts` (the `SpellContext` replay read) and
// `gre/effects/interpreter.ts` (the `EffectValue` read) need them, and the
// interpreter deliberately does not import `gre/state.ts`.

/** First element of a numeric binding's persisted payload. `#` is illegal in
 *  an author binding name and in a card name, so the tag can never collide
 *  with a real single-element answer. */
export const NUMBER_BINDING_TAG = "#n";

/** The persisted payload for `amount`. */
export function writeTaggedNumber(amount: number): string[] {
    return [NUMBER_BINDING_TAG, String(amount)];
}

/** Reads a numeric binding back, or `undefined` when `stored` is not one —
 *  an untagged payload (a boolean, a name, a picks list) or a malformed tail.
 *  `undefined` is the standard uncaptured-binding contract (CR 608.2b): the
 *  Op reading it skips. */
export function readTaggedNumber(
    stored: readonly string[] | undefined
): number | undefined {
    if (!stored || stored.length !== 2) return undefined;
    if (stored[0] !== NUMBER_BINDING_TAG) return undefined;
    const value = Number(stored[1]);
    return Number.isInteger(value) ? value : undefined;
}
