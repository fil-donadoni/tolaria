// "Shuffle the cards from your hand into your library, then draw that many
// cards." (CR 701.24a, CR 121.1, issue #4302).
//
// Three layers:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form: the clause at an
//     enters head (Whirlpool Rider) and at a dies head beside a keyword line
//     (Whirlpool Drake).
//  2. REFUSALS — the neighbours this rule does not read: the "each player"
//     reading Whirlpool Warrior prints, and a fixed draw count.
//  3. The lowering invariant: "that many" is the size of the hand BEFORE it
//     moved, so the move binds the count and the draw reads that binding —
//     never a recount of a hand the move has emptied.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./fixtures";

const CLAUSE =
    "shuffle the cards from your hand into your library, then draw that many cards.";

const RIDER = oracleCard({
    name: "Whirlpool Rider",
    manaCost: "{1}{U}",
    typeLine: "Creature — Merfolk",
    oracleText: `When this creature enters, ${CLAUSE}`,
    power: "1",
    toughness: "1",
});

const DRAKE = oracleCard({
    name: "Whirlpool Drake",
    manaCost: "{3}{U}",
    typeLine: "Creature — Drake",
    oracleText: `Flying\nWhen this creature enters, ${CLAUSE}\nWhen this creature dies, ${CLAUSE}`,
    power: "2",
    toughness: "2",
});

const WARRIOR = oracleCard({
    name: "Whirlpool Warrior",
    manaCost: "{2}{U}",
    typeLine: "Creature — Merfolk Warrior",
    oracleText: `When this creature enters, ${CLAUSE}\n{R}, Sacrifice this creature: Each player shuffles the cards from their hand into their library, then draws that many cards.`,
    power: "2",
    toughness: "2",
});

/** The effects the clause lowers to, with the binding named `bind`. */
function redrawEffects(bind: string) {
    return [
        {
            op: "moveZone",
            player: "controller",
            from: "hand",
            to: "library",
            bindCount: bind,
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
        { op: "draw", player: "controller", count: { ref: bind } },
    ];
}

function compiledDefinition(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

describe("Shuffle hand into library, draw that many — golden fixtures (CR 701.24a, CR 121.1)", () => {
    it("enters head: Whirlpool Rider", () => {
        expect(sortKeys(compiledDefinition(RIDER))).toEqual(
            sortKeys({
                name: "Whirlpool Rider",
                types: ["Creature"],
                subtypes: ["Merfolk"],
                manaCost: { X: 1, U: 1 },
                power: 1,
                toughness: 1,
                oracleText: `When this creature enters, ${CLAUSE}`,
                compiledTriggeredAbilities: [
                    {
                        id: "whirlpool-rider-trigger",
                        oracleText: `When this creature enters, ${CLAUSE}`,
                        head: { kind: "entered", scope: "self" },
                        effects: redrawEffects("$handSize1"),
                    },
                ],
            })
        );
    });

    it("enters and dies heads beside a keyword line: Whirlpool Drake", () => {
        expect(sortKeys(compiledDefinition(DRAKE))).toEqual(
            sortKeys({
                name: "Whirlpool Drake",
                types: ["Creature"],
                subtypes: ["Drake"],
                manaCost: { X: 3, U: 1 },
                power: 2,
                toughness: 2,
                oracleText: `Flying\nWhen this creature enters, ${CLAUSE}\nWhen this creature dies, ${CLAUSE}`,
                staticAbilities: ["flying"],
                compiledTriggeredAbilities: [
                    {
                        id: "whirlpool-drake-trigger",
                        oracleText: `When this creature enters, ${CLAUSE}`,
                        head: { kind: "entered", scope: "self" },
                        effects: redrawEffects("$handSize1"),
                    },
                    {
                        id: "whirlpool-drake-trigger-2",
                        oracleText: `When this creature dies, ${CLAUSE}`,
                        head: { kind: "died", scope: "self" },
                        effects: redrawEffects("$handSize1"),
                    },
                ],
            })
        );
    });
});

describe("Shuffle hand into library, draw that many — refusals (fail-closed)", () => {
    it("the each-player reading stays refused: Whirlpool Warrior's sacrifice ability", () => {
        const outcome = compileCard(WARRIOR);
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((gap) => gap.fragment)).toEqual([
            "{R}, Sacrifice this creature: Each player shuffles the cards from their hand into their library, then draws that many cards.",
        ]);
    });

    it("a fixed draw count is not 'that many'", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Whirlpool Rider",
                manaCost: "{1}{U}",
                typeLine: "Creature — Merfolk",
                oracleText:
                    "When this creature enters, shuffle the cards from your hand into your library, then draw seven cards.",
                power: "1",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("another zone's cards are not the hand's", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Whirlpool Rider",
                manaCost: "{1}{U}",
                typeLine: "Creature — Merfolk",
                oracleText:
                    "When this creature enters, shuffle the cards from your graveyard into your library, then draw that many cards.",
                power: "1",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("Shuffle hand into library, draw that many — lowering invariants (CR 121.1)", () => {
    it("the move binds the count the draw reads, in printed order", () => {
        const definition = compiledDefinition(RIDER);
        const effects = definition.compiledTriggeredAbilities?.[0]?.effects;
        expect(effects?.map((effect) => effect.op)).toEqual([
            "moveZone",
            "libraryLook",
            "draw",
        ]);
        const [move, , draw] = effects as ReturnType<typeof redrawEffects>;
        const bound = (move as { bindCount: string }).bindCount;
        expect((draw as { count: { ref: string } }).count.ref).toBe(bound);
    });
});
