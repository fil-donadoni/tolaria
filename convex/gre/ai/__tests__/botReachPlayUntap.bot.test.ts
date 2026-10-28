// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — untap spells and land destroyers.
// One fixture per outcome on the generated position; the sweep itself runs over the whole
// `ready` set in `oracle:compile`, these files are the evidence its verdicts
// mean what the lockfile says (split by cost, issue #6148).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReachSeats } from "../botReach";

describe("Bot-play sweep (ADR 0105 § 7.2) — untap spells and land destroyers", () => {
    // Issue #4288: "untap target permanent" has nothing to do on a board of
    // untapped permanents, so passing was right and the verdict read
    // `never-chosen`. The position gives the holder a tapped body to untap
    // (CR 701.26b), and the Bot then casts it.
    it("played — an untap spell aimed at a tapped permanent of its own", () => {
        expect(playBotReachSeats(getCardByName("Burst of Energy"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4294: the gap was a stale verdict from before later Bot changes;
    // the search now casts a land destroyer that also draws, at both seats.
    // Pins reachability only (a legal, affordable cast is chosen), not the
    // `landPose` pose nor the draw valuation.
    it("played — a land destroyer that draws a card", () => {
        expect(playBotReachSeats(getCardByName("Implode"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4295: the gap was a stale verdict from before later Bot changes;
    // the search now casts a kicker land destroyer at both seats. Pins
    // reachability only (a legal, affordable cast is chosen), not the
    // `landPose` pose nor the kicked second target.
    it("played — a kicker land destroyer", () => {
        expect(playBotReachSeats(getCardByName("Dwarven Landslide"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4293: "untap all creatures you control" has nothing to untap on
    // a board of untapped creatures; the position gives the holder a tapped one
    // (CR 701.26b), and the Bot then casts it.
    it("played — an untap-all sweep over the holder's own creatures", () => {
        expect(playBotReachSeats(getCardByName("Vitalize"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4288: an untap spell whose target narrows keeps the pose that
    // narrowing asks for — Foxfire's attacking creature is posed in combat.
    it("played — an untap spell aimed at an attacking creature", () => {
        expect(playBotReachSeats(getCardByName("Foxfire"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4289: a storm pump instant with an {X}{X} cost. The gap was a
    // stale verdict from before the Bot's later changes: the search now casts
    // it in the first main phase on every seed, at both seats.
    it("played — a storm pump instant with an X cost", () => {
        expect(playBotReachSeats(getCardByName("Astral Steel"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4290: a modal instant (haste / pump / damage to a subtype-filtered
    // creature). The gap was a stale verdict from before the Bot's later
    // changes: the search now casts it at both seats. Pins reachability only
    // (a legal cast is chosen); valuer sensitivity and mode choice are not.
    it("played — a modal instant with haste, pump and subtype-damage modes", () => {
        expect(playBotReachSeats(getCardByName("Fever Charm"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);
});
