// "If this artifact would enter, you may discard a land card instead. If you
// do, put this artifact onto the battlefield. If you don't, put it into its
// owner's graveyard." — the as-enters discard (CR 614.1a, issue #4570).
//
//  1. GOLDEN — Mox Diamond compiled whole equals the definition the
//     hand-written card declares (`entersWith.asEnters`, the discard leg).
//  2. REFUSALS — a different cost, a different decline destination, a
//     different subject and a second as-enters choice all stay unparsed.
//  3. LOWERING invariants — a second choice on the card refuses the card.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const MOX_TEXT =
    "If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add one mana of any color.";

const MOX_DIAMOND = oracleCard({
    oracleId: "f3c5978a-70fa-431f-933b-b954bd0db0ea",
    name: "Mox Diamond",
    manaCost: "{0}",
    typeLine: "Artifact",
    oracleText: MOX_TEXT,
    power: undefined,
    toughness: undefined,
});

const MOX_CLAUSE = MOX_TEXT.split("\n")[0]!;

describe("as-enters discard — golden fixture (CR 614.1a)", () => {
    it("Mox Diamond: the discard leg, declined → graveyard", () => {
        const outcome = compileCard(MOX_DIAMOND);
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Mox Diamond",
                types: ["Artifact"],
                manaCost: {},
                oracleText: MOX_TEXT,
                activatedAbilities: [
                    {
                        id: "mox-diamond-mana",
                        oracleText: "{T}: Add one mana of any color.",
                        cost: { tap: true },
                        useStack: false,
                        manaChoices: [
                            { W: 1 },
                            { U: 1 },
                            { B: 1 },
                            { R: 1 },
                            { G: 1 },
                        ],
                    },
                ],
                entersWith: {
                    asEnters: [
                        {
                            kind: "discard",
                            filter: { type: "Land" },
                            ifDeclined: "graveyard",
                        },
                    ],
                },
            })
        );
    });

    it("reads the three sentences into one clause and routes it to the static slot", () => {
        const parsed = staticSlot.run(MOX_CLAUSE, parseContext());
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "static")
            expect(parsed.value.clause).toEqual({
                kind: "as-enters-discard",
                filter: { type: "Land" },
            });
        const routed = routeLine(MOX_CLAUSE, parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
    });
});

describe("as-enters discard — refusals (fail-closed neighbours)", () => {
    const refused = [
        // A different decline destination: the rule is "graveyard" only.
        "If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don't, exile it.",
        // A different cost.
        "If this artifact would enter, you may sacrifice a land instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard.",
        "If this artifact would enter, you may discard a card instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard.",
        // Not the entering permanent itself.
        "If a creature would enter, you may discard a land card instead. If you do, put that creature onto the battlefield. If you don't, put it into its owner's graveyard.",
        // The follow-up sentences are the whole replacement — neither may go.
        "If this artifact would enter, you may discard a land card instead.",
        "If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield.",
    ];
    for (const line of refused)
        it(`refuses "${line.slice(0, 70)}…"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
});

describe("as-enters discard — lowering invariants", () => {
    it("a card declaring the same choice twice is refused, not half-read", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Mox Twin",
                manaCost: "{0}",
                typeLine: "Artifact",
                oracleText: `${MOX_CLAUSE}\n${MOX_CLAUSE}`,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("a card also choosing a creature type is refused (CR 614.12b)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Mox Herald",
                manaCost: "{0}",
                typeLine: "Artifact Creature — Shapeshifter",
                oracleText: `${MOX_CLAUSE}\nAs this creature enters, choose a creature type.`,
                power: "1",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
