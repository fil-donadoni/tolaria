// The `vote` Verb Frame (CR 701.38, issue #2071) — "Starting with you, each
// player votes for <a permanent>" — and the `moveZone` frame's vote-winners
// object, "Exile each permanent with the most votes or tied for most votes",
// folded into ONE chain by sentence assembly.
//
// Two layers:
//
//  1. GOLDEN — Council's Judgment, a `GOLDEN_FIXTURES` row (its exile iterates
//     a runtime-chosen set, a card-dependent smoke skip the fixture clears):
//     whole card, whole Compiled Definition, `ready`.
//  2. REFUSALS — the vote neighbours the corpus prints, none of which this
//     rule reads: an OPTION vote (CR 701.38b — "blue, black, red, or green"
//     names no object), a vote among GRAVEYARD cards (the candidates are not
//     permanents), a SECRET vote (another procedure), and the outcome sentence
//     with no vote in front of it.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./oracle.fixture";
import type { OracleCard } from "../types";

const COUNCILS_JUDGMENT = GOLDEN_FIXTURES.find(
    (f) => f.card.name === "Council's Judgment"
)!;

const COUNCIL_GUARDIAN: OracleCard = {
    oracleId: "4f212675-e34d-4387-a125-e17b25757083",
    name: "Council Guardian",
    manaCost: "{5}{W}",
    typeLine: "Creature — Giant Soldier",
    oracleText:
        "Will of the council — When this creature enters, starting with you, each player votes for blue, black, red, or green. This creature gains protection from each color with the most votes or tied for most votes.",
    layout: "normal",
    power: "5",
    toughness: "5",
};

const CUSTODI_SQUIRE: OracleCard = {
    oracleId: "07c7193e-f591-4aee-a3cc-3a2c52a38f9b",
    name: "Custodi Squire",
    manaCost: "{4}{W}",
    typeLine: "Creature — Spirit Cleric",
    oracleText:
        "Flying\nWill of the council — When this creature enters, starting with you, each player votes for an artifact, creature, or enchantment card in your graveyard. Return each card with the most votes or tied for most votes to your hand.",
    layout: "normal",
    power: "3",
    toughness: "3",
};

const TRAP_THE_TRESPASSERS: OracleCard = {
    oracleId: "ef72af33-37fc-48ed-90d8-547c90e1609d",
    name: "Trap the Trespassers",
    manaCost: "{2}{U}",
    typeLine: "Instant",
    oracleText:
        "Secret council — Each player secretly votes for a creature you don't control, then those votes are revealed. For each creature with one or more votes, put that many stun counters on it, then tap it. (If a permanent with a stun counter would become untapped, remove one from it instead.)",
    layout: "normal",
};

describe("vote frame — golden (CR 701.38, issue #2071)", () => {
    it("Council's Judgment: the vote binds the winners, the exile reads them — ready", () => {
        expect(COUNCILS_JUDGMENT.rule).toBe("verb frame");
        const outcome = compileCard(COUNCILS_JUDGMENT.card);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(COUNCILS_JUDGMENT.expected)
        );
        // The exile is NOT targeted: no requirement is announced, so
        // hexproof, protection and ward cannot stop it (CR 115.1).
        expect(outcome.definition.targetRequirement).toBeUndefined();
    });
});

describe("vote frame — refused neighbours (fail-closed)", () => {
    it("an OPTION vote names no permanent (CR 701.38b) — Council Guardian", () => {
        expect(compileCard(COUNCIL_GUARDIAN).state).toBe("unparsed");
    });

    it("a vote among graveyard cards is not a vote among permanents — Custodi Squire", () => {
        expect(compileCard(CUSTODI_SQUIRE).state).toBe("unparsed");
    });

    it("a SECRET vote is another procedure — Trap the Trespassers", () => {
        expect(compileCard(TRAP_THE_TRESPASSERS).state).toBe("unparsed");
    });

    it("the outcome sentence with no vote before it is refused", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Verdict",
                manaCost: "{1}{W}{W}",
                typeLine: "Sorcery",
                oracleText:
                    "Exile each permanent with the most votes or tied for most votes.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("a vote whose outcome nothing acts on is refused", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Ballot",
                manaCost: "{1}{W}{W}",
                typeLine: "Sorcery",
                oracleText:
                    "Will of the council — Starting with you, each player votes for a nonland permanent you don't control.",
            })
        );
        expect(outcome.state).not.toBe("ready");
    });
});
