// Structural-sharing clone for the AI search sandbox (ADR 0001, issue #108).
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
//   2. It SHARES, by reference, the one guaranteed-immutable embedded blob:
//      `CardInstanceState.card`, the card definition reference. The engine reads
//      only `card.id` (see the type doc on `CardInstanceState.card`) and copy
//      effects REPLACE the whole ref (`copy.ts`: `card.card = { ...id }`) rather
//      than mutating it, so aliasing it across clones is sound. Every other
//      `.card`-keyed value in the tree (stack items, trigger-event payloads) is
//      likewise a read-only snapshot, never mutated in place by move
//      application — so sharing all `card` refs is safe for the search use case.
//
// Sharing the definition is the "share read-only fields by reference" lever
// from the ADR; deep-copying the rest is the "copy only the touched paths"
// half done eagerly (the in-place engine rules out lazy copy-on-write without a
// rewrite, which is out of scope for this slice).
//
// NOTE: this clone is used ONLY by the client-side AI brain. The authoritative
// server path in `game.ts` is unchanged and keeps using `structuredClone`.

import type { GameState } from "./state";

/** The instance field shared by reference rather than deep-copied. */
const SHARED_REF_KEY = "card";

function cloneValue<T>(value: T): T {
    if (value === null || typeof value !== "object") return value;

    if (Array.isArray(value)) {
        const out = new Array(value.length);
        for (let i = 0; i < value.length; i++) out[i] = cloneValue(value[i]);
        return out as unknown as T;
    }

    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
        out[key] =
            key === SHARED_REF_KEY
                ? source[key] // share the immutable card-definition reference
                : cloneValue(source[key]);
    }
    return out as unknown as T;
}

/** Structural-sharing deep clone of a GameState for AI search. Deep-copies all
 *  mutable paths; shares each `CardInstanceState.card` definition reference.
 *  Applying a move to the result never mutates the original. */
export function cloneGameState(state: GameState): GameState {
    return cloneValue(state);
}
