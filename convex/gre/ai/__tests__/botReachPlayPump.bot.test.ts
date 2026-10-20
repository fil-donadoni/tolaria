// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — pumps and modal instants.
// One fixture per outcome on the generated position; the sweep itself runs over the whole
// `ready` set in `oracle:compile`, these files are the evidence its verdicts
// mean what the lockfile says (split by cost, issue #6148).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReachSeats } from "../botReach";

describe("Bot-play sweep (ADR 0105 § 7.2) — pumps and modal instants", () => {
    // Issue #4267: a pump aimed at a creature that also draws is worth the
    // trick AND the cards it finds; each half was posed by its own slice
    // (issue #4264, issue #4266) and the composition is what the sweep plays.
    it("played — an instant that pumps a target creature and draws", () => {
        for (const name of [
            "Aggressive Urge",
            "Defiant Strike",
            "Rebellious Strike",
            "Sudden Strength",
            "Sugar Rush",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4268: a modal instant whose modes name a colour-filtered
    // permanent and a subtype-filtered land is posed against an opponent
    // permanent of that colour / a land of that subtype.
    it("played — a modal instant destroying a coloured permanent or bouncing a subtype land", () => {
        for (const name of ["Active Volcano", "Flash Flood"]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4270: a sorcery pump pays only in the attack the same main phase
    // goes on to make, so the sweep poses the race it decides (`sorceryPumpRace`).
    it("played — a sorcery that pumps a target creature", () => {
        for (const name of [
            "Feral Roar",
            "Howling Fury",
            "Monstrous Growth",
            "Phytoburst",
            "Wielding the Green Dragon",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);
});
