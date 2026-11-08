// "Copy target instant or sorcery spell you control. You may choose new
// targets for the copy." (CR 707.10, CR 707.10c), issue #8580.
//
// Two layers:
//
//  1. GOLDEN forms — real corpus cards compiled whole must produce exactly the
//     Compiled Definition below: the copy sentence and its new-targets offer
//     fold into ONE `copySpell` Op on the announced spell.
//  2. REFUSALS — the neighbours this rule must NOT read: another stack phrase
//     behind the same verb, the copy without its new-targets offer, the offer
//     with no copy before it, and a second offer.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const COPY = "Copy target instant or sorcery spell you control.";
const OFFER = "You may choose new targets for the copy.";

const EFFECTS = [{ op: "copySpell", target: { target: 0 }, newTargets: true }];

const REQUIREMENT = {
    type: "spell",
    count: 1,
    spellTypeFilter: ["Instant", "Sorcery"],
    controller: "you",
};

describe("copy target instant or sorcery spell you control (CR 707.10, CR 707.10c)", () => {
    it("compiles Nivix Guildmage whole", () => {
        const text = `{1}{U}{R}: Draw a card, then discard a card.\n{2}{U}{R}: ${COPY} ${OFFER}`;
        const outcome = compileCard(
            oracleCard({
                name: "Nivix Guildmage",
                manaCost: "{U}{R}",
                typeLine: "Creature — Human Wizard",
                oracleText: text,
                power: "2",
                toughness: "2",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Nivix Guildmage",
                types: ["Creature"],
                subtypes: ["Human", "Wizard"],
                manaCost: { U: 1, R: 1 },
                power: 2,
                toughness: 2,
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "nivix-guildmage-ability",
                        oracleText:
                            "{1}{U}{R}: Draw a card, then discard a card.",
                        cost: { mana: { X: 1, U: 1, R: 1 } },
                        useStack: true,
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                            {
                                op: "choice",
                                kind: "choose-hand-card",
                                player: "controller",
                                zone: "hand",
                                count: 1,
                                prompt: "Discard a card.",
                                bind: "$discard1",
                            },
                            {
                                op: "discard",
                                player: "controller",
                                cards: { ref: "$discard1" },
                            },
                        ],
                    },
                    {
                        id: "nivix-guildmage-ability-2",
                        oracleText: `{2}{U}{R}: ${COPY} ${OFFER}`,
                        cost: { mana: { X: 2, U: 1, R: 1 } },
                        useStack: true,
                        effects: EFFECTS,
                        targetRequirement: REQUIREMENT,
                    },
                ],
            })
        );
    });

    it("compiles Rootha, Mercurial Artist whole, return-to-hand cost included", () => {
        const text = `{2}, Return Rootha to its owner's hand: ${COPY} ${OFFER}`;
        const outcome = compileCard(
            oracleCard({
                name: "Rootha, Mercurial Artist",
                manaCost: "{1}{U}{R}",
                typeLine: "Legendary Creature — Orc Shaman",
                oracleText: text,
                power: "1",
                toughness: "4",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Rootha, Mercurial Artist",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Orc", "Shaman"],
                manaCost: { X: 1, U: 1, R: 1 },
                power: 1,
                toughness: 4,
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "rootha-mercurial-artist-ability",
                        oracleText: `{2}, Return {self} to its owner's hand: ${COPY} ${OFFER}`,
                        cost: { mana: { X: 2 }, returnThisToHand: true },
                        useStack: true,
                        effects: EFFECTS,
                        targetRequirement: REQUIREMENT,
                    },
                ],
            })
        );
    });

    it("compiles Dual Casting whole, the copy inside a granted ability", () => {
        const granted = `{R}, {T}: ${COPY} ${OFFER}`;
        const text = `Enchant creature\nEnchanted creature has "${granted}"`;
        const outcome = compileCard(
            oracleCard({
                name: "Dual Casting",
                manaCost: "{1}{R}",
                typeLine: "Enchantment — Aura",
                oracleText: text,
                power: undefined,
                toughness: undefined,
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Dual Casting",
                types: ["Enchantment"],
                subtypes: ["Aura"],
                manaCost: { X: 1, R: 1 },
                oracleText: text,
                compiledStaticEffects: [
                    {
                        kind: "activated-grant",
                        appliesTo: "host",
                        abilityId: "dual-casting-granted",
                    },
                ],
                grantTemplates: [
                    {
                        id: "dual-casting-granted",
                        oracleText: granted,
                        cost: { mana: { R: 1 }, tap: true },
                        useStack: true,
                        effects: EFFECTS,
                        targetRequirement: REQUIREMENT,
                    },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });

    it.each([
        [
            "another stack phrase behind the verb",
            `{2}: Copy target creature spell you control. ${OFFER}`,
        ],
        [
            "a spell anyone controls",
            `{2}: Copy target instant or sorcery spell. ${OFFER}`,
        ],
        ["the copy without its new-targets offer", `{2}: ${COPY}`],
        ["the offer with no copy before it", `{2}: ${OFFER}`],
        ["the offer behind another effect", `{2}: Draw a card. ${OFFER}`],
        ["a second offer", `{2}: ${COPY} ${OFFER} ${OFFER}`],
    ])("refuses %s", (_label, text) => {
        expect(
            compileCard(oracleCard({ name: "Probe", oracleText: text })).state
        ).toBe("unparsed");
    });
});
