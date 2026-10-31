// The gendered pronouns Oracle prints on a named character — "he" / "she" /
// "him" / "her" — read as spellings of "it", bound by the SAME anaphora the
// site already applies to "it" (CR 608.2h, issue #7627).
//
//  1. GOLDENS — one real corpus card per accepted form, its whole Compiled
//     Definition: the sentence-leading subject pronoun behind a trigger head
//     ("he" Momo, "she" The Wasp) and an activated cost (Darwin); the object
//     pronoun ("her" Mockingbird, "him" Zuko's line); the entry replacement's
//     "counter on him / her" (The Duke's and Arwen's lines).
//  2. BINDING — a gendered pronoun compiles to exactly what "it" compiles to
//     at the same site: the source behind a self head, the combatant behind a
//     per-creature head, nothing behind a head that names no object.
//  3. REFUSALS — the neighbours with no "it" reading at their site: the
//     possessive "her controller" (Liliana's Defeat), the player pronoun
//     "he or she" (Power Struggle), the contraction "he's" (Whiplash), and an
//     X count the entry replacement does not read for "it" either (Big Bertha).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

function creature(card: Partial<OracleCard>): OracleCard {
    return oracleCard({ layout: "normal", ...card });
}

function definitionOf(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} did not compile: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome;
}

const MOMO = creature({
    oracleId: "8854222e-590f-4fc0-b5d7-bf3d986b8507",
    name: "Momo, Rambunctious Rascal",
    manaCost: "{2}{W}",
    typeLine: "Legendary Creature — Lemur Bat Ally",
    oracleText:
        "Flying (This creature can't be blocked except by creatures with flying or reach.)\nWhen Momo enters, he deals 4 damage to target tapped creature an opponent controls.",
    power: "1",
    toughness: "1",
});

const THE_WASP = creature({
    oracleId: "8d35c7c8-1342-40b7-82ec-2f7973ee8af8",
    name: "The Wasp, Janet Van Dyne",
    manaCost: "{2}{W}",
    typeLine: "Legendary Creature — Human Hero",
    oracleText:
        "Flying (This creature can't be blocked except by creatures with flying or reach.)\nWhen The Wasp enters, she deals 4 damage to target tapped creature an opponent controls.",
    power: "1",
    toughness: "1",
});

const DARWIN = creature({
    oracleId: "4061572b-b7ff-4d06-9f71-9e66e064593d",
    name: "Darwin, Adaptive Mutant",
    manaCost: "{1}{G}",
    typeLine: "Legendary Creature — Mutant Hero",
    oracleText:
        'Evolve (Whenever a creature you control enters, if that creature has greater power or toughness than this creature, put a +1/+1 counter on this creature.)\nRemove two +1/+1 counters from Darwin: He gains indestructible until end of turn. (Damage and effects that say "destroy" don\'t destroy him.)',
    power: "2",
    toughness: "1",
});

const MOCKINGBIRD = creature({
    oracleId: "d34affa9-3629-49e1-b1e4-4742aff6eafc",
    name: "Mockingbird, Bobbi Morse",
    manaCost: "{3}{W}",
    typeLine: "Legendary Creature — Human Hero",
    oracleText:
        "Whenever Mockingbird is dealt damage, put a +1/+1 counter on her. (She must survive the damage to get the counter.)",
    power: "3",
    toughness: "3",
});

// Zuko's, The Duke's and Arwen's other lines carry gaps of their own; each
// golden reads the one printed line the form sits on, verbatim.
const ZUKO_LINE = creature({
    oracleId: "6e737c52-cbe0-493f-ae46-7bf068e04882",
    name: "Zuko, Seeking Honor",
    manaCost: "{2}{B/R}",
    typeLine: "Legendary Creature — Human Noble",
    oracleText:
        "Whenever Zuko deals combat damage to a player, put a +1/+1 counter on him.",
    power: "2",
    toughness: "2",
});

const THE_DUKE_LINE = creature({
    oracleId: "1c55047d-badc-49bb-b791-e9759577e4eb",
    name: "The Duke, Rebel Sentry",
    manaCost: "{W}",
    typeLine: "Legendary Creature — Human Rebel Ally",
    oracleText: "The Duke enters with a +1/+1 counter on him.",
    power: "0",
    toughness: "1",
});

const ARWEN_LINE = creature({
    oracleId: "9519a4ea-c4a0-4127-b06a-aac9ffaf7a32",
    name: "Arwen, Mortal Queen",
    manaCost: "{1}{G}{W}",
    typeLine: "Legendary Creature — Elf Noble",
    oracleText: "Arwen enters with an indestructible counter on her.",
    power: "2",
    toughness: "2",
});

const TAPPED_OPPONENT_CREATURE = {
    type: "Creature",
    count: 1,
    tappedFilter: "tapped",
    controller: "opponent",
};

describe("gendered pronoun — goldens (CR 608.2h)", () => {
    it('Momo: a trigger\'s leading "he" is the source dealing the damage', () => {
        const outcome = definitionOf(MOMO);
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Momo, Rambunctious Rascal",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Lemur", "Bat", "Ally"],
                manaCost: { X: 2, W: 1 },
                power: 1,
                toughness: 1,
                oracleText: MOMO.oracleText,
                staticAbilities: ["flying"],
                compiledTriggeredAbilities: [
                    {
                        id: "momo-rambunctious-rascal-trigger",
                        oracleText:
                            "When {self} enters, he deals 4 damage to target tapped creature an opponent controls.",
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: TAPPED_OPPONENT_CREATURE,
                        effects: [
                            { op: "dealDamage", amount: 4, to: { target: 0 } },
                        ],
                    },
                ],
            })
        );
    });

    it('The Wasp: a trigger\'s leading "she" reads as "he" does', () => {
        const outcome = definitionOf(THE_WASP);
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "The Wasp, Janet Van Dyne",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Human", "Hero"],
                manaCost: { X: 2, W: 1 },
                power: 1,
                toughness: 1,
                oracleText: THE_WASP.oracleText,
                staticAbilities: ["flying"],
                compiledTriggeredAbilities: [
                    {
                        id: "the-wasp-janet-van-dyne-trigger",
                        oracleText:
                            "When {self} enters, she deals 4 damage to target tapped creature an opponent controls.",
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: TAPPED_OPPONENT_CREATURE,
                        effects: [
                            { op: "dealDamage", amount: 4, to: { target: 0 } },
                        ],
                    },
                ],
            })
        );
    });

    it('Darwin: an activated ability\'s leading "He" is the source', () => {
        // Quarantined on Evolve (planned-mechanic), not on the pronoun: the
        // definition is whole.
        const outcome = definitionOf(DARWIN);
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Darwin, Adaptive Mutant",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Mutant", "Hero"],
                manaCost: { X: 1, G: 1 },
                power: 2,
                toughness: 1,
                oracleText: DARWIN.oracleText,
                staticAbilities: ["evolve"],
                activatedAbilities: [
                    {
                        id: "darwin-adaptive-mutant-ability",
                        oracleText:
                            "Remove two +1/+1 counters from {self}: He gains indestructible until end of turn.",
                        cost: { removeCounter: { type: "+1/+1", count: 2 } },
                        useStack: true,
                        effects: [
                            {
                                op: "grantAbility",
                                target: { ref: "$source" },
                                ability: "indestructible",
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it('Mockingbird: the object "her" is what "it" names — the source', () => {
        const outcome = definitionOf(MOCKINGBIRD);
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Mockingbird, Bobbi Morse",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Human", "Hero"],
                manaCost: { X: 3, W: 1 },
                power: 3,
                toughness: 3,
                oracleText: MOCKINGBIRD.oracleText,
                compiledTriggeredAbilities: [
                    {
                        id: "mockingbird-bobbi-morse-trigger",
                        oracleText:
                            "Whenever {self} is dealt damage, put a +1/+1 counter on her.",
                        head: { kind: "damage-taken", scope: "self" },
                        effects: [
                            {
                                op: "counters",
                                action: "add",
                                counter: "+1/+1",
                                target: { ref: "$source" },
                                count: 1,
                            },
                        ],
                    },
                ],
            })
        );
    });

    it('Zuko\'s line: the object "him" reads as "her" does', () => {
        const outcome = definitionOf(ZUKO_LINE);
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Zuko, Seeking Honor",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Human", "Noble"],
                manaCost: { X: 2, hybrid: [["B", "R"]] },
                power: 2,
                toughness: 2,
                oracleText: ZUKO_LINE.oracleText,
                compiledTriggeredAbilities: [
                    {
                        id: "zuko-seeking-honor-trigger",
                        oracleText:
                            "Whenever {self} deals combat damage to a player, put a +1/+1 counter on him.",
                        head: { kind: "combat-damage-to-player" },
                        effects: [
                            {
                                op: "counters",
                                action: "add",
                                counter: "+1/+1",
                                target: { ref: "$source" },
                                count: 1,
                            },
                        ],
                    },
                ],
            })
        );
    });

    it('The Duke\'s line: "enters with a counter on him" (CR 614.1c)', () => {
        const outcome = definitionOf(THE_DUKE_LINE);
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "The Duke, Rebel Sentry",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Human", "Rebel", "Ally"],
                manaCost: { W: 1 },
                power: 0,
                toughness: 1,
                oracleText: THE_DUKE_LINE.oracleText,
                entersWith: { counters: [{ type: "+1/+1", count: 1 }] },
            })
        );
    });

    it('Arwen\'s line: "enters with a counter on her"', () => {
        const outcome = definitionOf(ARWEN_LINE);
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Arwen, Mortal Queen",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Elf", "Noble"],
                manaCost: { X: 1, W: 1, G: 1 },
                power: 2,
                toughness: 2,
                oracleText: ARWEN_LINE.oracleText,
                entersWith: {
                    counters: [{ type: "indestructible", count: 1 }],
                },
            })
        );
    });
});

describe("gendered pronoun — binds what 'it' binds", () => {
    function compiled(text: string) {
        const outcome = compileCard(
            creature({
                name: "Test Hero",
                typeLine: "Legendary Creature — Human Hero",
                oracleText: text,
            })
        );
        return outcome.state === "unparsed"
            ? "unparsed"
            : JSON.stringify(sortKeys(outcome.definition)).replace(
                  /"oracleText":"[^"]*"/g,
                  ""
              );
    }

    it.each([
        // the source, behind a head on the source itself
        ["When Test Hero enters, {p} gains flying until end of turn.", "he"],
        // the attacking creature, NOT the source (CR 508.3a): the per-creature
        // head's referent, which "it" gets and so does "he"
        [
            "Whenever a creature you control attacks, {p} gets +1/+0 until end of turn.",
            "he",
        ],
        [
            "Whenever a creature you control attacks, {p} gets +1/+0 until end of turn.",
            "she",
        ],
        ["Whenever Test Hero attacks, put a +1/+1 counter on {p}.", "him"],
    ])("%s — %s compiles to the 'it' reading", (template, pronoun) => {
        const asIt = compiled(template.replace("{p}", "it"));
        expect(asIt).not.toBe("unparsed");
        expect(compiled(template.replace("{p}", pronoun))).toBe(asIt);
    });

    it("a head naming no object leaves 'he' unread, as it leaves 'it'", () => {
        const template =
            "Whenever another creature you control enters, {p} gets +1/+0 until end of turn.";
        expect(compiled(template.replace("{p}", "it"))).toBe("unparsed");
        expect(compiled(template.replace("{p}", "he"))).toBe("unparsed");
    });
});

describe("gendered pronoun — refused neighbours", () => {
    it('Liliana\'s Defeat: the possessive "her controller" is not read', () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "7c8b38b3-b808-4ad8-b4e5-39e216063ff6",
                name: "Liliana's Defeat",
                manaCost: "{B}",
                typeLine: "Sorcery",
                oracleText:
                    "Destroy target black creature or black planeswalker. If that permanent was a Liliana planeswalker, her controller loses 3 life.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it('Power Struggle: the player pronoun "he or she" is not read', () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "159789a3-cef3-4260-9ea4-65856df5c523",
                name: "Power Struggle",
                manaCost: "{2}{U}{U}{U}",
                typeLine: "Enchantment",
                oracleText:
                    "During each player's upkeep, that player exchanges control of random target artifact, creature or land he or she controls, for control of random target permanent of the same type that a random opponent controls.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it('Whiplash: the contraction "he\'s" is not a subject pronoun', () => {
        const outcome = compileCard(
            creature({
                oracleId: "00ed7aca-b3c1-4d48-acd5-b1596daeb4c3",
                name: "Whiplash, Vengeful Engineer",
                manaCost: "{B}",
                typeLine: "Legendary Creature — Human Artificer Villain",
                oracleText:
                    "Whenever Whiplash attacks, if he's equipped, each opponent loses X life and you gain X life, where X is the number of Equipment attached to him.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("a capitalised object 'Her' is refused, as a capitalised 'It' is", () => {
        const text = (p: string) =>
            compileCard(
                creature({
                    name: "Test Hero",
                    typeLine: "Legendary Creature — Human Hero",
                    oracleText: `Whenever Test Hero attacks, put a +1/+1 counter on ${p}.`,
                })
            ).state;
        expect(text("It")).toBe("unparsed");
        expect(text("Her")).toBe("unparsed");
    });

    it("Big Bertha's line: an X count is refused, as it is for 'it'", () => {
        const outcome = compileCard(
            creature({
                oracleId: "32654ffa-b869-4f8b-a153-4242e8f9d92e",
                name: "Big Bertha",
                manaCost: "{X}{G}",
                typeLine: "Legendary Creature — Mutant Hero",
                oracleText: "Big Bertha enters with X +1/+1 counters on her.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
