// The committed `data/blade-card-index.json` matches what the registry would
// build TODAY (issue #4177, review finding B3). Nothing else
// keeps them in sync: a new `must` entry changes no status until someone runs
// `bun run blade:card-index` by hand. `.bot.test.ts`: this is the one place
// that legitimately loads `convex/gre/ai/blade/registry.ts` from the app
// suite's side of the boundary (`bot-suite-boundary.test.ts`).
import { describe, it, expect } from "vitest";
import { BLADE_SCENARIOS } from "../../convex/gre/ai/blade/registry";
import {
    buildBladeCardIndex,
    buildBladeReproducers,
} from "../lib/blade-card-index";
import committed from "../../data/blade-card-index.json";
import committedReproducers from "../../data/blade-reproducers.json";

describe("data/blade-card-index.json", () => {
    it("is exactly what the registry builds today — run `bun run blade:card-index` if this fails", () => {
        expect(committed).toEqual(buildBladeCardIndex(BLADE_SCENARIOS));
    });

    it("data/blade-reproducers.json is exactly what the registry builds today", () => {
        expect(committedReproducers).toEqual(
            buildBladeReproducers(BLADE_SCENARIOS)
        );
    });
});
