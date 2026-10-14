// "Prevent all combat damage that would be dealt by <object> this turn" — a
// one-way, SOURCE-side combat prevention shield (CR 615.1a, issue #4572),
// lowered to `preventDamage` mode "all-from-source" with `combatOnly`.
//
//  1. GOLDEN — Kor Haven's "target attacking creature".
//  2. REFUSALS — the ability's own source ("this creature", Mtenda Lion) and
//     an anaphor ("that creature", Telekinesis): neither is an announced
//     target, the one shape this rule lowers.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const KOR_HAVEN = oracleCard({
    oracleId: "276cece9-f9f2-46e6-ae76-daddaa2fb9ab",
    name: "Kor Haven",
    manaCost: "",
    typeLine: "Legendary Land",
    oracleText:
        "{T}: Add {C}.\n{1}{W}, {T}: Prevent all combat damage that would be dealt by target attacking creature this turn.",
    power: undefined,
    toughness: undefined,
});

describe("source-side combat prevention shield (CR 615.1a)", () => {
    it("golden — Kor Haven: target attacking creature deals no combat damage this turn", () => {
        const outcome = compileCard(KOR_HAVEN);
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Kor Haven",
                types: ["Land"],
                supertypes: ["Legendary"],
                oracleText:
                    "{T}: Add {C}.\n{1}{W}, {T}: Prevent all combat damage that would be dealt by target attacking creature this turn.",
                activatedAbilities: [
                    {
                        id: "kor-haven-mana",
                        oracleText: "{T}: Add {C}.",
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { C: 1 },
                    },
                    {
                        id: "kor-haven-ability-2",
                        oracleText:
                            "{1}{W}, {T}: Prevent all combat damage that would be dealt by target attacking creature this turn.",
                        cost: { mana: { X: 1, W: 1 }, tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "preventDamage",
                                mode: "all-from-source",
                                source: { target: 0 },
                                combatOnly: true,
                            },
                        ],
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            combatRoleFilter: ["attacking"],
                        },
                    },
                ],
            })
        );
    });

    // Mtenda Lion's clause, on an activated site so nothing but the clause
    // itself can refuse it (its printed trigger is refused upstream).
    it("refuses the ability's own source — \"this creature\" (Mtenda Lion's clause)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Mtenda Lion",
                manaCost: "{G}",
                typeLine: "Creature — Cat",
                oracleText:
                    "{U}: Prevent all combat damage that would be dealt by this creature this turn.",
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps[0]!.reason).toMatch(/announced target only/);
    });

    // Telekinesis's first two sentences (its third is refused upstream).
    it('refuses an anaphor — "that creature" (Telekinesis)', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Telekinesis",
                manaCost: "{U}{U}",
                typeLine: "Instant",
                oracleText:
                    "Tap target creature. Prevent all combat damage that would be dealt by that creature this turn.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps[0]!.reason).toMatch(/announced target only/);
    });
});
