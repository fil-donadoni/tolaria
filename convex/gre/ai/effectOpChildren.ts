// The ONE enumeration of the DSL's nesting constructs, for every STATIC walk
// over an Effect Script — `gre/ai/**` and the card catalogue alike.
//
// It started life private to `graveyardReach.ts`, where its own comment already
// said what it is for: "the ONE place the DSL's nesting constructs are
// enumerated, so the two walks below cannot drift apart and a new construct
// cannot be added to the DSL while only one of them learns about it". Issue
// #3041 added a THIRD walk (`searchDestination.ts`, which reads where a
// `search-library` find actually lands), so the enumeration moved here rather
// than being retyped — a copy is exactly the drift the original comment names.
// Issue #4442 retired the last five hand-written copies (beneficence, the two
// ability-timing predicates, the token catalogue), three of which had never
// learned `delayedTrigger` / `reflexiveTrigger` / `divideIntoPiles`.
//
// Missing a construct here is a silent FALSE NEGATIVE at every call site: a
// `moveZone` nested inside a `divideIntoPiles` branch is invisible, and the
// reader concludes "no such Op" instead of "I could not see one". That is why
// this is a `switch` on `op.op` with an explicit case per script-carrying Op
// and not a generic "any field named `effects`" reflection — and why the
// `default` arm only accepts an Op the type system has proven carries no
// script (`ScriptHostOp` below): a new nesting Op added to the union without a
// case here is a `check:ts` error, not a walker that quietly returns `[]`.

import type { EffectOp } from "../../cards/types";

/** A nested Effect Script, as a field of a host Op declares it. */
type Script = readonly EffectOp[];

/** `true` when a field's declared type IS a script (optional or not). The
 *  tuple wrap stops `boolean`-style distribution over a union field. */
type IsScript<V> = [NonNullable<V>] extends [never]
    ? false
    : [NonNullable<V>] extends [Script]
      ? true
      : false;

/** `true` when some field of object type `T` is a script. */
type HasScriptField<T> = true extends {
    [K in keyof T]-?: IsScript<T[K]>;
}[keyof T]
    ? true
    : false;

/** `true` when a field holds a script ONE level down — a branch object
 *  (`coinFlip`'s `win: { effects }`) or a list of them (`optionChoice`'s
 *  `modes[].effects`). Deep enough for every shape the DSL has; a host that
 *  buried a script deeper still would need this widened, and the fixture test
 *  (`nestedOpShapes.ts`) is where it would first go missing. */
type HoldsScript<V> =
    IsScript<V> extends true
        ? true
        : NonNullable<V> extends readonly (infer E)[]
          ? HasScriptField<E>
          : NonNullable<V> extends object
            ? HasScriptField<NonNullable<V>>
            : false;

/** `true` when Op variant `O` carries a nested script in any field. */
type CarriesScript<O> = true extends {
    [K in keyof O]-?: HoldsScript<O[K]>;
}[keyof O]
    ? true
    : false;

/** Every Op name whose variant carries a nested Effect Script — DERIVED from
 *  the `EffectOp` union's field types, never listed by hand. */
export type ScriptHostOp = {
    [N in EffectOp["op"]]: CarriesScript<
        Extract<EffectOp, { op: N }>
    > extends true
        ? N
        : never;
}[EffectOp["op"]];

/** An Op the type system has proven carries no nested script. */
type ScriptlessOp = Exclude<EffectOp, { op: ScriptHostOp }>;

/** The `default` arm's witness: it only type-checks for a script-free Op, so
 *  a host `childOpArrays` has no case for reds here. */
function noChildren(_op: ScriptlessOp): readonly Script[] {
    return [];
}

/** Every nested Op array `op` carries. Beyond the four structural constructs
 *  (ADR 0045: `bind`/`ref`/`if`/`forEach`) this covers the Ops that also carry
 *  scripts — `optionChoice`'s modes, both coin-flip branches, `delayedTrigger`
 *  / `reflexiveTrigger` (their `effects`) and `divideIntoPiles` (both
 *  branches). Death or Glory reanimates from inside a `divideIntoPiles` branch,
 *  which is what a missing case costs in practice. */
export function childOpArrays(op: EffectOp): readonly Script[] {
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
            return noChildren(op);
    }
}

/** Whether `op`'s nested body is its OWN triggered ability — a delayed
 *  (CR 603.7) or reflexive (CR 603.12) trigger that goes on the stack later
 *  and announces its own targets as it does (CR 603.3d → CR 601.2c). A
 *  `{ target: n }` inside that body names the TRIGGER's slot `n`, never the
 *  host script's: a walker asking "is there an X anywhere in this script"
 *  descends into it through `childOpArrays` like any other list, but one that
 *  attributes Ops to the host's announced slots must not. */
export function isTriggerBodyHost(
    op: EffectOp
): op is Extract<EffectOp, { op: "delayedTrigger" | "reflexiveTrigger" }> {
    return op.op === "delayedTrigger" || op.op === "reflexiveTrigger";
}
