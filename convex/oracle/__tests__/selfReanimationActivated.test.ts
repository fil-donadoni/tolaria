// "Return this card from your graveyard to the battlefield [tapped]" as an
// activated ability's effect (CR 113.6m, CR 110.5b): the effect moves the
// source out of the graveyard, so the ability functions only there.
//
//  1. GOLDENS — the real Cauldron Familiar and Reassembling Skeleton rows (the
//     `GOLDEN_FIXTURES` entries) reach `ready` and lower to a `moveZone` of
//     `$source` on an `activateFromGraveyard` ability.
//  2. REFUSALS — neighbours the rule must not read.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const fixture = (name: string) =>
    GOLDEN_FIXTURES.find((f) => f.card.name === name)!;

const creature = (oracleText: string) =>
    compileCard(
        oracleCard({
            name: "Reanimation Probe",
            manaCost: "{1}{B}",
            typeLine: "Creature — Zombie",
            power: "2",
            toughness: "2",
            oracleText,
        })
    );

describe("activated self-reanimation from the graveyard (CR 113.6m)", () => {
    it.each(["Cauldron Familiar", "Reassembling Skeleton"])(
        "%s: compiles to the fixture and reaches ready",
        (name) => {
            const golden = fixture(name);
            const outcome = compileCard(golden.card);
            expect(outcome.state).toBe("ready");
            if (outcome.state === "unparsed") return;
            expect(sortKeys(outcome.definition)).toEqual(
                sortKeys(golden.expected)
            );
        }
    );

    it("CR 110.5b — the tapped rider is the only difference between the forms", () => {
        const plain = creature(
            "{2}{B}: Return this card from your graveyard to the battlefield."
        );
        const tapped = creature(
            "{2}{B}: Return this card from your graveyard to the battlefield tapped."
        );
        if (plain.state === "unparsed" || tapped.state === "unparsed")
            throw new Error("unparsed");
        const [a] = plain.definition.activatedAbilities!;
        const [b] = tapped.definition.activatedAbilities!;
        expect(a!.activateFromGraveyard).toBe(true);
        expect(b!.activateFromGraveyard).toBe(true);
        expect(a!.effects).toEqual([
            { op: "moveZone", target: { ref: "$source" }, to: "battlefield" },
        ]);
        expect(b!.effects).toEqual([
            {
                op: "moveZone",
                target: { ref: "$source" },
                to: "battlefield",
                tapped: true,
            },
        ]);
    });

    it.each([
        // CR 113.6m — a cost leg naming the source cannot be paid from the
        // graveyard (it is not on the battlefield to tap or sacrifice).
        "{T}: Return this card from your graveyard to the battlefield.",
        "{1}{B}, Sacrifice this creature: Return this card from your graveyard to the battlefield.",
        // CR 113.6m — a graveyard-exile picker could take the source itself.
        "{1}{B}, Exile a creature card from your graveyard: Return this card from your graveyard to the battlefield.",
        // The hand and attached forms have no fixture on this slot.
        "{1}{B}: Return this card from your graveyard to your hand.",
        "{1}{B}: Return this card from your graveyard to the battlefield attached to that creature.",
        // Fail-closed: the rider is "tapped", nothing else.
        "{1}{B}: Return this card from your graveyard to the battlefield tapped and attacking.",
        "{1}{B}: Return this card from your graveyard to the battlefield under your control.",
    ])("refuses %s", (line) => {
        expect(creature(line).state).toBe("unparsed");
    });

    it("CR 303.4f — the triggered spelling stays refused (no host for an Aura)", () => {
        expect(
            creature(
                "At the beginning of your upkeep, you may return this card from your graveyard to the battlefield."
            ).state
        ).toBe("unparsed");
    });
});
