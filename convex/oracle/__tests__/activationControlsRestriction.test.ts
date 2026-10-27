// CR 602.5 + CR 109.5 (issue #5258) — the Oracle compiler reads "Activate only
// if <player> control(s) N or more <descriptor>" and "Activate only if an
// opponent controls more <descriptor> than you" into the declarative
// `ActivatedAbility.activationCondition`, a battlefield count.
//
// Goldens are REAL corpus rows, one per accepted form. The neighbours the same
// opener prints that a filter count cannot read (a grouping, a distinctness
// tally, a supertype the engine view does not carry) are pinned as refusals,
// so fail-closed is a fact, not an assumption.
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { sentenceRule } from "../grammar/shared/effectClause";
import { oracleCard, parseContext } from "./oracle.fixture";

const LANDS = { type: ["Land"] };

/** The restriction a span reads as, or `undefined` when it reads as none. */
function restrictionsOf(span: string): unknown {
    const parsed = sentenceRule.run(span, parseContext());
    return parsed.ok && parsed.value.role === "restriction"
        ? parsed.value.restrictions
        : undefined;
}

describe("controls activation restriction — golden fixtures (CR 602.5)", () => {
    it('"you control N or more lands" (Cryptic Caves), the whole definition', () => {
        const oracleText =
            "{T}: Add {C}.\n{1}, {T}, Sacrifice this land: Draw a card. Activate only if you control five or more lands.";
        const outcome = compileCard(
            oracleCard({
                name: "Cryptic Caves",
                manaCost: "",
                typeLine: "Land",
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Cryptic Caves",
                types: ["Land"],
                oracleText,
                activatedAbilities: [
                    {
                        id: "cryptic-caves-mana",
                        oracleText: "{T}: Add {C}.",
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { C: 1 },
                    },
                    {
                        id: "cryptic-caves-ability-2",
                        oracleText:
                            "{1}, {T}, Sacrifice this land: Draw a card. Activate only if you control five or more lands.",
                        cost: { mana: { X: 1 }, tap: true, sacrifice: true },
                        useStack: true,
                        effects: [
                            { op: "draw", count: 1, player: "controller" },
                        ],
                        activationCondition: {
                            left: {
                                count: {
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: LANDS,
                                },
                            },
                            op: "ge",
                            right: 5,
                        },
                    },
                ],
            })
        );
    });

    it('"an opponent controls more lands than you" (Weathered Wayfarer), the ability', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Weathered Wayfarer",
                manaCost: "{W}",
                typeLine: "Creature — Human Nomad Cleric",
                oracleText:
                    "{W}, {T}: Search your library for a land card, reveal it, put it into your hand, then shuffle. Activate only if an opponent controls more lands than you.",
                power: "1",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(
            outcome.definition.activatedAbilities?.[0]?.activationCondition
        ).toEqual({
            left: {
                count: {
                    zone: "battlefield",
                    controller: "opponent",
                    filter: LANDS,
                },
            },
            op: "gt",
            right: {
                count: {
                    zone: "battlefield",
                    controller: "controller",
                    filter: LANDS,
                },
            },
        });
    });

    it('"an opponent controls N or more lands" (Tectonic Edge), the restriction sentence', () => {
        expect(
            restrictionsOf(
                "Activate only if an opponent controls four or more lands"
            )
        ).toEqual([
            {
                kind: "controls-at-least",
                player: "opponent",
                filter: { types: ["Land"] },
                atLeast: 4,
            },
        ]);
    });

    it('a colour descriptor, "two or more green permanents" (Sapseep Forest)', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Sapseep Forest",
                manaCost: "",
                typeLine: "Land — Forest",
                oracleText:
                    "({T}: Add {G}.)\nThis land enters tapped.\n{G}, {T}: You gain 1 life. Activate only if you control two or more green permanents.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        const condition = outcome.definition.activatedAbilities?.find(
            (a) => a.activationCondition !== undefined
        )?.activationCondition;
        expect(condition).toMatchObject({
            left: {
                count: {
                    zone: "battlefield",
                    controller: "controller",
                    filter: { color: ["G"] },
                },
            },
            op: "ge",
            right: 2,
        });
    });

    it("behind an ability word (Vedalken Certarch's metalcraft)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Vedalken Certarch",
                manaCost: "{U}",
                typeLine: "Artifact Creature — Vedalken Wizard",
                oracleText:
                    "Metalcraft — {T}: Tap target artifact, creature, or land. Activate only if you control three or more artifacts.",
                power: "1",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(
            outcome.definition.activatedAbilities?.[0]?.activationCondition
        ).toEqual({
            left: {
                count: {
                    zone: "battlefield",
                    controller: "controller",
                    filter: { type: ["Artifact"] },
                },
            },
            op: "ge",
            right: 3,
        });
    });
});

describe("controls activation restriction — refused neighbours (fail-closed)", () => {
    it("a grouping count (Endless Atlas's lands with the same name)", () => {
        expect(
            restrictionsOf(
                "Activate only if you control three or more lands with the same name"
            )
        ).toBeUndefined();
    });

    it("a distinctness tally (Coven's creatures with different powers, differently named lands)", () => {
        expect(
            restrictionsOf(
                "Activate only if you control three or more creatures with different powers"
            )
        ).toBeUndefined();
        expect(
            restrictionsOf(
                "Activate only if you control seven or more differently named lands"
            )
        ).toBeUndefined();
    });

    it("a supertype count the engine view does not carry (Heidar's snow permanents, CR 205.4a)", () => {
        expect(
            restrictionsOf(
                "Activate only if you control four or more snow permanents"
            )
        ).toBeUndefined();
    });

    it("on a mana ability, whose tap sites never read the condition (Temple of the False God)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Temple of the False God",
                manaCost: "",
                typeLine: "Land",
                oracleText:
                    "{T}: Add {C}{C}. Activate only if you control five or more lands.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).not.toBe("ready");
    });

    it('"one or more" is the singular article\'s reading, not a threshold', () => {
        expect(
            restrictionsOf("Activate only if you control one or more lands")
        ).toBeUndefined();
    });
});
