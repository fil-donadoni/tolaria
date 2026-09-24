// The catalogue deep-freeze, split from `vitest.setup.node.ts` so its
// module-level state survives across test files: vitest re-evaluates the setup
// file per test file even under `isolate: false`, but an IMPORTED module is
// cached for the worker's lifetime (issue #4484).
import { getAllCards } from "./convex/cards/catalogue";
import * as sharedTokens from "./convex/cards/sharedTokens";

const seen = new WeakSet<object>();
let walks = 0;

export function deepFreeze(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    for (const key of Object.getOwnPropertyNames(value)) {
        deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
}

export function freezeCatalogueOnce(): void {
    if (walks > 0) return;
    walks++;
    for (const def of getAllCards()) deepFreeze(def);
    for (const spec of Object.values(sharedTokens)) deepFreeze(spec);
}

export function catalogueFreezeWalks(): number {
    return walks;
}
