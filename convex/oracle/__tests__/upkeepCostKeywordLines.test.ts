// Echo and Cumulative upkeep keyword lines (CR 702.30a, 702.24a; ADR 0155,
// issue #5505).
//
//  1. GOLDENS — a real corpus card per accepted form, compiled whole: the cost
//     lands on `echo` / `cumulativeUpkeep`, which the `getDefinition` expander
//     turns into the upkeep trigger. No `GOLDEN_FIXTURES` row: every form here
//     reaches `ready` through the smoke generator.
//  2. REFUSALS — the neighbours the rules must NOT read: a per-counter cost
//     choice (CR 702.24a), a cost the payment path cannot pay or label, and a
//     second declaration.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import { oracleCard, parseContext } from "./oracle.fixture";

function readLine(line: string) {
    return keywordLineSlot.run(line, parseContext());
}

const CU_REMINDER =
    "(At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)";

describe("Echo [cost] (CR 702.30a)", () => {
    it("Goblin Patrol: the cost lands on `echo`", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Goblin Patrol",
                manaCost: "{R}",
                typeLine: "Creature — Goblin",
                power: "2",
                toughness: "1",
                oracleText:
                    "Echo {R} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition).toEqual({
            name: "Goblin Patrol",
            types: ["Creature"],
            subtypes: ["Goblin"],
            manaCost: { R: 1 },
            power: 2,
            toughness: 1,
            oracleText:
                "Echo {R} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)",
            echo: { R: 1 },
        });
    });

    it.each([
        ["a variable cost", "Echo {X}"],
        ["a hybrid pip", "Echo {W/U}"],
        ["a Phyrexian pip", "Echo {B/P}"],
        ["a non-mana cost", "Echo—Discard a card."],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });

    it("REFUSES a card declaring echo twice", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Double Echo",
                oracleText: "Echo {1}\nEcho {2}",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("Cumulative upkeep [cost] (CR 702.24a)", () => {
    it("Illusionary Wall: a mana cost lands on `cumulativeUpkeep`", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Illusionary Wall",
                manaCost: "{3}{U}",
                typeLine: "Creature — Wall",
                power: "7",
                toughness: "4",
                oracleText: `Defender, flying\nCumulative upkeep {U} ${CU_REMINDER}`,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition).toEqual({
            name: "Illusionary Wall",
            types: ["Creature"],
            subtypes: ["Wall"],
            manaCost: { X: 3, U: 1 },
            power: 7,
            toughness: 4,
            oracleText: `Defender, flying\nCumulative upkeep {U} ${CU_REMINDER}`,
            staticAbilities: ["defender", "flying"],
            cumulativeUpkeep: { U: 1 },
        });
    });

    it("Gallowbraid: the dashed life form lands as a life leg", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Gallowbraid",
                manaCost: "{3}{B}{B}",
                typeLine: "Legendary Creature — Phyrexian Horror",
                power: "5",
                toughness: "5",
                oracleText: `Trample\nCumulative upkeep—Pay 1 life. ${CU_REMINDER}`,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.cumulativeUpkeep).toEqual({ life: 1 });
        expect(outcome.definition.staticAbilities).toEqual(["trample"]);
    });

    it.each([
        [
            "a per-counter cost choice (CR 702.24a)",
            "Cumulative upkeep {W} or {U}",
        ],
        ["a variable cost", "Cumulative upkeep {X}"],
        ["a mixed mana-and-life cost", "Cumulative upkeep—Pay {B} and 1 life."],
        ["a zero life cost", "Cumulative upkeep—Pay 0 life."],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });

    it("REFUSES a card declaring cumulative upkeep twice", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Double Upkeep",
                oracleText: "Cumulative upkeep {1}\nCumulative upkeep {2}",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
