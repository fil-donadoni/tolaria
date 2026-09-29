// Shared machinery for walking a Convex `v.object(...)` validator's OWN
// `.json` description against a real value — the exact check Convex performs
// at the function-return boundary at runtime (rejects an object carrying a
// field the validator doesn't declare, or missing a required one). The
// project has no convex-test harness (see `adminAuth.test.ts`), so a query
// can't literally be invoked through a deployment in a test — this is the
// next-best thing: the SAME description Convex validates with, walked here
// instead of there.
//
// Extracted from `limitedEventViewValidator.test.ts` (issue #1644) when a
// second validator (`limitedEventSummaryValidator`, issue #2357) needed the
// identical walk — one copy, not two that can drift (CLAUDE.md "extract
// after the second").
export interface FieldJson {
    fieldType: ValidatorJson;
    optional: boolean;
}
export type ValidatorJson =
    | { type: "object"; value: Record<string, FieldJson> }
    | { type: "array"; value: ValidatorJson }
    | { type: "union"; value: ValidatorJson[] }
    | { type: "record"; keys: ValidatorJson; values: FieldJson }
    | { type: "literal"; value: unknown }
    | { type: string; value?: unknown };

/** `.json` is how Convex itself describes a validator, but it is not on
 *  every variant's PUBLIC type — hence the one narrowing cast, applied at
 *  each call site. */
export function validatorJsonOf(validator: unknown): ValidatorJson {
    return (validator as { json: ValidatorJson }).json;
}

/** Validates `value` against Convex's `ValidatorJson`, returning the list of
 *  violations (empty = the boundary would accept it). Mirrors the server's
 *  semantics for the node types this project's wire shapes use: an object is
 *  STRICT (an undeclared field is a violation), a non-optional field must be
 *  present and not `undefined`, and a union needs one member to accept. */
export function validationErrors(
    value: unknown,
    validator: ValidatorJson,
    path = "<return>"
): string[] {
    switch (validator.type) {
        case "any":
            return [];
        case "null":
            return value === null ? [] : [`${path}: expected null`];
        case "number":
            return typeof value === "number"
                ? []
                : [`${path}: expected number`];
        case "bigint":
            return typeof value === "bigint"
                ? []
                : [`${path}: expected bigint`];
        case "boolean":
            return typeof value === "boolean"
                ? []
                : [`${path}: expected boolean`];
        case "string":
        case "id":
            return typeof value === "string"
                ? []
                : [`${path}: expected string`];
        case "literal":
            return value === (validator as { value: unknown }).value
                ? []
                : [
                      `${path}: expected literal ${JSON.stringify(
                          (validator as { value: unknown }).value
                      )}`,
                  ];
        case "array": {
            if (!Array.isArray(value)) return [`${path}: expected array`];
            const element = (validator as { value: ValidatorJson }).value;
            return value.flatMap((entry, i) =>
                validationErrors(entry, element, `${path}[${i}]`)
            );
        }
        case "union": {
            const members = (validator as { value: ValidatorJson[] }).value;
            const accepted = members.some(
                (member) => validationErrors(value, member, path).length === 0
            );
            return accepted
                ? []
                : [
                      `${path}: matched no union member (${members
                          .map((m) => m.type)
                          .join(" | ")})`,
                  ];
        }
        case "object": {
            if (typeof value !== "object" || value === null)
                return [`${path}: expected object`];
            const fields = (validator as { value: Record<string, FieldJson> })
                .value;
            const errors: string[] = [];
            for (const key of Object.keys(value as Record<string, unknown>)) {
                if (!(key in fields)) {
                    errors.push(
                        `${path}.${key}: EXTRA field, absent from the returns validator`
                    );
                }
            }
            for (const [key, field] of Object.entries(fields)) {
                const entry = (value as Record<string, unknown>)[key];
                if (entry === undefined) {
                    if (!field.optional) {
                        errors.push(`${path}.${key}: MISSING required field`);
                    }
                    continue;
                }
                errors.push(
                    ...validationErrors(
                        entry,
                        field.fieldType,
                        `${path}.${key}`
                    )
                );
            }
            return errors;
        }
        default:
            return [`${path}: unhandled validator node "${validator.type}"`];
    }
}
