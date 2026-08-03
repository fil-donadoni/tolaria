// Reserved `$target<N>` ref grammar (ADR 0045, issue #2065).
//
// The Effect Script ref namespace holds three RESERVED names — ones no `bind`
// declares and no Op writes — alongside author-declared bindings:
//
//   `$source`  (SOURCE_BINDING, interpreter.ts) — the ability's own source
//   `$each`    (EACH_BINDING,   interpreter.ts) — a forEach body's member
//   `$target<N>`                (here)          — an announced target slot
//
// `$target<N>` closes the one gap the other two leave: reading a
// CHARACTERISTIC of an announced target before any Op has bound it. Winnow
// ("Destroy target nonland permanent if another permanent with the same name
// is on the battlefield") needs the target's own NAME as the filter of a board
// count, and no Op runs before that count to bind it.
//
// The grammar lives in its OWN module, imported by BOTH the interpreter and
// the static validator, because a reserved ref has more than one consumer and
// those consumers do not otherwise share code: the interpreter resolves it and
// the validator ref-checks it against the declared-binding map. A private copy
// in each would let the two drift — and a drift here is silent, since the
// interpreter's fallback for an unrecognised ref is `undefined` (skip), not an
// error.
//
// Deliberately NOT a new construct: bind/ref/if/forEach stay frozen (ADR 0045).
// This is a reserved NAME in the existing ref namespace, exactly as `$source`
// and `$each` already are.

/** The reserved prefix of an announced-target ref (`$target0`, `$target1`, …).
 *  The digits are the zero-based index into the announced `targets` array —
 *  the same index the `{ target: N }` object selector uses. */
export const TARGET_BINDING_PREFIX = "$target";

/** The only property path the reserved target ref supports today (CR 201.2 —
 *  the target's live name). Extending this list is a deliberate act: each
 *  property needs a resolver on the matching typed path (the STRING path,
 *  `resolveNameRef`, for `.name`), so an unlisted property must stay a static
 *  rejection rather than a silent `undefined` at runtime. */
export const TARGET_NAME_PROPERTY = "name";

/** `$target<N>` → N, or null when `binding` is not the reserved shape.
 *  Fail-closed on everything else: `$targets`, `$target`, `$target1x` and
 *  `$targetX` are ordinary (undeclared) binding names, not slot refs. */
export function parseTargetBinding(binding: string): number | null {
    if (!binding.startsWith(TARGET_BINDING_PREFIX)) return null;
    const digits = binding.slice(TARGET_BINDING_PREFIX.length);
    if (digits.length === 0 || !/^[0-9]+$/.test(digits)) return null;
    return Number(digits);
}

/** True when `binding` is the reserved target-slot shape — the guard a `bind`
 *  name check uses to keep an author from SHADOWING a reserved name (the
 *  interpreter resolves `$target0` from `ctx.targets` and never consults the
 *  binding store, so a shadowing bind would be silently ignored). */
export function isReservedTargetBinding(binding: string): boolean {
    return parseTargetBinding(binding) !== null;
}

/** `$target<N>.name` → N, or null when `ref` is not that exact reserved ref.
 *  Note the two rejections that matter, both fail-closed by construction:
 *  a bare `$target0` (no property — nothing to read) and `$target0.<other>`
 *  (an unsupported property path) both return null, so the caller falls
 *  through to its ordinary "unknown ref" handling instead of guessing. */
export function parseTargetNameRef(ref: string): number | null {
    const dot = ref.indexOf(".");
    if (dot < 0) return null;
    const slot = parseTargetBinding(ref.slice(0, dot));
    if (slot === null) return null;
    return ref.slice(dot + 1) === TARGET_NAME_PROPERTY ? slot : null;
}
