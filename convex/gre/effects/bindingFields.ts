// The one naming rule for an Effect Script field that DECLARES a binding
// (issue #4451): `bind`, `bind<Name>` or `<name>Bind`.
//
// It is a rule rather than a list so that the runtime can read it without
// the static validator: `splice.ts` finds the names a spliced segment declares
// with it, and the Brain's worker bundles `splice.ts` (a list derived from
// `OP_SCHEMAS` would drag the whole validator in with it). The rule binds the
// schema in both directions, through `check:ts`: every union field whose name
// matches must be checked by a `bindingDeclaration(kind)` predicate, and no
// other field may be (`CheckFor` in `validate.ts`). So "a field matching this
// rule" and "a field the Op Schema tags as a binding declaration" are the same
// set — `opSchemaFieldKinds.test.ts` pins it.

type UpperLetter =
    | "A"
    | "B"
    | "C"
    | "D"
    | "E"
    | "F"
    | "G"
    | "H"
    | "I"
    | "J"
    | "K"
    | "L"
    | "M"
    | "N"
    | "O"
    | "P"
    | "Q"
    | "R"
    | "S"
    | "T"
    | "U"
    | "V"
    | "W"
    | "X"
    | "Y"
    | "Z";

/** A field name that declares a binding, as a type. */
export type BindingFieldName =
    | "bind"
    | `bind${UpperLetter}${string}`
    | `${string}Bind`;

const BINDING_FIELD_NAME = /^(?:bind(?:[A-Z].*)?|.*Bind)$/;

/** Whether `key` names a binding-declaring field — {@link BindingFieldName}
 *  at runtime. */
export function isBindingDeclarationField(key: string): boolean {
    return BINDING_FIELD_NAME.test(key);
}
