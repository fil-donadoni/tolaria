// "Exhaust —" heading an activated or a mana ability (CR 702.177a): a keyword,
// where every other word in that position is an ability word with no rules
// meaning, so the head survives as the ability's `exhaust` gate.
//
// The engine half is `convex/__tests__/exhaustAbility.test.ts`.
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";

function creature(name: string, oracleText: string): OracleCard {
    return {
        oracleId: "3221a000-0000-4000-8000-000000000001",
        name,
        manaCost: "{2}{G}",
        typeLine: "Creature — Elf Druid",
        oracleText,
        power: "2",
        toughness: "2",
        layout: "normal",
    };
}

function abilities(oracleText: string) {
    const outcome = compileCard(creature("Exhaust Probe", oracleText));
    if (outcome.state !== "ready") throw new Error(outcome.state);
    return outcome.definition.activatedAbilities;
}

describe('"Exhaust —" compiles to the once-only gate (CR 702.177a)', () => {
    it("on an activated ability", () => {
        expect(
            sortKeys(abilities("Exhaust — {U}, {T}: Draw three cards."))
        ).toEqual(
            sortKeys([
                {
                    id: "exhaust-probe-ability",
                    oracleText: "Exhaust — {U}, {T}: Draw three cards.",
                    cost: { mana: { U: 1 }, tap: true },
                    useStack: true,
                    effects: [{ op: "draw", player: "controller", count: 3 }],
                    exhaust: true,
                },
            ])
        );
    });

    it("on a mana ability, which still does not use the stack (CR 605.3b)", () => {
        expect(
            sortKeys(
                abilities(
                    "Exhaust — {G}, {T}: Add three mana of any one color."
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "exhaust-probe-mana",
                    oracleText:
                        "Exhaust — {G}, {T}: Add three mana of any one color.",
                    cost: { mana: { G: 1 }, tap: true },
                    useStack: false,
                    manaChoices: [
                        { W: 3 },
                        { U: 3 },
                        { B: 3 },
                        { R: 3 },
                        { G: 3 },
                    ],
                    exhaust: true,
                },
            ])
        );
    });

    it("gates only the line behind the head", () => {
        expect(
            abilities(
                "{G}, {T}: Draw a card.\nExhaust — {U}, {T}: Draw three cards."
            )?.map((a) => a.exhaust)
        ).toEqual([undefined, true]);
    });
});

describe("refused behind the head", () => {
    it.each([
        "Exhaust — {T}: Add {G}{G}.",
        "Exhaust — Draw a card.",
        "Exhaust — This creature has flying.",
        "During your turn, as long as you haven't activated an exhaust ability this turn, you may activate exhaust abilities as though they haven't been activated.",
    ])("%s", (line) => {
        expect(compileCard(creature("Exhaust Probe", line)).state).toBe(
            "unparsed"
        );
    });
});
