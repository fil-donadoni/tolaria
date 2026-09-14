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

/** First element of a numeric binding's persisted payload.
 *
 *  The guarantee is the CONJUNCTION `length === 2 && stored[0] === "#n"`, not
 *  `#` on its own: the engine already writes `#` payloads and keys of its own
 *  (`CASCADE_NO_HIT = "#none"`, the `#forEach:<pos>:` member-set key). What
 *  makes the tag unambiguous is that every other writer of `collectedChoices`
 *  produces either a single-element payload (`["yes"]`/`["no"]`, a card name,
 *  one instance id, one player id), a 10-slot `SNAP_*` snapshot, or a frozen
 *  member list — none of them a 2-element array whose head is `"#n"`. Nothing
 *  mechanical protects that; `numberBinding.test.ts` asserts it against the
 *  real writers so a new payload shape cannot quietly collide. */
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
    // `Number("")` is 0 and `Number("  ")` is 0, so an EMPTY tail would read as
    // a legitimate decline rather than as a malformed payload. Reject it
    // explicitly: fail-closed is an uncaptured binding (CR 608.2b) and the
    // reading Op skips, which is the contract every other binding family has.
    const tail = stored[1];
    if (tail.trim().length === 0) return undefined;
    const value = Number(tail);
    return Number.isInteger(value) ? value : undefined;
}
