// "While an opponent is choosing targets as part of casting a spell they
// control or activating an ability they control, that player must choose at
// least one Flagbearer on the battlefield if able." (CR 601.2c, issue #4301).
//
// Three layers:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form: the clause alone on a
//     creature (Standard Bearer, Coalition Honor Guard — two bodies, one
//     sentence) and the clause as one line of an Aura (Coalition Flag, which
//     stays unparsed for its OTHER line and must say so).
//  2. REFUSALS — the neighbours this rule does not read: the "your opponents"
//     wording (Enroll in the Coalition), another creature type, and each
//     clause of the sentence dropped in turn.
//  3. Lowering invariants: the descriptor IS the engine's own effect, so
//     expanding a compiled card reaches the same `target-choice-requirement`
//     the hand-written catalogue declares.

import { describe, expect, it } from "vitest";
import { expandCompiledStatics } from "../../cards/compiledStatics";
import { standardBearer } from "../../cards/sets/apc/white";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./fixtures";

const CLAUSE =
    "While an opponent is choosing targets as part of casting a spell they control or activating an ability they control, that player must choose at least one Flagbearer on the battlefield if able.";

const STANDARD_BEARER = oracleCard({
    name: "Standard Bearer",
    manaCost: "{1}{W}",
    typeLine: "Creature — Human Flagbearer",
    oracleText: CLAUSE,
    power: "1",
    toughness: "1",
});

const HONOR_GUARD = oracleCard({
    name: "Coalition Honor Guard",
    manaCost: "{3}{W}",
    typeLine: "Creature — Human Flagbearer",
    oracleText: CLAUSE,
    power: "2",
    toughness: "4",
});

const COALITION_FLAG = oracleCard({
    name: "Coalition Flag",
    manaCost: "{W}",
    typeLine: "Enchantment — Aura",
    oracleText: `Enchant creature you control\nEnchanted creature is a Flagbearer.\n${CLAUSE}`,
});

function requirement(id: string) {
    return {
        kind: "target-choice-requirement",
        id,
        oracleText: CLAUSE,
        binds: "opponents",
        filter: { subtypes: "Flagbearer" },
    };
}

function compiledDefinition(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function withClause(clause: string) {
    return oracleCard({
        name: "Standard Bearer",
        manaCost: "{1}{W}",
        typeLine: "Creature — Human Flagbearer",
        oracleText: clause,
        power: "1",
        toughness: "1",
    });
}

describe("Forced target choice — golden fixtures (CR 601.2c)", () => {
    it("the clause alone on a creature: Standard Bearer", () => {
        expect(sortKeys(compiledDefinition(STANDARD_BEARER))).toEqual(
            sortKeys({
                name: "Standard Bearer",
                types: ["Creature"],
                subtypes: ["Human", "Flagbearer"],
                manaCost: { X: 1, W: 1 },
                power: 1,
                toughness: 1,
                oracleText: CLAUSE,
                compiledStaticEffects: [
                    requirement("standard-bearer-flagbearer-requirement"),
                ],
            })
        );
    });

    it("the same clause on another body: Coalition Honor Guard", () => {
        expect(sortKeys(compiledDefinition(HONOR_GUARD))).toEqual(
            sortKeys({
                name: "Coalition Honor Guard",
                types: ["Creature"],
                subtypes: ["Human", "Flagbearer"],
                manaCost: { X: 3, W: 1 },
                power: 2,
                toughness: 4,
                oracleText: CLAUSE,
                compiledStaticEffects: [
                    requirement("coalition-honor-guard-flagbearer-requirement"),
                ],
            })
        );
    });

    it("read beside an Aura's other lines, which it leaves alone: Coalition Flag", () => {
        // "Enchanted creature is a Flagbearer." is its own Grammar Gap (a
        // layer-4 subtype grant), so the card stays unparsed — and the ONLY
        // fragment it refuses is that one, never the forced-choice clause.
        const outcome = compileCard(COALITION_FLAG);
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((gap) => gap.fragment)).toEqual([
            "Enchanted creature is a Flagbearer.",
        ]);
    });
});

describe("Forced target choice — refusals (fail-closed)", () => {
    it("the 'your opponents' wording is a different sentence: Enroll in the Coalition", () => {
        const outcome = compileCard(
            withClause(
                "While choosing targets as part of casting a spell or activating an ability, your opponents must choose at least one Flagbearer if able."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("another creature type is not the printed clause", () => {
        const outcome = compileCard(
            withClause(CLAUSE.replace("Flagbearer", "Goblin"))
        );
        expect(outcome.state).toBe("unparsed");
    });

    it.each([
        [
            "no 'if able' (it would force an impossible choice)",
            CLAUSE.replace(" if able", ""),
        ],
        [
            "no 'on the battlefield' (a Flagbearer card in a graveyard is not one)",
            CLAUSE.replace(" on the battlefield", ""),
        ],
        [
            "any player rather than an opponent",
            CLAUSE.replace("an opponent is", "a player is"),
        ],
        [
            "a cast alone (the activation half of CR 601.2c dropped)",
            CLAUSE.replace(" or activating an ability they control", ""),
        ],
        ["no full stop", CLAUSE.slice(0, -1)],
    ])("%s", (_why, clause) => {
        expect(compileCard(withClause(clause)).state).toBe("unparsed");
    });
});

describe("Forced target choice — lowering invariants (CR 601.2c)", () => {
    it("the descriptor is the engine's own effect: expanding reaches the hand-written declaration", () => {
        const expanded = expandCompiledStatics(
            compiledDefinition(STANDARD_BEARER) as never
        );
        expect(expanded.staticEffects).toEqual([
            {
                kind: "target-choice-requirement",
                id: "standard-bearer-flagbearer-requirement",
                oracleText: CLAUSE,
                binds: "opponents",
                filter: { subtypes: "Flagbearer" },
            },
        ]);
        expect(expanded.compiledStaticEffects).toBeUndefined();
    });

    it("the dedup identity is the hand-written card's: a compiled and a hand-written Flagbearer are ONE requirement", () => {
        // `activeTargetChoiceRequirements` keys on JSON.stringify({ binds,
        // filter }), so a spelling difference (a string vs a one-element
        // array) would count two Flagbearers as two requirements.
        const identity = (effects: readonly unknown[] | undefined) => {
            const found = (effects ?? []).find(
                (e) =>
                    (e as { kind?: string }).kind ===
                    "target-choice-requirement"
            ) as { binds: string; filter: unknown };
            return JSON.stringify({ binds: found.binds, filter: found.filter });
        };
        const compiled = expandCompiledStatics(
            compiledDefinition(STANDARD_BEARER) as never
        );
        expect(identity(compiled.staticEffects)).toBe(
            identity(standardBearer.staticEffects)
        );
    });

    it("the id is card-scoped, so two Flagbearers on one board never share a handle", () => {
        const ids = [STANDARD_BEARER, HONOR_GUARD].map(
            (card) =>
                (
                    compiledDefinition(card).compiledStaticEffects as {
                        id: string;
                    }[]
                )[0]!.id
        );
        expect(new Set(ids).size).toBe(2);
    });
});
