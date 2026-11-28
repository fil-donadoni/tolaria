// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — sacrifice creatures, second half.
// One fixture per outcome on the generated position; the sweep itself runs over the whole
// `ready` set in `oracle:compile`, these files are the evidence its verdicts
// mean what the lockfile says (split by cost, issue #6148).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { BOT_REACH_BUDGET, playBotReachSeats } from "../botReach";

describe("Bot-play sweep (ADR 0105 § 7.2) — sacrifice creatures, second half", () => {
    // Issue #4273: an instant whose only effect grants an ability to a target
    // creature until end of turn. Measured from where each rollout started,
    // every `played` seat was a cast in the opponent's end step, where the
    // grant expires unused. On the root clock (ADR 0015 Amendment I) the
    // holder's main-phase cast ties `pass` inside `outcomeEps`, so
    // `last-window-deferral` holds it, and the end step no longer credits the
    // dead grant: one seat of the six still plays it.
    it("an until-end-of-turn grant to a target creature: held, but for one seat", () => {
        const seats = (name: string) =>
            playBotReachSeats(getCardByName(name)).map((s) => [
                s.holderId,
                s.verdict.outcome,
                "cause" in s.verdict ? s.verdict.cause : undefined,
            ]);
        const held = ["ignored", "never-chosen"];
        expect(seats("Defy Gravity")).toEqual([
            ["p1", "played", undefined],
            ["p2", ...held],
        ]);
        for (const name of ["Double Cleave", "Unnatural Speed"]) {
            expect(seats(name), name).toEqual([
                ["p1", ...held],
                ["p2", ...held],
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

    // Issue #7705: at the sweep's 48 iterations Gerrard's Wisdom was a
    // near-tie with `pass` (mean reward 0.31 vs 0.30, 25 vs 23 visits, settled
    // by the material tie-break) that flipped under almost any refit — a
    // noise pin, not evidence. Four times the budget gives the cast's edge
    // the visits to show; the sweep's own verdict keeps the default budget.
    // Presence of the Wise is the same shape (2 life per card in hand) and
    // the same near-tie, flipped by the issue #7819 refit — identical
    // numbers at 48 iterations, played at four times the budget.
    it("played — a gain-life sorcery scaled by hand size, at a budget past its near-tie", () => {
        for (const name of ["Gerrard's Wisdom", "Presence of the Wise"]) {
            expect(
                playBotReachSeats(getCardByName(name), {
                    ...BOT_REACH_BUDGET,
                    iterations: BOT_REACH_BUDGET.iterations * 4,
                }),
                name
            ).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
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
