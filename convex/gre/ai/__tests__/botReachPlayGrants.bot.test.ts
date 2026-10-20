// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — an ability granted to a target creature.
// One fixture per outcome on the generated position; the sweep itself runs over the whole
// `ready` set in `oracle:compile`, these files are the evidence its verdicts
// mean what the lockfile says (split by cost, issue #6148).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReachSeats } from "../botReach";

describe("Bot-play sweep (ADR 0105 § 7.2) — an ability granted to a target creature", () => {
    // Issue #4269: an instant that draws and grants an ability to a target
    // creature; both halves are posed by their own slices, the sweep plays the
    // composition.
    it("played — an instant that grants an ability to a target creature and draws", () => {
        for (const name of [
            "Accelerate",
            "Bladebrand",
            "Charge Through",
            "Expedite",
            "Lace with Moonglove",
            "Poison the Blade",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);
});
