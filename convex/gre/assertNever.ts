/** Exhaustiveness tail for a `switch` over a discriminated union (issue
 *  #4441). Placed in a `default:` arm, it makes a union member with no arm a
 *  COMPILE error (`x` is no longer `never`), and it throws if a value the type
 *  did not admit reaches it at runtime — never a silent skip. */
export function assertNever(x: never, what: string): never {
    throw new Error(`Unhandled ${what}: ${JSON.stringify(x)}`);
}
