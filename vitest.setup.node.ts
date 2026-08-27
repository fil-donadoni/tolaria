// Setup for the NODE test projects (`node`, `bot-node`), which run
// `isolate: false`: one module registry per worker, shared across test files.
//
// That sharing is safe only while nothing mutates module-level data in place.
// The config's original justification ("convex/scripts tests use ZERO
// vi.mock / spies / global writes") does not cover plain in-place mutation of
// IMPORTED DATA — and that is exactly the failure observed on 2026-08-27: a
// test mutated a shared card definition (a `grantAbility` op lost its
// `ability` field), and `effectScripts.test.ts` + the card's own suite went
// red only when scheduled AFTER the culprit in the same worker. An
// order-dependent heisen-red: same tree, red at 14:37, green at 14:49.
//
// The fix is structural: deep-freeze the shared card data before any test
// runs. A mutating test now throws IN PLACE (strict mode makes writes to
// frozen objects throw), at the guilty line, on the first run — instead of
// poisoning whichever file the scheduler happens to run next.
//
// Frozen surface: every expanded catalogue definition (the SAME objects
// `getDefinition`/`registeredDefinitions` hand to the engine — expansion is
// memoized by base identity in convex/cards/registry.ts) plus the shared
// token specs. Tests that need a mutable card build one via the fixture
// builders (`makeInstance`, …) or `structuredClone` a frozen definition —
// cloning a frozen object yields an unfrozen copy.
import { getAllCards } from "./convex/cards/catalogue";
import * as sharedTokens from "./convex/cards/sharedTokens";

const seen = new WeakSet<object>();

function deepFreeze(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    for (const key of Object.getOwnPropertyNames(value)) {
        deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
}

for (const def of getAllCards()) deepFreeze(def);
for (const spec of Object.values(sharedTokens)) deepFreeze(spec);
