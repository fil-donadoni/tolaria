// Gift: the "Gift a [something]" keyword line, "if the gift was promised" and
// "whenever you give a gift" (CR 702.174).
//
//  1. GOLDEN fixtures — real corpus cards compiled whole: Scrapshooter (a
//     permanent's gift and its promised ETB) and Jolly Gerbils (the
//     give-a-gift head).
//  2. FORMS — every accepted "Gift a [something]" line, read off the card
//     that prints it.
//  3. LOWERING — where the second ability goes (CR 702.174b): a twin trigger
//     on a permanent, the first Op of the Effect Script on an instant or
//     sorcery (CR 702.174j).
//  4. REFUSALS — gifts no fixture reads, the promise read behind a cast head,
//     and a spell clause that reads the promise.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import { oracleCard, parseContext } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function unparsedLines(card: ReturnType<typeof oracleCard>): string[] {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed") return [];
    return outcome.gaps.map((gap) => gap.line);
}

describe("Gift — golden fixtures (CR 702.174a/b/c/k)", () => {
    it("Scrapshooter: the gift cost, its twin trigger and the promised ETB", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Scrapshooter"
        );
        expect(fixture?.rule).toBe("gift");
        const outcome = compileCard(fixture!.card);
        // The registered fixture clears the smoke skip: the canned scenario
        // casts with the gift unpaid.
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(fixture!.expected)
        );
    });

    it("Jolly Gerbils: 'Whenever you give a gift' is the GIFT_GIVEN head", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Jolly Gerbils",
                manaCost: "{1}{W}",
                typeLine: "Creature — Hamster Citizen",
                oracleText: "Whenever you give a gift, draw a card.",
                power: "2",
                toughness: "3",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Jolly Gerbils",
                types: ["Creature"],
                subtypes: ["Hamster", "Citizen"],
                manaCost: { X: 1, W: 1 },
                power: 2,
                toughness: 3,
                oracleText: "Whenever you give a gift, draw a card.",
                compiledTriggeredAbilities: [
                    {
                        id: "jolly-gerbils-trigger",
                        oracleText: "Whenever you give a gift, draw a card.",
                        head: { kind: "gift-given", scope: "you" },
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
            })
        );
    });
});

describe("Gift — accepted forms (CR 702.174d/e/f/h)", () => {
    it.each([
        ["Gift a card", "card", "Scrapshooter"],
        ["Gift a Food", "food", "Crumb and Get It"],
        ["Gift a tapped Fish", "tapped-fish", "Mind Spiral"],
        ["Gift a Treasure", "treasure", "Blooming Blast"],
    ])("%s (%s, as %s prints it)", (line, gift) => {
        const parsed = keywordLineSlot.run(line, parseContext());
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value).toEqual({ kind: "gift", gift });
    });

    it.each([
        // CR 702.174e on a sorcery: the gift line is read, the body is not.
        [
            "Wear Down",
            "{1}{G}",
            "Sorcery",
            "Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nDestroy target artifact or enchantment. If the gift was promised, instead destroy two target artifacts and/or enchantments.",
        ],
        // CR 702.174f on an Equipment.
        [
            "Starforged Sword",
            "{4}",
            "Artifact — Equipment",
            "Gift a tapped Fish (You may promise an opponent a gift as you cast this spell. If you do, when it enters, they create a tapped 1/1 blue Fish creature token.)\nWhen this Equipment enters, if the gift was promised, attach this Equipment to target creature you control.\nEquipped creature gets +3/+3 and loses flying.\nEquip {3}",
        ],
    ])(
        "%s: its gift line is never the refused one",
        (name, manaCost, typeLine, oracleText) => {
            const lines = unparsedLines(
                oracleCard({
                    name,
                    manaCost,
                    typeLine,
                    oracleText,
                    power: undefined,
                    toughness: undefined,
                })
            );
            expect(lines.length).toBeGreaterThan(0);
            expect(lines.filter((l) => l.startsWith("Gift"))).toEqual([]);
        }
    );
});

describe("Gift — lowering places the second ability (CR 702.174b/j)", () => {
    it("an instant's gift ability opens its Effect Script", () => {
        const def = compiled(
            oracleCard({
                name: "Test Gift Spell",
                manaCost: "{U}",
                typeLine: "Instant",
                oracleText: "Gift a Treasure\nDraw a card.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(def.kickers).toEqual([
            { id: "gift", keyword: "gift", description: "Gift a Treasure" },
        ]);
        expect(def.compiledTriggeredAbilities).toBeUndefined();
        expect(def.effects?.[0]).toMatchObject({
            op: "if",
            predicate: { left: { additionalCostPaid: "gift" } },
            then: [{ op: "createToken", controller: "opponent" }],
        });
        expect(def.effects?.[1]).toEqual({
            op: "draw",
            player: "controller",
            count: 1,
        });
    });

    it("a permanent's gift is a twin trigger, and the tapped Fish enters tapped (CR 702.174f)", () => {
        const def = compiled(
            oracleCard({
                name: "Test Gift Bear",
                manaCost: "{1}{G}",
                typeLine: "Creature — Bear",
                oracleText: "Gift a tapped Fish",
                power: "2",
                toughness: "2",
            })
        );
        expect(def.effects).toBeUndefined();
        const [twin] = def.compiledTriggeredAbilities ?? [];
        expect(twin?.additionalCostTwin).toEqual({
            keyword: "gift",
            costId: "gift",
        });
        expect(twin?.effects).toEqual([
            {
                op: "if",
                predicate: {
                    left: { additionalCostPaid: "gift" },
                    op: "ge",
                    right: 1,
                },
                then: [
                    {
                        op: "createToken",
                        token: {
                            name: "Fish",
                            types: ["Creature"],
                            subtypes: ["Fish"],
                            power: 1,
                            toughness: 1,
                            colors: ["U"],
                            entersTapped: true,
                        },
                        controller: "opponent",
                    },
                ],
            },
        ]);
    });
});

describe("Gift — refusals (fail-closed, ADR 0105 § 2)", () => {
    it.each([
        // CR 702.174g / 702.174i — delivered by the engine template, read by
        // no fixture yet.
        "Gift an extra turn",
        "Gift an Octopus",
        // No CR 702.174 subrule defines it.
        "Gift a Rhystic Study",
    ])("%s is refused", (line) => {
        expect(keywordLineSlot.run(line, parseContext()).ok).toBe(false);
    });

    it("the promise behind a cast head is no gate", () => {
        const lines = unparsedLines(
            oracleCard({
                name: "Test Gift Caster",
                manaCost: "{1}{G}",
                typeLine: "Creature — Bear",
                oracleText:
                    "Gift a card\nWhen you cast this spell, if the gift was promised, draw a card.",
                power: "2",
                toughness: "2",
            })
        );
        expect(lines).toContain(
            "When you cast this spell, if the gift was promised, draw a card."
        );
    });

    it("'if the gift was promised' with no gift line links to nothing", () => {
        const lines = unparsedLines(
            oracleCard({
                name: "Test Promise",
                manaCost: "{1}{G}",
                typeLine: "Creature — Bear",
                oracleText:
                    "When this creature enters, if the gift was promised, draw a card.",
                power: "2",
                toughness: "2",
            })
        );
        expect(lines.length).toBe(1);
    });

    it("a spell clause reading the promise stays refused (Wear Down's body)", () => {
        const lines = unparsedLines(
            oracleCard({
                name: "Wear Down",
                manaCost: "{1}{G}",
                typeLine: "Sorcery",
                oracleText:
                    "Gift a card\nDestroy target artifact or enchantment. If the gift was promised, instead destroy two target artifacts and/or enchantments.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(lines).toEqual([
            "Destroy target artifact or enchantment. If the gift was promised, instead destroy two target artifacts and/or enchantments.",
        ]);
    });
});
