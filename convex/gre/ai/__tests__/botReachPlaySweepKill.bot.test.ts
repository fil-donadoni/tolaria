// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — a destroying sweep on every battlefield.
// One fixture per outcome on the generated position; the sweep itself runs over the whole
// `ready` set in `oracle:compile`, these files are the evidence its verdicts
// mean what the lockfile says (split by cost, issue #6148).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { BOT_REACH_BUDGET, playBotReach, playBotReachSeats } from "../botReach";
import { castleCount } from "./botReachPlay.fixture";

describe("Bot-play sweep (ADR 0105 § 7.2) — a destroying sweep on every battlefield", () => {
    it("played — a destroying sweep of every battlefield is posed with the opponent ahead", () => {
        // Issue #4157. A symmetric wipe on a symmetric board is CORRECT to
        // pass on (it costs the card and destroys as much of the holder's as
        // of the opponent's), so the generated position gives the opponent a
        // surplus of whatever the card destroys: creatures, enchantments,
        // lands.
        // Issue #4781 — one card per family the hand term now reads off the
        // board: a colour-filtered bounce, a damage sweep, a subtype-filtered
        // destroy.
        // Issue #6030 — an enchantment sweep is posed against an inert
        // enchantment, not Castle: a buff the sweep itself removes made
        // casting after an attack tie casting now.
        for (const name of [
            "Day of Judgment",
            "Tranquility",
            "Armageddon",
            "Hibernation",
            "Pyroclasm",
            "Flashfires",
        ] as const) {
            expect(playBotReach(getCardByName(name)), name).toEqual({
                outcome: "played",
            });
        }
    });

    // Issue #6030 — the verdict above reads `played` if ANY seed at ANY seat
    // chose the card, so it held for Tranquility by noise alone once the CR
    // 704.5g SBA made a Castle-propped blocker die to the sweep after combat
    // (seed 0xb07 passed at both seats). Each BUDGET seed on its own, at both
    // seats, is the claim the pose makes: posed against an enchantment whose
    // loss reaches no creature, casting now beats attacking first. Not every
    // seed: over 20 ad-hoc seeds 2 of 40 seat-seeds still pass.
    it("an enchantment sweep is played on each budget seed at both seats, with no Castle in its position", () => {
        const tranquility = getCardByName("Tranquility");
        expect(castleCount(tranquility, 0)).toBe(0);
        expect(castleCount(tranquility, 1)).toBe(0);
        for (const seed of BOT_REACH_BUDGET.seeds) {
            const seats = playBotReachSeats(tranquility, {
                iterations: BOT_REACH_BUDGET.iterations,
                seeds: [seed],
            });
            expect(
                seats.map((s) => s.verdict.outcome),
                `seed ${seed}`
            ).toEqual(["played", "played"]);
        }
    });
});
