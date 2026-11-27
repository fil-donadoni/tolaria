// A later spell sentence's "It" names the one target an earlier sentence
// announced (CR 608.2c, CR 608.2h): "Untap target creature. It gets +3/+3
// until end of turn." Read by `announcedTargetPronounRule` (spell slot and
// modal bullets) as the `announced-pronoun` subject, resolved to `{ target: 0 }`
// by `selectorsFor` only when the slot still names the object.
//
//  1. GOLDENS — one per verb class the corpus prints after the antecedent: a
//     pump after an untap, a keyword grant after a counter, a modal mode.
//  2. REFUSALS — every neighbour where the slot is not the referent: the
//     target moved to the battlefield (a new object, CR 400.7), destroyed, an
//     object introduced in between, two announced targets, no target at all.
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";

describe("announced-target pronoun — goldens (CR 608.2c)", () => {
    it("Gerrard's Command — a pump on the untapped target", () => {
        const outcome = compileCard({
            oracleId: "de8ebe4b-d86d-478b-946e-f83e1409b63f",
            name: "Gerrard's Command",
            manaCost: "{G}{W}",
            typeLine: "Instant",
            oracleText:
                "Untap target creature. It gets +3/+3 until end of turn.",
            layout: "normal",
        });
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Gerrard's Command",
                types: ["Instant"],
                manaCost: { W: 1, G: 1 },
                oracleText:
                    "Untap target creature. It gets +3/+3 until end of turn.",
                effects: [
                    { op: "tapUntap", action: "untap", target: { target: 0 } },
                    {
                        op: "pump",
                        target: { target: 0 },
                        power: 3,
                        toughness: 3,
                        duration: { phase: "end-of-turn" },
                    },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });
    it("Snakeskin Veil — a grant on the countered target", () => {
        const outcome = compileCard({
            oracleId: "1e6a24be-8281-41c1-a5ba-b68f0ef1d7b8",
            name: "Snakeskin Veil",
            manaCost: "{G}",
            typeLine: "Instant",
            oracleText:
                "Put a +1/+1 counter on target creature you control. It gains hexproof until end of turn. (It can't be the target of spells or abilities your opponents control.)",
            layout: "normal",
        });
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Snakeskin Veil",
                types: ["Instant"],
                manaCost: { G: 1 },
                oracleText:
                    "Put a +1/+1 counter on target creature you control. It gains hexproof until end of turn. (It can't be the target of spells or abilities your opponents control.)",
                effects: [
                    {
                        op: "counters",
                        action: "add",
                        counter: "+1/+1",
                        target: { target: 0 },
                        count: 1,
                    },
                    {
                        op: "grantAbility",
                        target: { target: 0 },
                        ability: "hexproof",
                        duration: { phase: "end-of-turn" },
                    },
                ],
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    controller: "you",
                },
            })
        );
    });
    it("Moment of Valor — inside a modal mode", () => {
        const outcome = compileCard({
            oracleId: "bfac8072-2bbc-43ca-b141-9cd0799840f7",
            name: "Moment of Valor",
            manaCost: "{2}{W}",
            typeLine: "Instant",
            oracleText:
                "Choose one —\n• Untap target creature. It gets +1/+0 and gains indestructible until end of turn.\n• Destroy target creature with power 4 or greater.",
            layout: "normal",
        });
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Moment of Valor",
                types: ["Instant"],
                manaCost: { X: 2, W: 1 },
                oracleText:
                    "Choose one —\n• Untap target creature. It gets +1/+0 and gains indestructible until end of turn.\n• Destroy target creature with power 4 or greater.",
                modes: [
                    {
                        id: "moment-of-valor-mode-1",
                        label: "Untap target creature. It gets +1/+0 and gains indestructible until end of turn",
                        oracleText:
                            "Untap target creature. It gets +1/+0 and gains indestructible until end of turn.",
                        effects: [
                            {
                                op: "tapUntap",
                                action: "untap",
                                target: { target: 0 },
                            },
                            {
                                op: "pump",
                                target: { target: 0 },
                                power: 1,
                                toughness: 0,
                                duration: { phase: "end-of-turn" },
                            },
                            {
                                op: "grantAbility",
                                target: { target: 0 },
                                ability: "indestructible",
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                        targetRequirement: { type: "Creature", count: 1 },
                    },
                    {
                        id: "moment-of-valor-mode-2",
                        label: "Destroy target creature with power 4 or greater",
                        oracleText:
                            "Destroy target creature with power 4 or greater.",
                        effects: [{ op: "destroy", target: { target: 0 } }],
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            powerFilter: { min: 4 },
                        },
                    },
                ],
            })
        );
    });
});

describe("announced-target pronoun — refused neighbours (CR 608.2h, CR 400.7)", () => {
    it("a player target is not the object the pronoun names", () => {
        const outcome = compileCard({
            oracleId: "00000000-0000-0000-0000-000000000000",
            name: "Test Spell",
            manaCost: "{1}{G}",
            typeLine: "Sorcery",
            oracleText:
                "Target player draws a card. It gets +1/+1 until end of turn.",
            layout: "normal",
        });
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.reason)).toContainEqual(
            expect.stringMatching(/one permanent target/)
        );
    });
    it("Bond of Revival: the target was moved onto the battlefield, a new object", () => {
        const outcome = compileCard({
            oracleId: "62cca25f-3bf7-4b67-97d5-280bf2544722",
            name: "Bond of Revival",
            manaCost: "{4}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Return target creature card from your graveyard to the battlefield. It gains haste until your next turn.",
            layout: "normal",
        });
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.reason)).toContainEqual(
            expect.stringMatching(/moved the announced target/)
        );
    });
    it("a destroyed target is no longer where the slot points", () => {
        const outcome = compileCard({
            oracleId: "00000000-0000-0000-0000-000000000000",
            name: "Test Spell",
            manaCost: "{1}{G}",
            typeLine: "Instant",
            oracleText:
                "Destroy target creature. It gains flying until end of turn.",
            layout: "normal",
        });
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.reason)).toContainEqual(
            expect.stringMatching(/moved the announced target/)
        );
    });
    it("an object put onto the battlefield is the nearer antecedent", () => {
        const outcome = compileCard({
            oracleId: "00000000-0000-0000-0000-000000000000",
            name: "Test Spell",
            manaCost: "{1}{G}",
            typeLine: "Sorcery",
            oracleText:
                "Create a 1/1 white Rabbit creature token. It gains haste until end of turn.",
            layout: "normal",
        });
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.reason)).toContainEqual(
            expect.stringMatching(/nearer antecedent/)
        );
    });
    it("no target announced before the pronoun", () => {
        const outcome = compileCard({
            oracleId: "00000000-0000-0000-0000-000000000000",
            name: "Test Spell",
            manaCost: "{1}{G}",
            typeLine: "Instant",
            oracleText: "It gets +2/+2 until end of turn.",
            layout: "normal",
        });
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.reason)).toContainEqual(
            expect.stringMatching(/not exactly one/)
        );
    });
    it("a second target announced in the pronoun's own sentence (Savage Smash)", () => {
        const outcome = compileCard({
            oracleId: "676c0315-1cb3-4d80-b136-16d88fd612cb",
            name: "Savage Smash",
            manaCost: "{1}{R}{G}",
            typeLine: "Sorcery",
            oracleText:
                "Target creature you control gets +2/+2 until end of turn. It fights target creature you don't control. (Each deals damage equal to its power to the other.)",
            layout: "normal",
        });
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.reason)).toContainEqual(
            expect.stringMatching(/fight/)
        );
    });
});
