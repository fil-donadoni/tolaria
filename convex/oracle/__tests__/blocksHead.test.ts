// "When this creature blocks" — the self-subject block head (issue #9621,
// CR 509.3a).
//
//  1. GOLDENS — the one accepted form, on the two corpus cards whose body the
//     grammar already reads, compiled whole and compared with `sortKeys`
//     equality. Elder Land Wurm's indefinite `loseAbility` on `$source` is also
//     a `GOLDEN_FIXTURES` row: the canned smoke scenario cannot stage an Op on
//     the source, so the fixture is what lets the form reach `ready`.
//  2. REFUSALS — the neighbouring heads the row must NOT read, each behind a
//     body the accepted head compiles, so the refusal is the head's: the
//     "whenever" opener, a narrowed object ("blocks a creature"), the
//     "blocks or becomes blocked" pair, and any subject but the source.
//
// The engine half (does the rebuilt ability FIRE on the source's own block,
// and only on it?) is `gre/__tests__/compiledBlocksTrigger.test.ts`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const ELDER_LAND_WURM = {
    oracleId: "5948381a-419d-4b8b-8ea2-ea623cb0d606",
    name: "Elder Land Wurm",
    manaCost: "{4}{W}{W}{W}",
    typeLine: "Creature — Dragon Wurm",
    oracleText:
        "Defender, trample\nWhen this creature blocks, it loses defender.",
    power: "5",
    toughness: "5",
    layout: "normal",
};

const ZEPHYR_SPIRIT = {
    oracleId: "ff640343-6980-4668-a41f-0f01b0bbc0f2",
    name: "Zephyr Spirit",
    manaCost: "{5}{U}",
    typeLine: "Creature — Spirit",
    oracleText: "When this creature blocks, return it to its owner's hand.",
    power: "0",
    toughness: "6",
    layout: "normal",
};

function wall(oracleText: string) {
    return oracleCard({
        name: "Test Wall",
        manaCost: "{2}",
        typeLine: "Creature — Wall",
        oracleText,
        power: "0",
        toughness: "4",
    });
}

const refused = (card: ReturnType<typeof oracleCard>) =>
    compileCard(card).state === "unparsed";

describe("'when this creature blocks' head — goldens (CR 509.3a)", () => {
    it("Elder Land Wurm: the head lowers to `blocks`; 'it' is the source losing defender for good", () => {
        const outcome = compileCard(ELDER_LAND_WURM);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Elder Land Wurm",
                types: ["Creature"],
                subtypes: ["Dragon", "Wurm"],
                manaCost: { X: 4, W: 3 },
                power: 5,
                toughness: 5,
                oracleText:
                    "Defender, trample\nWhen this creature blocks, it loses defender.",
                staticAbilities: ["defender", "trample"],
                compiledTriggeredAbilities: [
                    {
                        id: "elder-land-wurm-trigger",
                        oracleText:
                            "When this creature blocks, it loses defender.",
                        head: { kind: "blocks" },
                        effects: [
                            {
                                op: "loseAbility",
                                target: { ref: "$source" },
                                ability: "defender",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("Zephyr Spirit: 'return it to its owner's hand' moves the blocking source", () => {
        const outcome = compileCard(ZEPHYR_SPIRIT);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Zephyr Spirit",
                types: ["Creature"],
                subtypes: ["Spirit"],
                manaCost: { X: 5, U: 1 },
                power: 0,
                toughness: 6,
                oracleText:
                    "When this creature blocks, return it to its owner's hand.",
                compiledTriggeredAbilities: [
                    {
                        id: "zephyr-spirit-trigger",
                        oracleText:
                            "When this creature blocks, return it to its owner's hand.",
                        head: { kind: "blocks" },
                        effects: [
                            {
                                op: "moveZone",
                                target: { ref: "$source" },
                                to: "hand",
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("'when this creature blocks' head — refusals (CR 509.3a)", () => {
    it("the control body compiles behind the accepted head", () => {
        expect(
            refused(
                wall(
                    "When this creature blocks, return it to its owner's hand."
                )
            )
        ).toBe(false);
    });

    it("refuses the 'whenever' opener: another key, not this row", () => {
        expect(
            refused(
                wall(
                    "Whenever this creature blocks, return it to its owner's hand."
                )
            )
        ).toBe(true);
    });

    it("refuses 'blocks a creature': the object narrows the condition", () => {
        expect(
            refused(
                wall(
                    "When this creature blocks a creature, return it to its owner's hand."
                )
            )
        ).toBe(true);
    });

    it("refuses 'blocks or becomes blocked': a second trigger condition (CR 509.3c)", () => {
        expect(
            refused(
                wall(
                    "When this creature blocks or becomes blocked, return it to its owner's hand."
                )
            )
        ).toBe(true);
    });

    it("refuses a subject other than the source", () => {
        expect(
            refused(
                wall("When a creature blocks, return it to its owner's hand.")
            )
        ).toBe(true);
        expect(
            refused(
                wall(
                    "When enchanted creature blocks, return it to its owner's hand."
                )
            )
        ).toBe(true);
    });
});
