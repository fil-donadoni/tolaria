// Bot-suite counterpart to `colorless.test.ts` (Urza's Saga, issue #1884).
// `planManaPayment` (`convex/gre/moves`) is the production auto-tap payment
// planner — it emits the concrete taps the server commits, not a legality
// hint — but the module is bot-only (`scripts/__tests__/bot-suite-boundary.test.ts`
// / CLAUDE.md § Quality gates: bot modules are named `convex/gre/moves` and
// must only be imported from a `*.bot.test.ts` file). This single assertion
// was split out of the application suite's `colorless.test.ts` for that
// reason; `sagaBoard`/`tickChapter` are shared via `./urzasSagaFixtures` so
// both files drive the identical fixture rather than a drifted copy.

import { describe, it, expect } from "vitest";
import { planManaPayment } from "../../../../gre/moves";
import { sagaBoard, tickChapter } from "./urzasSagaFixtures";

describe('chapter I — indefinite "{T}: Add {C}" grant (CR 611.2c / 605.1a, #1880)', () => {
    it("makes an otherwise-unpayable {1} spell payable through the REAL payment planner", () => {
        // `planManaPayment` (gre/moves.ts) is the production auto-tap payment
        // path — it emits the concrete taps the server commits, not a
        // legality hint. Before chapter I the Saga produces nothing, so a {1}
        // cost cannot be covered at all.
        const { state, saga } = sagaBoard({ lore: 0 });
        expect(planManaPayment(state, state.players[0], { X: 1 })).toBeNull();
        tickChapter(state);
        const taps = planManaPayment(state, state.players[0], { X: 1 });
        expect(taps).not.toBeNull();
        expect(taps!.map((t) => t.cardInstanceId)).toEqual([saga.id]);
    });
});
