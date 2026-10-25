// Reveal-top-route: "Reveal the top card of your library. If it's a <type>
// card, put it <where>. Otherwise, put it <elsewhere>." lowers to
// `revealTopAndRoute` (CR 701.20a reveal, CR 400.7 zone change).
//
//  1. GOLDEN — a real corpus card compiled whole (Neurok Familiar), plus the
//     land → battlefield / hand variant Nissa, Sage Animist prints, read as a
//     spell line (the compiler reads no loyalty ability yet).
//  2. REFUSALS — each sentence without the others, and the neighbours the
//     corpus prints that this rule does not read.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const NEUROK =
    "Flying\nWhen this creature enters, reveal the top card of your library. If it's an artifact card, put it into your hand. Otherwise, put it into your graveyard.";
const LAND_LINE =
    "Reveal the top card of your library. If it's a land card, put it onto the battlefield. Otherwise, put it into your hand.";

function spell(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{1}{G}",
            typeLine: "Sorcery",
            power: undefined,
            toughness: undefined,
            oracleText,
        })
    );
}

describe("Reveal top route — golden fixtures", () => {
    it("enters trigger, artifact → hand, otherwise graveyard: Neurok Familiar", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Neurok Familiar",
                manaCost: "{1}{U}",
                typeLine: "Creature — Bird",
                power: "1",
                toughness: "1",
                oracleText: NEUROK,
            })
        );
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Neurok Familiar",
                types: ["Creature"],
                subtypes: ["Bird"],
                manaCost: { X: 1, U: 1 },
                power: 1,
                toughness: 1,
                oracleText: NEUROK,
                staticAbilities: ["flying"],
                compiledTriggeredAbilities: [
                    {
                        id: "neurok-familiar-trigger",
                        oracleText:
                            "When this creature enters, reveal the top card of your library. If it's an artifact card, put it into your hand. Otherwise, put it into your graveyard.",
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            {
                                op: "revealTopAndRoute",
                                player: "controller",
                                routes: [
                                    {
                                        filter: { type: "Artifact" },
                                        to: "hand",
                                    },
                                ],
                                fallback: "graveyard",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("land → battlefield, otherwise hand: Nissa, Sage Animist's line", () => {
        const outcome = spell(LAND_LINE);
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(outcome.definition.effects).toEqual([
            {
                op: "revealTopAndRoute",
                player: "controller",
                routes: [{ filter: { type: "Land" }, to: "battlefield" }],
                fallback: "hand",
            },
        ]);
    });
});

describe("Reveal top route — refusals", () => {
    it.each([
        ["window alone", "Reveal the top card of your library."],
        [
            "no Otherwise (the card stays on top)",
            "Reveal the top card of your library. If it's a land card, put it onto the battlefield.",
        ],
        [
            "route without a window",
            "If it's a land card, put it onto the battlefield. Otherwise, put it into your hand.",
        ],
        [
            "Otherwise without a route",
            "Reveal the top card of your library. Otherwise, put it into your hand.",
        ],
        [
            "optional fallback (Otherwise, you may …)",
            "Reveal the top card of your library. If it's a creature card, put it into your hand. Otherwise, you may put it into your graveyard.",
        ],
        [
            "fallback to the library",
            "Reveal the top card of your library. If it's a creature card, put it onto the battlefield. Otherwise, put it on the bottom of your library.",
        ],
        [
            "a type the corpus never prints here",
            "Reveal the top card of your library. If it's a sorcery card, put it into your hand. Otherwise, put it into your graveyard.",
        ],
    ])("refuses %s", (_label, text) => {
        expect(spell(text).state).toBe("unparsed");
    });
});
