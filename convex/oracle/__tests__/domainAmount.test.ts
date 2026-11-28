// Domain read as an AMOUNT (CR 107.3 + CR 207.2c): "<effect>, where X is the
// number of basic land types among lands you control".
//
//  1. GOLDEN — the three corpus forms compiled whole, `ready`: damage to any
//     target, a life drain whose two halves share the X, and damage after a
//     basic-land search.
//  2. REFUSALS — the neighbours with no fixture: another player's lands, a
//     tally plus a constant, and a tail defining an X the head never prints.
//
// The engine read (`domain` at resolution) is the `{ domain }` EffectValue
// already shipped for the per-Domain pump and counter tax.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./oracle.fixture";

const DOMAIN = { domain: { of: "controller" } };

function sorcery(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

/** The lines of a compile outcome's gaps, `[]` when it compiled. */
function gapLines(card: Parameters<typeof compileCard>[0]): string[] {
    const outcome = compileCard(card);
    return outcome.state === "unparsed" ? outcome.gaps.map((g) => g.line) : [];
}

function goldenOf(name: string) {
    const fixture = GOLDEN_FIXTURES.find((f) => f.card.name === name);
    if (fixture === undefined) throw new Error(`no golden fixture: ${name}`);
    return fixture;
}

describe('"where X is the number of basic land types among lands you control" (CR 107.3, CR 207.2c)', () => {
    it.each(["Tribal Flames", "Exotic Disease"])(
        "compiles %s to its golden fixture, ready",
        (name) => {
            const fixture = goldenOf(name);
            const outcome = compileCard(fixture.card);
            expect(outcome.state).toBe("ready");
            if (outcome.state !== "ready") return;
            expect(sortKeys(outcome.definition)).toEqual(
                sortKeys(fixture.expected)
            );
        }
    );

    it("compiles Exploding Borders whole: the search, then Domain damage", () => {
        const text =
            "Domain — Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle. Exploding Borders deals X damage to target player or planeswalker, where X is the number of basic land types among lands you control.";
        const outcome = compileCard(
            oracleCard({
                oracleId: "1a19fc9e-a822-49ca-ade0-d58054f3caf6",
                name: "Exploding Borders",
                manaCost: "{2}{R}{G}",
                typeLine: "Sorcery",
                oracleText: text,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Exploding Borders",
                types: ["Sorcery"],
                manaCost: { X: 2, R: 1, G: 1 },
                oracleText: text,
                effects: [
                    {
                        op: "choice",
                        kind: "search-library",
                        player: "controller",
                        zone: "library",
                        filter: { type: "Land", supertype: "Basic" },
                        count: { min: 0, max: 1 },
                        prompt: "Search your library for a basic land card.",
                        bind: "$found1",
                    },
                    {
                        op: "moveZone",
                        cards: { ref: "$found1" },
                        player: "controller",
                        from: "library",
                        to: "battlefield",
                        tapped: true,
                    },
                    {
                        op: "libraryLook",
                        action: "shuffle",
                        player: "controller",
                    },
                    {
                        op: "dealDamage",
                        amount: DOMAIN,
                        to: { target: 0 },
                    },
                ],
                targetRequirement: {
                    type: ["player", "Planeswalker"],
                    count: 1,
                },
            })
        );
    });

    it("refuses another player's basic land types", () => {
        expect(
            gapLines(
                sorcery(
                    "Probe",
                    "{1}{R}",
                    "Probe deals X damage to any target, where X is the number of basic land types among lands target opponent controls."
                )
            )
        ).toHaveLength(1);
    });

    it("refuses the tally plus a printed constant", () => {
        expect(
            gapLines(
                sorcery(
                    "Probe",
                    "{1}{R}",
                    "Probe deals X damage to any target, where X is 1 plus the number of basic land types among lands you control."
                )
            )
        ).toHaveLength(1);
    });

    it("refuses a tail defining an X the head does not print", () => {
        expect(
            gapLines(
                sorcery(
                    "Probe",
                    "{1}{R}",
                    "Probe deals 2 damage to any target, where X is the number of basic land types among lands you control."
                )
            )
        ).toHaveLength(1);
    });
});
