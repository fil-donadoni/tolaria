// The two Grammar Rules Impending's cards need (issue #1970): the
// "Impending N—[cost]" keyword line (CR 702.176a) and the "whenever this
// permanent enters or attacks" trigger head (CR 603.2).
//
//  1. GOLDENS — real corpus cards compiled whole: the cost lands on
//     `impending`, N on the `"impending N"` keyword string the `getDefinition`
//     seam expands (Overlord of the Mistmoors), and the head is ONE
//     descriptor over both events (Grave Titan).
//  2. REFUSALS — the neighbours each rule must NOT read: a zero or variable
//     count, a cost the payment path cannot pay, a second declaration; a head
//     whose subject is another permanent.
//
// The engine half (does the expanded keyword and the rebuilt ability behave?)
// is `convex/gre/__tests__/impending.test.ts`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import type { OracleCard } from "../types";
import { oracleCard, parseContext } from "./oracle.fixture";

/** Overlord of the Mistmoors' corpus row, verbatim. */
const OVERLORD_OF_THE_MISTMOORS: OracleCard = {
    oracleId: "7e64b1dc-a238-4bff-98ff-2bea44340568",
    name: "Overlord of the Mistmoors",
    manaCost: "{5}{W}{W}",
    typeLine: "Enchantment Creature — Avatar Horror",
    oracleText:
        "Impending 4—{2}{W}{W} (If you cast this spell for its impending cost, it enters with four time counters and isn't a creature until the last is removed. At the beginning of your end step, remove a time counter from it.)\nWhenever this permanent enters or attacks, create two 2/1 white Insect creature tokens with flying.",
    power: "6",
    toughness: "6",
    layout: "normal",
};

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const readLine = (line: string) => keywordLineSlot.run(line, parseContext());

const headProbe = (head: string) =>
    oracleCard({
        name: "Probe",
        manaCost: "{4}{B}",
        typeLine: "Creature — Zombie",
        power: "4",
        toughness: "4",
        oracleText: `${head}, create two 2/2 black Zombie creature tokens.`,
    });

describe("Impending N—[cost] (CR 702.176a)", () => {
    it("Overlord of the Mistmoors: the cost lands on `impending`, N on the keyword string", () => {
        const def = compiled(OVERLORD_OF_THE_MISTMOORS);
        expect(def.impending).toEqual({
            id: "impending",
            description: "Impending 4—{2}{W}{W}",
            mana: { X: 2, W: 2 },
        });
        expect(def.staticAbilities).toEqual(["impending 4"]);
    });

    it("reads each printed count and cost (Overlord of the Balemurk's 5—{1}{B})", () => {
        const parsed = readLine("Impending 5—{1}{B}");
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "impending") {
            expect(parsed.value.count).toBe(5);
            expect(parsed.value.cost).toEqual({ X: 1, B: 1 });
        }
    });

    it.each([
        ["a zero count", "Impending 0—{1}{B}"],
        ["a variable count", "Impending X—{1}{B}"],
        ["no cost", "Impending 5"],
        ["a variable {X} cost", "Impending 5—{X}{B}"],
        ["a hybrid cost", "Impending 5—{1}{B/G}"],
        ["a non-mana cost", "Impending 5—Pay 3 life."],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });

    it("REFUSES a card declaring impending twice", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Probe",
                manaCost: "{3}{B}{B}",
                typeLine: "Enchantment Creature — Avatar",
                power: "5",
                toughness: "5",
                oracleText: "Impending 5—{1}{B}\nImpending 4—{2}{B}",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe('"Whenever this permanent enters or attacks" (CR 603.2)', () => {
    it("Grave Titan: ONE descriptor over the source's entry and its attack", () => {
        const def = compiled(
            oracleCard({
                name: "Grave Titan",
                manaCost: "{4}{B}{B}",
                typeLine: "Creature — Giant",
                power: "6",
                toughness: "6",
                oracleText:
                    "Deathtouch\nWhenever this creature enters or attacks, create two 2/2 black Zombie creature tokens.",
            })
        );
        expect(def.compiledTriggeredAbilities).toHaveLength(1);
        expect(def.compiledTriggeredAbilities?.[0]?.head).toEqual({
            kind: "enters-or-attacks",
        });
    });

    it("reads the permanent spelling the Overlords print", () => {
        const def = compiled(
            headProbe("Whenever this permanent enters or attacks")
        );
        expect(def.compiledTriggeredAbilities?.[0]?.head).toEqual({
            kind: "enters-or-attacks",
        });
    });

    it.each([
        ["another creature", "Whenever another creature enters or attacks"],
        [
            "a creature you control",
            "Whenever a creature you control enters or attacks",
        ],
        ["the inverse order", "Whenever this creature attacks or enters"],
    ])("REFUSES a head over %s", (_why, head) => {
        expect(compileCard(headProbe(head)).state).toBe("unparsed");
    });
});
