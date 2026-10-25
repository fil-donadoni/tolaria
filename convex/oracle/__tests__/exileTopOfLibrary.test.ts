// Exile the top of a library (CR 701.13a) and the impulse-play tail that
// grants the exiled card (CR 601.2 + CR 305.1) — issue #5171.
//
// Three layers:
//
//  1. GOLDENS over real corpus cards: one per impulse window, whole card
//     compiled (the `GOLDEN_FIXTURES` rows in `grammar/fixtures.ts` carry the
//     same cards through `goldenFixtures.test.ts`; here the window is the
//     point).
//  2. The bare exile, probed on a synthetic spell: no corpus card prints a
//     bare "Exile the top N cards of <library>" as its only line.
//  3. REFUSALS — the neighbours these rules do not read stay `unparsed`
//     (fail-closed, ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./oracle.fixture";

function effectsOf(oracleText: string) {
    const outcome = compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{R}",
            typeLine: "Sorcery",
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    );
    if (outcome.state === "unparsed")
        throw new Error(`unparsed: ${JSON.stringify(outcome.gaps)}`);
    return outcome.definition.effects;
}

function expectUnparsed(oracleText: string) {
    const outcome = compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{R}",
            typeLine: "Sorcery",
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    );
    expect(outcome.state).toBe("unparsed");
}

describe("exile the top of a library — bare exile (CR 701.13a)", () => {
    it("your library, one card", () => {
        expect(effectsOf("Exile the top card of your library.")).toEqual([
            { op: "exileTopOfLibrary", player: "controller", count: 1 },
        ]);
    });

    it("an announced player's library, several cards", () => {
        expect(
            effectsOf("Exile the top three cards of target player's library.")
        ).toEqual([
            { op: "exileTopOfLibrary", player: { target: 0 }, count: 3 },
        ]);
    });
});

describe("exile the top, then play that card (CR 601.2 + CR 305.1)", () => {
    const grant = (window: string) => ({
        op: "grantCastFromExile",
        card: { ref: "$exiled1" },
        player: "controller",
        window,
        includesLand: true,
    });
    const exile = {
        op: "exileTopOfLibrary",
        player: "controller",
        count: 1,
        bindAll: "$exiled1",
    };

    it("trailing 'this turn' window: Dark-Dweller Oracle", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (row) => row.card.name === "Dark-Dweller Oracle"
        )!;
        const outcome = compileCard(fixture.card);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.definition.activatedAbilities?.[0]?.effects).toEqual([
            exile,
            grant("this-turn"),
        ]);
    });

    it("leading 'until end of turn' window", () => {
        expect(
            effectsOf(
                "Exile the top card of your library. Until end of turn, you may play that card."
            )
        ).toEqual([exile, grant("this-turn")]);
    });

    it("leading 'until the end of your next turn' window: Blazing Crescendo", () => {
        expect(
            effectsOf(
                "Exile the top card of your library. Until the end of your next turn, you may play that card."
            )
        ).toEqual([exile, grant("until-end-of-your-next-turn")]);
    });

    it("'it' names the card as 'that card' does", () => {
        expect(
            effectsOf(
                "Exile the top card of your library. You may play it this turn."
            )
        ).toEqual([exile, grant("this-turn")]);
    });
});

describe("exile the top of a library — refusals (fail-closed)", () => {
    it.each([
        // several cards: "those cards" is a grant over a set
        "Exile the top two cards of your library. You may play those cards this turn.",
        // one card exiled, several named
        "Exile the top card of your library. You may play those cards this turn.",
        // "that card" after an exile of several cards names no ONE card
        "Exile the top two cards of your library. You may play that card this turn.",
        // a window the grant Op has no value for
        "Exile the top card of your library. You may play that card until your next end step.",
        // "play that card" with no exile before it
        "You may play that card this turn.",
        // two exiles: "that card" is ambiguous between them
        "Exile the top card of your library, then exile the top card of target opponent's library. You may play that card this turn.",
        // an exile that is not of a library's top
        "Exile the top card of your graveyard. You may play that card this turn.",
        // a face-down exile is hidden information the Op does not model
        "Exile the top card of your library face down.",
    ])("%s", (text) => expectUnparsed(text));
});
