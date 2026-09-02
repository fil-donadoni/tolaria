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
import { preloadDefinitions } from "./convex/cards/registry";
import * as sharedTokens from "./convex/cards/sharedTokens";
import {
    assertSwapped,
    parseSwapIds,
    resolveSwapTwins,
    SWAP_ENV,
} from "./convex/oracle/behavioural";

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

// ── Behavioural gold: serve a COMPILED definition instead (issue #2703) ─────
//
// Opt-in and off by default: with `TOLARIA_ORACLE_SWAP` unset this block is a
// single env read and the suite behaves exactly as before. When it IS set, the
// named cards' Oracle text is compiled and the result registered through the
// same `preloadDefinitions` seam `catalogue.ts` uses, so the card's own tests
// run unchanged against the compiler's output — the only way to prove a
// `resolve()` card's compiled twin equivalent, since a closure cannot be diffed
// structurally (`convex/oracle/behavioural.ts` states the argument in full).
// Driven by `bun run oracle:behavioural`.
//
// Placed AFTER the freeze so the twins are frozen on the same terms as the
// catalogue — this project runs `isolate: false`, and an unfrozen definition
// shared across a worker's files is the 2026-08-27 heisen-red this file exists
// to prevent. Every failure throws, which fails the run: a swap that silently
// did not happen would leave the card's tests passing against the hand-written
// definition and report that as the compiler's proof.
const swapRequest = process.env[SWAP_ENV];
if (swapRequest !== undefined) {
    const twins = resolveSwapTwins(parseSwapIds(swapRequest));
    for (const twin of twins) {
        deepFreeze(twin.raw);
        deepFreeze(twin.expanded);
    }
    preloadDefinitions(twins.map((t) => t.raw));
    assertSwapped(twins);
}
