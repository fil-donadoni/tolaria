// Keyword line: `Enchant <descriptor>` (CR 702.5a, issue #3825).
//
// Three layers, each watching a different way the enchant restriction can go
// wrong:
//
//  1. GOLDEN fixtures — a real Oracle enchant line, compiled on an Aura, must
//     produce exactly this Compiled Definition. One row per descriptor form
//     the rule accepts (card type, OR-list, controller, subtype, non-subtype,
//     supertype, colour, keyword, tapped, power / mana-value ceiling).
//  2. GOLD over the hand-written catalogue — every hand-written Aura's own
//     enchant line compiles to the `targetRequirement` its author wrote, or is
//     refused; never to a different one.
//  3. REFUSALS — the forms that are not a permanent filter, and the lowering
//     invariants (Aura only, one enchant line, one claim on
//     `targetRequirement`).

import { describe, expect, it } from "vitest";
import { getAllRawCards } from "../../cards/catalogue";
import type { TargetRequirement } from "../../cards/types";
import { compileCard } from "../compile";
import { canonicaliseShorthands, sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import { lowerCard } from "../lower";
import { readTypeLine } from "../typeLine";
import { oracleCard, parseContext } from "./fixtures";

const AURA = "Enchantment — Aura";

function aura(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        typeLine: AURA,
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

/** [card the line is printed on, its mana cost, the line, expected filter]. */
const GOLDEN: readonly (readonly [
    string,
    string,
    string,
    TargetRequirement,
])[] = [
    [
        "Holy Strength",
        "{W}",
        "Enchant creature",
        { type: "Creature", count: 1 },
    ],
    ["Wild Growth", "{G}", "Enchant land", { type: "Land", count: 1 }],
    [
        "Animate Artifact",
        "{3}{U}",
        "Enchant artifact",
        { type: "Artifact", count: 1 },
    ],
    [
        "Feedback",
        "{2}{U}",
        "Enchant enchantment",
        { type: "Enchantment", count: 1 },
    ],
    [
        "Rowan's Talent",
        "{2}{R}{R}",
        "Enchant planeswalker",
        { type: "Planeswalker", count: 1 },
    ],
    [
        "Rune of Sustenance",
        "{1}{W}",
        "Enchant permanent",
        {
            type: [
                "Artifact",
                "Battle",
                "Creature",
                "Enchantment",
                "Land",
                "Planeswalker",
            ],
            count: 1,
        },
    ],
    [
        "Minimus Containment",
        "{2}{W}",
        "Enchant nonland permanent",
        {
            type: [
                "Artifact",
                "Battle",
                "Creature",
                "Enchantment",
                "Land",
                "Planeswalker",
            ],
            count: 1,
            excludeTypes: ["Land"],
        },
    ],
    [
        "Favor of Jukai",
        "{1}{G}",
        "Enchant artifact or creature",
        { type: ["Artifact", "Creature"], count: 1 },
    ],
    [
        "Cocoon",
        "{G}",
        "Enchant creature you control",
        { type: "Creature", count: 1, controller: "you" },
    ],
    [
        "Earthlore",
        "{G}",
        "Enchant land you control",
        { type: "Land", count: 1, controller: "you" },
    ],
    [
        "Observed Stasis",
        "{3}{U}",
        "Enchant creature an opponent controls",
        { type: "Creature", count: 1, controller: "opponent" },
    ],
    [
        "Animate Wall",
        "{W}",
        "Enchant Wall",
        { type: "Creature", count: 1, subtypeFilter: ["Wall"] },
    ],
    [
        "Utopia Sprawl",
        "{G}",
        "Enchant Forest",
        { type: "Land", count: 1, subtypeFilter: ["Forest"] },
    ],
    [
        "Aggression",
        "{2}{R}",
        "Enchant non-Wall creature",
        { type: "Creature", count: 1, excludeSubtypes: ["Wall"] },
    ],
    [
        "Dimensional Exile",
        "{1}{U}",
        "Enchant basic land you control",
        {
            type: "Land",
            count: 1,
            supertypeFilter: ["Basic"],
            controller: "you",
        },
    ],
    [
        "Uncontrolled Infestation",
        "{1}{R}",
        "Enchant nonbasic land",
        { type: "Land", count: 1, excludeSupertypes: ["Basic"] },
    ],
    [
        "Decomposition",
        "{1}{G}",
        "Enchant black creature",
        { type: "Creature", count: 1, colorFilter: "B" },
    ],
    [
        "Armor of Thorns",
        "{1}{G}",
        "Enchant nonblack creature",
        { type: "Creature", count: 1, excludeColors: ["B"] },
    ],
    [
        "Roots",
        "{3}{G}",
        "Enchant creature without flying",
        { type: "Creature", count: 1, excludeAbility: "flying" },
    ],
    [
        "Entangling Vines",
        "{3}{G}",
        "Enchant tapped creature",
        { type: "Creature", count: 1, tappedFilter: "tapped" },
    ],
    [
        "Runner's Bane",
        "{1}{U}",
        "Enchant creature with power 3 or less",
        { type: "Creature", count: 1, powerFilter: { max: 3 } },
    ],
    [
        "Threads of Disloyalty",
        "{1}{U}{U}",
        "Enchant creature with mana value 2 or less",
        { type: "Creature", count: 1, mvFilter: { max: 2 } },
    ],
];

describe("keyword line — Enchant <descriptor> golden fixtures (CR 702.5a)", () => {
    it.each(GOLDEN)("%s: %s", (name, manaCost, line, requirement) => {
        // The line alone on the card's own Aura type line: the fixture is
        // the enchant line's WHOLE contribution to the Compiled Definition.
        const outcome = compileCard(aura(name, manaCost, line));
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.slots).toEqual(["keyword-line"]);
        expect(outcome.definition.targetRequirement).toEqual(requirement);
        // Nothing else: enchant is not a `staticAbilities` keyword in this
        // engine — the restriction IS the target requirement.
        expect(outcome.definition.staticAbilities).toBeUndefined();
    });

    it("a whole real card: Emblem of the Warmind compiles ready", () => {
        const outcome = compileCard(
            aura(
                "Emblem of the Warmind",
                "{1}{R}",
                "Enchant creature you control\nCreatures you control have haste."
            )
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition).toEqual({
            name: "Emblem of the Warmind",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: { X: 1, R: 1 },
            oracleText:
                "Enchant creature you control\nCreatures you control have haste.",
            compiledStaticEffects: [
                {
                    kind: "keyword-grant",
                    filter: { types: ["Creature"], controllerRelation: "you" },
                    keyword: "haste",
                },
            ],
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
        });
    });

    it("reminder text is stripped before the line is read", () => {
        const outcome = compileCard(
            aura(
                "Fear",
                "{B}{B}",
                "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)"
            )
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
    });
});

describe("keyword line — Enchant gold over the hand-written Auras", () => {
    const ENCHANT_LINE = /^Enchant .*$/m;

    it("every hand-written Aura's enchant line compiles to its own targetRequirement, or is refused", () => {
        const refused: string[] = [];
        let accepted = 0;
        for (const def of getAllRawCards()) {
            const line = def.oracleText?.match(ENCHANT_LINE)?.[0];
            if (line === undefined) continue;
            const outcome = compileCard(
                aura(def.name, "{0}", line.replace(/ \(.*\)$/, ""))
            );
            if (outcome.state === "unparsed") {
                refused.push(def.name);
                continue;
            }
            accepted++;
            expect(
                sortKeys(
                    canonicaliseShorthands(outcome.definition.targetRequirement)
                ),
                def.name
            ).toEqual(sortKeys(canonicaliseShorthands(def.targetRequirement)));
        }
        // The refusals are the graveyard Auras — their host is a CARD, and
        // what they enchant afterwards is their own text (CR 702.5a names an
        // object; "creature card in a graveyard" is not a permanent filter).
        expect(refused.sort()).toEqual(["Animate Dead", "Dance of the Dead"]);
        expect(accepted).toBeGreaterThan(100);
    });
});

describe("keyword line — Enchant refusals", () => {
    const ctx = parseContext();

    it.each([
        ["Enchant player", "a player, CR 702.5d"],
        ["Enchant opponent", "a player, CR 702.5d"],
        ["Enchant creature card in a graveyard", "a card, not a permanent"],
        ["Enchant creatures", "a plural noun"],
        ["Enchant attacking creature", "a combat role"],
        ["Enchant red or green creature", "a multi-colour filter"],
        ["Enchant creature.", "trailing prose"],
    ])("refuses %s (%s)", (line) => {
        expect(keywordLineSlot.run(line, ctx).ok).toBe(false);
    });

    function lowerOn(typeLine: string, lines: readonly string[]) {
        const card = oracleCard({
            typeLine,
            oracleText: lines.join("\n"),
            power: undefined,
            toughness: undefined,
        });
        const parsedType = readTypeLine(typeLine);
        if (!parsedType.ok) throw new Error("type line");
        const parses = lines.map((line) => {
            const r = routeLine(line, parseContext(card));
            if (!r.ok) throw new Error(`fixture line unparsed: ${line}`);
            return r.value;
        });
        return lowerCard(card, parsedType.parsed, parses);
    }

    it("refuses enchant on an object that is not an Aura (CR 702.5a)", () => {
        const r = lowerOn("Enchantment", ["Enchant creature"]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/not an Aura/);
    });

    it("refuses two enchant lines rather than keeping one (CR 702.5c)", () => {
        const r = lowerOn(AURA, ["Enchant creature", "Enchant land"]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/enchant twice/);
    });

    it("refuses an Aura whose spell text also claims targetRequirement", () => {
        // Unreachable through the router today — the spell slot reads only an
        // instant or sorcery — so the spell line is parsed in THAT context and
        // handed to the Aura's lowering: the invariant is lowering's own.
        const spell = routeLine(
            "Destroy target artifact.",
            parseContext(oracleCard({ typeLine: "Instant" }))
        );
        const enchant = routeLine("Enchant creature", parseContext());
        if (!spell.ok || !enchant.ok) throw new Error("fixture lines");
        const typeLine = readTypeLine(AURA);
        if (!typeLine.ok) throw new Error("type line");
        const r = lowerCard(
            aura(
                "Test Aura",
                "{1}",
                "Enchant creature\nDestroy target artifact."
            ),
            typeLine.parsed,
            [enchant.value, spell.value]
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/both claim targetRequirement/);
    });
});
