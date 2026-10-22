// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — sacrifice creatures, second half.
// One fixture per outcome on the generated position; the sweep itself runs over the whole
// `ready` set in `oracle:compile`, these files are the evidence its verdicts
// mean what the lockfile says (split by cost, issue #6148).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReachSeats } from "../botReach";

describe("Bot-play sweep (ADR 0105 § 7.2) — sacrifice creatures, second half", () => {
    // Issue #4273: an instant whose only effect grants an ability to a target
    // creature; the race it decides is posed by the sweep's positions.
    it("played — an instant that grants an ability to a target creature", () => {
        for (const name of [
            "Defy Gravity",
            "Double Cleave",
            "Unnatural Speed",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // The gain-life sorcery pays only when life is scarce, so the sweep poses
    // the holder one point from dead against an attacker (`sorceryLifeGainRace`).
    it("played — a sorcery that only gains its controller life", () => {
        for (const name of ["Bountiful Harvest"]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // The race is lost either way for seat p2 (Gerrard's Wisdom: 1 → 3 life
    // against two attackers), so its verdict is search noise: `played` until
    // issue #6334's refit, `ignored` (a 24/24 visit tie) after it.
    // tracked-by: #6346
    it("noise-pinned — seat p2 of a life gain that cannot win the race", () => {
        for (const name of ["Gerrard's Wisdom", "Presence of the Wise"]) {
            const seats = playBotReachSeats(getCardByName(name));
            expect(
                seats.map((s) => [s.holderId, s.verdict.outcome]),
                name
            ).toEqual([
                ["p1", "played"],
                ["p2", "ignored"],
            ]);
        }
    }, 600_000);

    // Issue #4275: a flier whose only ability sacrifices a creature for a
    // transient pump of ITSELF is played. Its sacrifice variants are kept out
    // of the rollout's random draw (`isTransientSacrificeConversion`) and out
    // of the tree below the cast (`isDeferrableTransientSacrifice`, issue
    // #4261), so they no longer drag the cast edge under `pass`.
    it("played — a flier that sacrifices a creature to pump itself", () => {
        for (const name of ["Devouring Swarm", "Fallen Angel"]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);
});
