// "If this land would enter, sacrifice a Forest instead. If you do, put this
// land onto the battlefield. If you don't, put it into its owner's
// graveyard." — the as-enters sacrifice (CR 614.1a + CR 701.21a, issue #5705).
//
//  1. GOLDEN — Heart of Yavimaya compiled whole equals the definition the
//     rule must produce (`entersWith.asEnters`, the sacrifice leg); the other
//     basic land types read through the same rule.
//  2. REFUSALS — a broader victim, an optional sacrifice, a different decline
//     destination, a different subject and truncated forms stay unparsed.
//  3. LOWERING invariants — a second as-enters choice refuses the card.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const CLAUSE =
    "If this land would enter, sacrifice a Forest instead. If you do, put this land onto the battlefield. If you don't, put it into its owner's graveyard.";
const HEART_TEXT = `${CLAUSE}\n{T}: Add {G}.\n{T}: Target creature gets +1/+1 until end of turn.`;

const HEART = oracleCard({
    oracleId: "6c9a854c-0509-4ed4-9d94-c45b823b65e5",
    name: "Heart of Yavimaya",
    manaCost: "",
    typeLine: "Land",
    oracleText: HEART_TEXT,
    power: undefined,
    toughness: undefined,
});

const clauseFor = (type: string): string =>
    CLAUSE.replace("a Forest", `${type === "Island" ? "an" : "a"} ${type}`);

describe("as-enters sacrifice — golden fixture (CR 614.1a / 701.21a)", () => {
    it("Heart of Yavimaya: the sacrifice leg, declined → graveyard", () => {
        const outcome = compileCard(HEART);
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Heart of Yavimaya",
                types: ["Land"],
                oracleText: HEART_TEXT,
                activatedAbilities: [
                    {
                        id: "heart-of-yavimaya-mana",
                        oracleText: "{T}: Add {G}.",
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { G: 1 },
                    },
                    {
                        id: "heart-of-yavimaya-ability-2",
                        oracleText:
                            "{T}: Target creature gets +1/+1 until end of turn.",
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "pump",
                                target: { target: 0 },
                                power: 1,
                                toughness: 1,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                        targetRequirement: { type: "Creature", count: 1 },
                    },
                ],
                entersWith: {
                    asEnters: [
                        {
                            kind: "sacrifice",
                            filter: { subtypes: "Forest" },
                            ifDeclined: "graveyard",
                        },
                    ],
                },
            })
        );
    });

    it("reads the three sentences into one clause and routes it to the static slot", () => {
        const parsed = staticSlot.run(CLAUSE, parseContext());
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "static")
            expect(parsed.value.clause).toEqual({
                kind: "as-enters-sacrifice",
                filter: { subtypes: "Forest" },
            });
        const routed = routeLine(CLAUSE, parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
    });

    for (const type of ["Plains", "Island", "Swamp", "Mountain"])
        it(`a ${type} reads through the same rule`, () => {
            const parsed = staticSlot.run(clauseFor(type), parseContext());
            expect(parsed.ok).toBe(true);
            if (parsed.ok && parsed.value.kind === "static")
                expect(parsed.value.clause).toEqual({
                    kind: "as-enters-sacrifice",
                    filter: { subtypes: type },
                });
        });
});

describe("as-enters sacrifice — refusals (fail-closed neighbours)", () => {
    const refused = [
        // A broader victim than a basic land type.
        CLAUSE.replace("a Forest", "a land"),
        CLAUSE.replace("a Forest", "a creature"),
        // The sacrifice is optional — a different replacement (Mox shape).
        CLAUSE.replace("sacrifice", "you may sacrifice"),
        // A different decline destination.
        CLAUSE.replace("put it into its owner's graveyard", "exile it"),
        // Not the entering permanent itself.
        CLAUSE.replaceAll("this land", "a creature"),
        // The follow-up sentences are the whole replacement — neither may go.
        "If this land would enter, sacrifice a Forest instead.",
        "If this land would enter, sacrifice a Forest instead. If you do, put this land onto the battlefield.",
    ];
    for (const line of refused)
        it(`refuses "${line.slice(0, 70)}…"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
});

describe("as-enters sacrifice — lowering invariants", () => {
    it("a card declaring the same choice twice is refused, not half-read", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Heart Twin",
                manaCost: "",
                typeLine: "Land",
                oracleText: `${CLAUSE}\n${CLAUSE}\n{T}: Add {G}.`,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).not.toBe("ready");
    });
});
