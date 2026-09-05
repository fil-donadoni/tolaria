// The ONE enumeration of the DSL's nesting constructs, for every STATIC walk
// over an Effect Script in `gre/ai/**`.
//
// It started life private to `graveyardReach.ts`, where its own comment already
// said what it is for: "the ONE place the DSL's nesting constructs are
// enumerated, so the two walks below cannot drift apart and a new construct
// cannot be added to the DSL while only one of them learns about it". Issue
// #3041 added a THIRD walk (`searchDestination.ts`, which reads where a
// `search-library` find actually lands), so the enumeration moved here rather
// than being retyped — a copy is exactly the drift the original comment names.
//
// Missing a construct here is a silent FALSE NEGATIVE at every call site: a
// `moveZone` nested inside a `divideIntoPiles` branch is invisible, and the
// reader concludes "no such Op" instead of "I could not see one". That is why
// this is a `switch` on `op.op` with an explicit case per script-carrying Op
// and not a generic "any field named `effects`" reflection: the compiler is
// what makes a new construct visible.

import type { EffectOp } from "../../cards/types";

/** Every nested Op array `op` carries. Beyond the four structural constructs
 *  (ADR 0045: `bind`/`ref`/`if`/`forEach`) this covers the Ops that also carry
 *  scripts — `optionChoice`'s modes, both coin-flip branches, `delayedTrigger`
 *  / `reflexiveTrigger` (their `effects`) and `divideIntoPiles` (both
 *  branches). Death or Glory reanimates from inside a `divideIntoPiles` branch,
 *  which is what a missing case costs in practice. */
export function childOpArrays(op: EffectOp): readonly (readonly EffectOp[])[] {
    switch (op.op) {
        case "if":
            return op.else ? [op.then, op.else] : [op.then];
        case "forEach":
            return [op.effects];
        case "optionChoice":
            return op.modes.map((mode) => mode.effects);
        case "coinFlip":
        case "coinFlipSync":
            return [op.win.effects, op.loss.effects];
        case "delayedTrigger":
        case "reflexiveTrigger":
            return [op.effects];
        case "divideIntoPiles":
            return [op.chosenEffect, op.otherEffect];
        default:
            return [];
    }
}
