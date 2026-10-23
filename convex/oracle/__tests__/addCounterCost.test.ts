// "Put a -N/-N counter on this creature" activation cost (CR 122.1, 118.1).
//
// 1. GOLDEN — real corpus rows compiled whole: Devoted Druid (a stack ability
//    beside its {T} mana ability) and Wall of Roots (a tap-less mana ability
//    with the CR 602.5b once-per-turn rider).
// 2. REFUSALS — neighbours the rule must NOT read, so fail-closed is pinned.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { activationCostRule } from "../grammar/shared/cost";
import { oracleCard, parseContext } from "./oracle.fixture";

function creature(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{1}{G}",
        typeLine: "Creature — Plant Wall",
        oracleText,
        power: "0",
        toughness: "5",
    });
}

const DRUID_TEXT =
    "{T}: Add {G}.\nPut a -1/-1 counter on this creature: Untap this creature.";
const WALL_TEXT =
    "Defender\nPut a -0/-1 counter on this creature: Add {G}. Activate only once each turn.";

describe("Put-a-counter cost — golden (CR 122.1, 118.1)", () => {
    it("Devoted Druid: lowers to cost.addCounter on a stack ability", () => {
        const outcome = compileCard(creature("Devoted Druid", DRUID_TEXT));
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition).toEqual({
            name: "Devoted Druid",
            types: ["Creature"],
            subtypes: ["Plant", "Wall"],
            manaCost: { X: 1, G: 1 },
            power: 0,
            toughness: 5,
            oracleText: DRUID_TEXT,
            activatedAbilities: [
                {
                    id: "devoted-druid-mana",
                    oracleText: "{T}: Add {G}.",
                    cost: { tap: true },
                    useStack: false,
                    manaProduced: { G: 1 },
                },
                {
                    id: "devoted-druid-ability-2",
                    oracleText:
                        "Put a -1/-1 counter on this creature: Untap this creature.",
                    cost: { addCounter: { type: "-1/-1", count: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "tapUntap",
                            action: "untap",
                            target: { ref: "$source" },
                        },
                    ],
                },
            ],
        });
    });

    it("Wall of Roots: a tap-less mana ability, once per turn", () => {
        const outcome = compileCard(creature("Wall of Roots", WALL_TEXT));
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition).toEqual({
            name: "Wall of Roots",
            types: ["Creature"],
            subtypes: ["Plant", "Wall"],
            manaCost: { X: 1, G: 1 },
            power: 0,
            toughness: 5,
            oracleText: WALL_TEXT,
            staticAbilities: ["defender"],
            activatedAbilities: [
                {
                    id: "wall-of-roots-mana",
                    oracleText:
                        "Put a -0/-1 counter on this creature: Add {G}. Activate only once each turn.",
                    cost: { addCounter: { type: "-0/-1", count: 1 } },
                    useStack: false,
                    manaProduced: { G: 1 },
                    oncePerTurn: true,
                },
            ],
        });
    });

    it("reads a counted atom", () => {
        const parsed = activationCostRule.run(
            "Put two -1/-1 counters on this creature",
            parseContext(creature("Source", ""))
        );
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.atoms).toEqual([
            { kind: "add-counter", counter: "-1/-1", count: 2 },
        ]);
    });
});

describe("Put-a-counter cost — refusals", () => {
    it.each([
        "Put a -1/-1 counter on target creature",
        "Put a -1/-1 counter on another creature you control",
        "Put a counter on this creature",
        "Put X -1/-1 counters on this creature",
    ])("refuses the cost %s", (span) => {
        expect(
            activationCostRule.run(span, parseContext(creature("Source", "")))
                .ok
        ).toBe(false);
    });

    it("a tapping mana ability keeps the once-per-turn rider unparsed (the tap route never enforces it)", () => {
        const outcome = compileCard(
            creature("Source", "{T}: Add {G}. Activate only once each turn.")
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("a mana ability with an unknown rider sentence stays unparsed", () => {
        const outcome = compileCard(
            creature(
                "Source",
                "Put a -0/-1 counter on this creature: Add {G}. Activate only twice each turn."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});
