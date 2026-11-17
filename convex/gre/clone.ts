// Structural-sharing clone for the AI search sandbox (ADR 0000, issue #108).
//
// The GRE applies moves by mutating a GameState in place; isolation between
// transactions comes from `structuredClone(gameState.state)` at the `game.ts`
// mutation boundary. ISMCTS needs to clone-and-apply thousands of times per
// decision, where `structuredClone` — a general-purpose, serialization-grade
// deep copy — is the dominant cost.
//
// `cloneGameState` is a lean alternative tuned to the GameState shape:
//
//   1. It deep-copies every MUTABLE path, so a move applied to the clone never
//      reaches back into the original (search must explore freely).
//   2. It SHARES, by reference, the values under `SHARED_KEYS` — data the
//      engine REPLACES and never mutates in place:
//        - `card`, the card definition reference. The engine reads only
//          `card.id` (see the type doc on `CardInstanceState.card`) and copy
//          effects REPLACE the whole ref (`copy.ts`: `card.card = { ...id }`).
//          The same key also names a whole INSTANCE on a holder
//          (`StagedEntry.card`: the permanent off every zone while its
//          as-enters choices are owed), and the engine finishes that entry by
//          writing into it — so an instance under `card` is copied like any
//          other. An instance carries its definition under its own `card`; a
//          definition never does. Sharing it was a live aliasing bug (issue
//          #10026): a search that resolved a staged entry rewrote the zone and
//          entry stamps of the caller's own staged permanent.
//        - an object's characteristic lists (`types`, `subtypes`,
//          `staticAbilities` and their captured `base*` layer bases; issue
//          #10026). The layer passes rebuild them as fresh arrays
//          (`layers2to5.ts`, `layer6.ts`, `textChanges.ts`) and every writer
//          assigns a new array (`card.staticAbilities = [...old, kw]`)
//          rather than pushing into the old one. They were three of every four
//          objects a clone allocated: a library card is one instance and
//          three lists, and the library is most of a state.
//
// Sharing is sound only while that write discipline holds, so it is guarded
// twice (`__tests__/searchAliasing.bot.test.ts`): every blade `must` position
// is searched and must come back deep-equal to its pre-search snapshot (a
// shared value is the ORIGINAL's own, so any write into it shows there), and
// a source scan refuses an in-place mutation of a shared list anywhere in the
// engine, on paths no position reaches yet.
//
// Sharing read-only data is the "share read-only fields by reference" lever
// from the ADR; deep-copying the rest is the "copy only the touched paths"
// half done eagerly (the in-place engine rules out lazy copy-on-write without a
// rewrite, which is out of scope).
//
// NOTE: this clone is used ONLY by the AI search. The authoritative server
// path in `game.ts` is unchanged and keeps using `structuredClone`.

import type { GameState } from "./state";

/** The keys whose values are shared by reference rather than deep-copied:
 *  replaced wholesale by the engine, never mutated in place (see above). */
export const SHARED_KEYS: ReadonlySet<string> = new Set([
    "card",
    "types",
    "subtypes",
    "staticAbilities",
    "baseTypes",
    "baseSubtypes",
    "baseStaticAbilities",
]);

/** Whether the OBJECT value under `key` is shared by reference: a definition
 *  ref under `card` (never an instance — see above), a list under the others.
 *  A `switch` on the literal keys, not `SHARED_KEYS.has`: this runs once per
 *  object-valued key of every clone, and V8 compiles the switch to a string
 *  compare chain with no hash lookup. `clone.test.ts` pins that the two agree. */
function isShared(key: string, value: object): boolean {
    switch (key) {
        case "card":
            return !("card" in value);
        case "types":
        case "subtypes":
        case "staticAbilities":
        case "baseTypes":
        case "baseSubtypes":
        case "baseStaticAbilities":
            return Array.isArray(value);
        default:
            return false;
    }
}

// Measured on V8 against the blade `must` positions (issue #10026): `for…in`
// over these objects is twice as slow as `Object.keys` (JavaScriptCore is the
// other way round; the Brain runs mostly on V8), and testing for a primitive
// BEFORE recursing saves a call per primitive field — most of an instance's.
function cloneValue(value: object): object {
    if (Array.isArray(value)) {
        const out = new Array(value.length);
        for (let i = 0; i < value.length; i++) {
            const v: unknown = value[i];
            out[i] = v === null || typeof v !== "object" ? v : cloneValue(v);
        }
        return out;
    }

    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(source);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const v = source[key];
        out[key] =
            v === null || typeof v !== "object" || isShared(key, v)
                ? v
                : cloneValue(v);
    }
    return out;
}

/** Structural-sharing deep clone of a GameState for AI search. Deep-copies all
 *  mutable paths; shares the read-only values under `SHARED_KEYS` by
 *  reference.
 *  Applying a move to the result never mutates the original. */
export function cloneGameState(state: GameState): GameState {
    return cloneValue(state) as GameState;
}
