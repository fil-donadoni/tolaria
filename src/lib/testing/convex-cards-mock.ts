// Test-only mirror of the `@convex/cards` barrel's mana-cost reader.
//
// WHY THIS FILE EXISTS
// ────────────────────
// Frontend component/hook suites replace the WHOLE `@convex/cards` barrel with
// a hand-rolled partial mock (`vi.mock("@convex/cards", () => ({ ... }))`) —
// the real barrel eagerly imports ~290 set modules, far too heavy for a jsdom
// render test, and the tests want a tiny deterministic catalogue anyway.
//
// Every module inside `convex/cards/` that needs a card definition imports it
// back through that same barrel (`import { tryGetDefinition } from "."`), which
// is precisely what makes the substitution work. The flip side: a partial mock
// that omits an export the module under test reaches is a HARD failure —
// `Error: [vitest] No "X" export is defined on the "@convex/cards" mock`.
//
// `getInstanceManaCost` (`convex/cards/registry.ts`) became the single
// mana-cost authority in issue #2339 — `CAST_RESTRICTION_CTX`,
// `ATTACK_RESTRICTION_CTX`, `getEffectiveColors` and the layer context all read
// through it instead of each re-deriving `embedded ?? tryGetDefinition(id)`.
// That refactor pulled the name into the import graph of a dozen board/hook
// suites at once and every stale mock failed together.
//
// This module is the ONE place the mocked resolution order lives, so ~40 mock
// factories cannot drift from each other, and
// `src/lib/__tests__/convex-cards-mock.test.ts` pins it equal to the real
// function it stands in for.
//
// USAGE — inside a `vi.mock` factory, always through a closure:
//
//     vi.mock("@convex/cards", () => ({
//         getDefinition: (id: string) => DEFS[id] ?? PLAIN_DEF,
//         tryGetDefinition: (id: string) => DEFS[id] ?? PLAIN_DEF,
//         getInstanceManaCost: (c: ManaCostSource) =>
//             mockInstanceManaCost(c, (id) => DEFS[id] ?? PLAIN_DEF),
//     }));
//
// The closure is load-bearing: `vi.mock` is hoisted above the file's imports,
// so the factory body may run before this module has been evaluated. Anything
// referenced from the factory body DIRECTLY (a call, a spread) can hit the
// temporal dead zone; anything referenced from inside a returned arrow function
// is resolved at call time, long after every import has settled — which is the
// same reason the existing factories can close over `DEFS` / `PLAIN_DEF`.
//
// The lookup you pass should be the SAME one the mock gives `tryGetDefinition`:
// the real `getInstanceManaCost` falls back to `tryGetDefinition`, so a mock
// whose `tryGetDefinition` returns `undefined` must resolve no cost either,
// even when its `getDefinition` returns a def carrying `manaCost`.

import type { ManaCost } from "@convex/cards/types";

/** The `CardInstanceState` / `CardInstance` shape `getInstanceManaCost` reads.
 *  Structural on purpose — server instances and projected client instances both
 *  satisfy it, and test fixtures inline the cost on `card`. */
export interface ManaCostSource {
    card: Record<string, unknown>;
    manaCostOverride?: ManaCost;
}

/** A mocked definition lookup — the mock's own `tryGetDefinition`. Returns
 *  `unknown` because the fake definitions these suites hand back are ad-hoc
 *  partials (`{ name: "Test Card" }`), which a `{ manaCost?: ManaCost }`
 *  parameter would reject under TypeScript's weak-type rule. */
export type MockDefinitionLookup = (id: string) => unknown;

/** Mirrors `getInstanceManaCost` (`convex/cards/registry.ts`) exactly:
 *  instance-level `manaCostOverride` (CR 707.2 "except it has no mana cost")
 *  → cost embedded on `instance.card` (test fixtures) → the definition lookup.
 *  Omit `tryGetDefinition` when the mock has no definition lookup of its own. */
export function mockInstanceManaCost(
    instance: ManaCostSource,
    tryGetDefinition?: MockDefinitionLookup
): ManaCost | undefined {
    if (instance.manaCostOverride) return instance.manaCostOverride;
    const embedded = (instance.card as { manaCost?: ManaCost }).manaCost;
    if (embedded) return embedded;
    const id = (instance.card as { id?: string }).id;
    if (!id || !tryGetDefinition) return undefined;
    const def = tryGetDefinition(id) as
        | { manaCost?: ManaCost }
        | null
        | undefined;
    return def?.manaCost ?? undefined;
}
