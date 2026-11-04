// Self trigger heads behind a plural card name: "Whenever The Neutrinos attack"
// (CR 201.5, 603.2). No corpus card printing one of these forms compiles whole
// yet (each still has a Grammar Gap past the head), so each form is pinned whole
// under the real card's name, behind a body that does; "enter" keeps its corpus
// golden in `castPhaseZoneChangeHeads.test.ts`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function card(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{2}",
        typeLine: "Legendary Creature — Human",
        oracleText,
        power: "2",
        toughness: "2",
    });
}

const FORMS = [
    {
        form: "attack",
        name: "The Neutrinos",
        line: "Whenever The Neutrinos attack, draw a card.",
        id: "the-neutrinos-trigger",
        normalized: "Whenever {self} attack, draw a card.",
        singular: "Whenever {self} attacks, draw a card.",
        head: { kind: "attacks" },
    },
    {
        form: "die",
        name: "The Duras Sisters",
        line: "When The Duras Sisters die, draw a card.",
        id: "the-duras-sisters-trigger",
        normalized: "When {self} die, draw a card.",
        singular: "When {self} dies, draw a card.",
        head: { kind: "died", scope: "self" },
    },
    {
        form: "enter or attack",
        name: "Aang and Katara",
        line: "Whenever Aang and Katara enter or attack, draw a card.",
        id: "aang-and-katara-trigger",
        normalized: "Whenever {self} enter or attack, draw a card.",
        singular: "Whenever {self} enters or attacks, draw a card.",
        head: { kind: "enters-or-attacks" },
    },
    {
        form: "deal combat damage to a player",
        name: "Falcon and Redwing",
        line: "Whenever Falcon and Redwing deal combat damage to a player, draw a card.",
        id: "falcon-and-redwing-trigger",
        normalized:
            "Whenever {self} deal combat damage to a player, draw a card.",
        singular:
            "Whenever {self} deals combat damage to a player, draw a card.",
        head: { kind: "combat-damage-to-player" },
    },
    {
        form: "become tapped",
        name: "Tui and La, Moon and Ocean",
        line: "Whenever Tui and La become tapped, draw a card.",
        id: "tui-and-la-moon-and-ocean-trigger",
        normalized: "Whenever {self} become tapped, draw a card.",
        singular: "Whenever {self} becomes tapped, draw a card.",
        head: { kind: "tapped", scope: "self" },
    },
] as const;

describe("self trigger heads behind a plural name (CR 201.5, 603.2)", () => {
    for (const row of FORMS) {
        it(`${row.name}: '${row.form}' compiles whole`, () => {
            const outcome = compileCard(card(row.name, row.line));
            expect(
                sortKeys(
                    outcome.state === "unparsed" ? outcome : outcome.definition
                )
            ).toEqual(
                sortKeys({
                    name: row.name,
                    types: ["Creature"],
                    supertypes: ["Legendary"],
                    subtypes: ["Human"],
                    manaCost: { X: 2 },
                    power: 2,
                    toughness: 2,
                    oracleText: row.line,
                    compiledTriggeredAbilities: [
                        {
                            id: row.id,
                            oracleText: row.normalized,
                            head: row.head,
                            effects: [
                                { op: "draw", player: "controller", count: 1 },
                            ],
                        },
                    ],
                })
            );
        });

        it(`'${row.form}' lowers to the head of its singular spelling`, () => {
            const outcome = compileCard(card("Probe", row.singular));
            if (outcome.state === "unparsed")
                throw new Error(JSON.stringify(outcome.gaps));
            const [ability] =
                outcome.definition.compiledTriggeredAbilities ?? [];
            expect(sortKeys(ability!.head)).toEqual(sortKeys(row.head));
        });
    }
});

describe("plural-name head neighbours stay refused", () => {
    const refused = (name: string, line: string) =>
        compileCard(card(name, line)).state === "unparsed";

    it.each([
        // The key is the literal `{self}`: a noun subject takes the singular.
        ["Probe", "Whenever this creature attack, draw a card."],
        ["Probe", "When this creature die, draw a card."],
        // A plural with no singular head has nothing to be the spelling of.
        [
            "Bebop & Rocksteady",
            "Whenever Bebop & Rocksteady attack or block, draw a card.",
        ],
        [
            "Tui and La, Moon and Ocean",
            "Whenever Tui and La become untapped, draw a card.",
        ],
        // An opener the corpus does not print on the plural spelling.
        ["The Neutrinos", "When The Neutrinos attack, draw a card."],
        ["The Duras Sisters", "Whenever The Duras Sisters die, draw a card."],
    ])("%s: %s", (name, line) => {
        expect(refused(name, line)).toBe(true);
    });
});
