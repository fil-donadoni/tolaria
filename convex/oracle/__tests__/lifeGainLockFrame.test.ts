// The `restrictLifeGain` Verb Frame (issue #3239): "<player> can't gain life
// for the rest of the game" (CR 119.7 + CR 611.2a) — one frame, one Op.
//
//  1. GOLDEN — an announced player locked by a spell, compiled whole and
//     compared against the entire Compiled Definition (the damaged-player
//     form behind a trigger head is Stigma Lasher's `GOLDEN_FIXTURES` row).
//  2. REFUSALS — the neighbours the frame does not read ("this turn",
//     a sweep of players) pinned `unparsed`, so fail-closed is asserted.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

describe("restrictLifeGain frame — can't gain life for the rest of the game (CR 119.7, CR 611.2a)", () => {
    it("an announced player — spell slot", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Probe",
                manaCost: "{1}{R}",
                typeLine: "Sorcery",
                oracleText:
                    "Target player can't gain life for the rest of the game.",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Probe",
                types: ["Sorcery"],
                manaCost: { X: 1, R: 1 },
                oracleText:
                    "Target player can't gain life for the rest of the game.",
                effects: [{ op: "restrictLifeGain", player: { target: 0 } }],
                targetRequirement: { type: "player", count: 1 },
            })
        );
    });

    it.each([
        ["a turn-scoped lock", "Target player can't gain life this turn."],
        [
            "a sweep of players",
            "Players can't gain life for the rest of the game.",
        ],
    ])("refuses %s", (_label, oracleText) => {
        const outcome = compileCard(
            oracleCard({
                name: "Probe",
                manaCost: "{1}{R}",
                typeLine: "Sorcery",
                oracleText,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
