// A cast permission over an announced graveyard card (CR 601.2 + CR 400.7) —
// issue #7355, the grammar rule that makes `grantCastFromGraveyard` emitted.
//
//  1. GOLDEN over the real corpus card that prints the two-sentence form
//     ("Choose target artifact card in your graveyard. You may cast that card
//     this turn."): Silas Renn, whole card. It stays `quarantine` for an
//     unrelated keyword (Partner) — the Op it emits is what the census reads.
//  2. The one-sentence form and its exile rider, probed on synthetic abilities:
//     no corpus card prints it with every other line compiling (Zul Ashur
//     stops at Ward—Pay life, Vohar at its loot line).
//  3. REFUSALS — the neighbours the frame does not read (fail-closed).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function compile(typeLine: string, oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{2}",
            typeLine,
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    );
}

function effectsOf(typeLine: string, oracleText: string) {
    const outcome = compile(typeLine, oracleText);
    if (outcome.state === "unparsed")
        throw new Error(`unparsed: ${JSON.stringify(outcome.gaps)}`);
    return outcome.definition;
}

describe("graveyard cast grant — two sentences (CR 601.2, CR 400.7)", () => {
    it("Silas Renn: the chosen artifact card may be cast this turn", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Silas Renn, Seeker Adept",
                manaCost: "{1}{U}{B}",
                typeLine: "Legendary Artifact Creature — Human",
                oracleText:
                    "Deathtouch\nWhenever Silas Renn deals combat damage to a player, choose target artifact card in your graveyard. You may cast that card this turn.\nPartner (You can have two commanders if both have partner.)",
                power: "2",
                toughness: "2",
            })
        );
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(outcome.definition.compiledTriggeredAbilities).toEqual([
            {
                id: "silas-renn-seeker-adept-trigger",
                oracleText:
                    "Whenever {self} deals combat damage to a player, choose target artifact card in your graveyard. You may cast that card this turn.",
                head: { kind: "combat-damage-to-player" },
                targetRequirement: {
                    type: "Artifact",
                    count: 1,
                    zone: "graveyard",
                    controller: "you",
                },
                effects: [
                    {
                        op: "grantCastFromGraveyard",
                        card: { target: 0 },
                        player: "controller",
                        window: "this-turn",
                    },
                ],
            },
        ]);
    });
});

describe("graveyard cast grant — one sentence (CR 601.2, CR 614.1)", () => {
    it("an activated ability grants the announced creature card", () => {
        const definition = effectsOf(
            "Artifact",
            "{T}: You may cast target Zombie creature card from your graveyard this turn."
        );
        expect(definition.activatedAbilities?.[0]?.effects).toEqual([
            {
                op: "grantCastFromGraveyard",
                card: { target: 0 },
                player: "controller",
                window: "this-turn",
            },
        ]);
        expect(definition.activatedAbilities?.[0]?.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            subtypeFilter: ["Zombie"],
            zone: "graveyard",
            controller: "you",
        });
    });

    it("the exile rider folds into exilesOnResolve", () => {
        const definition = effectsOf(
            "Artifact",
            "{2}, Sacrifice this artifact: You may cast target instant or sorcery card from your graveyard this turn. If that spell would be put into your graveyard, exile it instead."
        );
        expect(definition.activatedAbilities?.[0]?.effects).toEqual([
            {
                op: "grantCastFromGraveyard",
                card: { target: 0 },
                player: "controller",
                window: "this-turn",
                exilesOnResolve: true,
            },
        ]);
    });
});

describe("graveyard cast grant — refused neighbours (ADR 0105 § 2)", () => {
    const refused = (oracleText: string) =>
        expect(compile("Artifact", oracleText).state).toBe("unparsed");

    it("a grant with no window is a cast during resolution, another effect", () => {
        refused(
            "{T}: You may cast target instant or sorcery card from your graveyard."
        );
    });
    it("a free cast is another effect", () => {
        refused(
            "{T}: You may cast target instant or sorcery card from your graveyard this turn without paying its mana cost."
        );
    });
    it("any graveyard is not the controller's own", () => {
        refused(
            "{T}: You may cast target creature card in a graveyard this turn."
        );
    });
    it("the rider alone follows no grant", () => {
        refused(
            "{T}: Draw a card. If that spell would be put into your graveyard, exile it instead."
        );
    });
    it("a chosen card with no cast after it", () => {
        refused("{T}: Choose target artifact card in your graveyard.");
    });
    it("a cast of that card with nothing chosen", () => {
        refused("{T}: You may cast that card this turn.");
    });
});
