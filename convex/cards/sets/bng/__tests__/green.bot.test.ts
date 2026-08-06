// bng — green card tests, BOT suite.
//
// Courser of Kruphix's play-lands-from-top permission has to be reachable by
// the AI, which means asserting against `enumerateMoves` (`convex/gre/moves`).
// That module is bot-only, so these cases cannot live in the sibling
// `green.test.ts` — `scripts/__tests__/bot-suite-boundary.test.ts` fails the
// application suite when a plain `*.test.ts` imports one. Everything else
// about the card (definition, permission lookup, affordance gate, play-commit
// seam, landfall, wire SURFACE) stays in `green.test.ts`.

import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../../../../gre/moves";
import { courserBoard } from "./courserBoard";
import { forest } from "../../lea/colorless";

describe("bot move enumeration — the permission is reachable by the AI", () => {
    it("enumerates a play-land move for the top library land", () => {
        const state = courserBoard([forest.id]);
        const moves = enumerateMoves(state, "p1");
        expect(moves).toContainEqual({
            kind: "play-land",
            cardInstanceId: "p1-lib-0",
        });
    });

    it("enumerates NO library play-land move without the permission", () => {
        const state = courserBoard([forest.id], false);
        const moves = enumerateMoves(state, "p1");
        expect(moves).not.toContainEqual({
            kind: "play-land",
            cardInstanceId: "p1-lib-0",
        });
    });
});
