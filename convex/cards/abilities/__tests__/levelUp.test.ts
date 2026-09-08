// `levelBandStatics` band-set validation (CR 711.2, issue #2386).
//
// The bands a leveler card declares must be ordered, mutually exclusive, and
// open-ended only in the LAST symbol. Neither failure mode is visible in a
// game: two overlapping bands emit two layer-7b `pt-set`s from the SAME source
// with the SAME CR 613.7a timestamp — an unordered tie whose winner is
// whichever the derivation happens to visit last — and a level ABOVE a closed
// final band silently falls back to the printed P/T, which is CR 711.5's
// answer for a level BELOW the first band and means nothing above the last.
// So the factory refuses at construction time, which is module load: a
// malformed leveler is a red catalogue, never a permanent with racing effects.

import { describe, expect, it } from "vitest";
import { levelBandStatics, levelUpAbility, LEVEL_COUNTER } from "../levelUp";

const OPEN = { min: 8, power: 6, toughness: 6 };

describe("levelBandStatics — band-set validation (CR 711.2)", () => {
    it("accepts the printed two-symbol shape and emits one effect per clause", () => {
        const effects = levelBandStatics([
            {
                min: 3,
                max: 7,
                power: 4,
                toughness: 4,
                abilities: ["protection from instants"],
            },
            { ...OPEN, abilities: ["protection from everything"] },
        ]);
        // Two bands × (one `pt-set` + one `keyword-grant`).
        expect(effects.map((e) => e.kind)).toEqual([
            "pt-set",
            "keyword-grant",
            "pt-set",
            "keyword-grant",
        ]);
    });

    it("CR 711.1 — refuses an empty band set", () => {
        expect(() => levelBandStatics([])).toThrow(/at least one LEVEL symbol/);
    });

    it("CR 711.2b — refuses a CLOSED final band", () => {
        expect(() =>
            levelBandStatics([{ min: 8, max: 9, power: 6, toughness: 6 }])
        ).toThrow(/last LEVEL symbol must be open-ended/);
    });

    it("CR 711.2b — refuses an open-ended band that is not the last", () => {
        expect(() =>
            levelBandStatics([{ min: 3, power: 4, toughness: 4 }, OPEN])
        ).toThrow(/only the last LEVEL symbol may be open-ended/);
    });

    it("CR 711.2 — refuses overlapping or out-of-order bands", () => {
        expect(() =>
            levelBandStatics([{ min: 3, max: 8, power: 4, toughness: 4 }, OPEN])
        ).toThrow(/overlap or are out of order/);
        expect(() =>
            levelBandStatics([
                { min: 9, max: 10, power: 4, toughness: 4 },
                OPEN,
            ])
        ).toThrow(/overlap or are out of order/);
    });

    it("CR 711.2a — refuses an empty range", () => {
        expect(() =>
            levelBandStatics([{ min: 7, max: 3, power: 4, toughness: 4 }])
        ).toThrow(/empty range/);
    });
});

describe("levelUpAbility (CR 702.87a)", () => {
    it("builds the sorcery-speed counter-adding ability the rule spells out", () => {
        const ability = levelUpAbility({ cost: { X: 1 }, costLabel: "{1}" });
        expect(ability.sorcerySpeedOnly).toBe(true);
        expect(ability.useStack).toBe(true);
        expect(ability.effects).toEqual([
            {
                op: "counters",
                action: "add",
                counter: LEVEL_COUNTER,
                target: { ref: "$source" },
                count: 1,
            },
        ]);
    });
});
