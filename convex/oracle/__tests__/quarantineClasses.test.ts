// ADR 0105 § 7.1 (issue #3823) — the two classes of smoke skip.
//
// An `op-covered` skip (a Pay/Skip suspension, an untap of a permanent the
// generator already seeds untapped) is the per-Op
// regime of ADR 0045 and no longer withholds a Compiled Definition. A
// `card-dependent` skip (an unmodelled zone, a cast-time X) withholds the card
// until a golden fixture exhibits the same form. An ability acting on its own
// `$source` is no longer one: the smoke generator seeds the source permanent
// and runs the script against it (issue #3831).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { runGates, fixtureForms, smokeSkipForm } from "../gates";
import type { SmokeSkip } from "../../gre/effects/scenarioGenerator";
import type { EffectOp } from "../../cards/types";
import type { GoldenFixture } from "../grammar/fixtures";
import type { CompileOutcome, CompiledDefinition, OracleCard } from "../types";
import { oracleCard } from "./fixtures";

function compiled(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `fixture card does not parse: ${outcome.gaps.map((g) => g.reason).join("; ")}`
        );
    return outcome.definition;
}

function smokeReasons(outcome: CompileOutcome): string[] {
    return outcome.state === "quarantine"
        ? outcome.reasons
              .filter((r) => r.kind === "smoke-scenario")
              .map((r) => r.detail)
        : [];
}

function gate(definition: CompiledDefinition, fixtures: GoldenFixture[]) {
    return runGates({
        oracleId: "00000000-0000-0000-0000-000000000000",
        definition,
        plannedMechanics: [],
        ungrantableKeywords: [],
        fixtures,
    }).reasons.filter((r) => r.kind === "smoke-scenario");
}

function fixture(card: OracleCard): GoldenFixture {
    return { rule: "effect clause", card, expected: compiled(card) };
}

// Real corpus cards, as the compiler receives them.
const UNTAPPER = oracleCard({
    name: "Seeker of Skybreak",
    manaCost: "{1}{G}",
    typeLine: "Creature — Elf",
    oracleText: "{T}: Untap target creature.",
    power: "2",
    toughness: "1",
});
const SELF_REGENERATOR = oracleCard({
    name: "Odious Trow",
    manaCost: "{B/G}",
    typeLine: "Creature — Troll",
    oracleText: "{1}{B/G}: Regenerate Odious Trow.",
    power: "1",
    toughness: "1",
});
const RANDOM_DISCARD_X = oracleCard({
    name: "Mind Twist",
    manaCost: "{X}{B}",
    typeLine: "Sorcery",
    oracleText: "Target player discards X cards at random.",
    power: undefined,
    toughness: undefined,
});
const MAY_DRAW = oracleCard({
    name: "Shoreline Salvager",
    manaCost: "{3}{B}",
    typeLine: "Creature — Surrakar",
    oracleText:
        "Whenever Shoreline Salvager deals combat damage to a player, if you control an Island, you may draw a card.",
    power: "3",
    toughness: "3",
});
const SELF_PUMP = oracleCard({
    name: "Darkling Stalker",
    manaCost: "{3}{B}",
    typeLine: "Creature — Shade Spirit",
    oracleText: "{B}: Darkling Stalker gets +1/+1 until end of turn.",
    power: "1",
    toughness: "1",
});
const SELF_PUMP_TWO = oracleCard({
    name: "Frozen Shade",
    manaCost: "{2}{B}",
    typeLine: "Creature — Shade",
    oracleText: "{B}: Frozen Shade gets +1/+1 until end of turn.",
    power: "0",
    toughness: "1",
});
const SELF_BOUNCE = oracleCard({
    name: "Flickering Sprite",
    manaCost: "{1}{U}",
    typeLine: "Creature — Faerie",
    oracleText: "{2}: Return Flickering Sprite to its owner's hand.",
    power: "1",
    toughness: "1",
});
const SELF_BOUNCE_TWO = oracleCard({
    name: "Skittish Wisp",
    manaCost: "{U}",
    typeLine: "Creature — Spirit",
    oracleText: "{3}{U}: Return Skittish Wisp to its owner's hand.",
    power: "1",
    toughness: "1",
});
// An op-covered CONTAINER (`mayPay` + `if`) whose body acts on `$source`:
// the plan skips, so nothing is ever resolved against the seeded source and
// the body's subject stays card-dependent (ADR 0105 § 7.1, issue #3831 review).
const MAY_SELF_COUNTER = oracleCard({
    name: "Scavenger Drake",
    manaCost: "{3}{B}",
    typeLine: "Creature — Drake",
    oracleText:
        "Flying\nWhenever another creature dies, you may put a +1/+1 counter on this creature.",
    power: "1",
    toughness: "1",
});
const SELF_HASTE = oracleCard({
    name: "Hasty Tester",
    manaCost: "{1}{R}",
    typeLine: "Creature — Goblin",
    oracleText: "{R}: Hasty Tester gains haste until end of turn.",
    power: "1",
    toughness: "1",
});
const MAY_BOUNCE = oracleCard({
    name: "Dispersal Technician",
    manaCost: "{4}{U}",
    typeLine: "Creature — Vedalken Wizard",
    oracleText:
        "When Dispersal Technician enters, you may return target artifact to its owner's hand.",
    power: "3",
    toughness: "3",
});

describe("op-covered smoke skips no longer quarantine (ADR 0105 § 7.1)", () => {
    it("an untap of a target the generator seeds untapped reaches ready", () => {
        const outcome = compileCard(UNTAPPER);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "ready")
            expect(outcome.opsUsed).toContain("tapUntap");
    });

    it("a Pay/Skip suspension guarding an assertable body reaches ready", () => {
        const outcome = compileCard(MAY_DRAW);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "ready")
            expect(outcome.opsUsed).toEqual(
                expect.arrayContaining(["mayPay", "if", "draw"])
            );
    });
});

describe("an ability acting on its own $source is smoked, not quarantined (issue #3831)", () => {
    it.each([
        ["pump", SELF_PUMP],
        ["pump", SELF_PUMP_TWO],
        ["grantAbility", SELF_HASTE],
        ["regenerate", SELF_REGENERATOR],
    ])("a $source %s reaches ready with no fixture", (op, card) => {
        const outcome = compileCard(card);
        expect(smokeReasons(outcome)).toEqual([]);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "ready") expect(outcome.opsUsed).toContain(op);
    });
});

describe("card-dependent smoke skips quarantine until a fixture exhibits the form", () => {
    it("a $source zone change stays quarantined with no fixture", () => {
        const outcome = compileCard(SELF_BOUNCE);
        expect(outcome.state).toBe("quarantine");
        expect(smokeReasons(outcome)).toEqual([
            expect.stringContaining(`Op "moveZone"`),
        ]);
    });

    it("an op-covered container does not hide a $source body that never runs", () => {
        // The seeded source is evidence only for a script that RUNS: this one
        // skips at `mayPay`, so its `$source` counters clause is unproven.
        const outcome = compileCard(MAY_SELF_COUNTER);
        expect(outcome.state).toBe("quarantine");
        expect(smokeReasons(outcome)).toEqual([
            expect.stringContaining(`Op "counters" targets $source/$each`),
        ]);
    });

    it("clears once a fixture of ANOTHER card exhibits the same form", () => {
        const definition = compiled(SELF_BOUNCE);
        expect(gate(definition, [])).toHaveLength(1);
        expect(gate(definition, [fixture(SELF_BOUNCE_TWO)])).toEqual([]);
    });

    it("a fixture of a different form clears nothing", () => {
        const definition = compiled(SELF_BOUNCE);
        expect(gate(definition, [fixture(MAY_BOUNCE)])).toHaveLength(1);
    });

    it("an op-covered container does not hide a card-dependent body", () => {
        // `mayPay` + `if` are op-covered; the `moveZone` in the `if` body is
        // not, and `analyseOp` alone never reaches it.
        const outcome = compileCard(MAY_BOUNCE);
        expect(outcome.state).toBe("quarantine");
        expect(smokeReasons(outcome)).toEqual([
            expect.stringContaining(`Op "moveZone"`),
        ]);
    });

    it("an op-covered Op does not hide a cast-time X in its own arguments", () => {
        const outcome = compileCard(RANDOM_DISCARD_X);
        expect(outcome.state).toBe("quarantine");
        expect(smokeReasons(outcome)).toEqual([
            expect.stringContaining("chosen-cost X"),
        ]);
    });

    it("a form abstracts literals but keeps the Op's structure", () => {
        const skip = (target: unknown, power: number): SmokeSkip => ({
            code: "source-or-each-subject",
            reason: "same reason",
            op: {
                op: "pump",
                target,
                power,
                toughness: power,
                duration: { phase: "end-of-turn" },
            } as unknown as EffectOp,
        });
        const source = { ref: "$source" };
        expect(smokeSkipForm(skip(source, 1), undefined)).toBe(
            smokeSkipForm(skip(source, 2), undefined)
        );
        expect(smokeSkipForm(skip(source, 1), undefined)).not.toBe(
            smokeSkipForm(skip({ ref: "$each" }, 1), undefined)
        );
    });

    it("a zone change's form carries the zone its announced object comes from", () => {
        // Same Op, same skeleton, same reason: only the HOST's requirement
        // says whether the object is on the battlefield or in a graveyard.
        const withZone = (
            name: string,
            zone: "graveyard" | undefined
        ): CompiledDefinition =>
            ({
                name,
                types: ["Sorcery"],
                manaCost: { B: 1 },
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    ...(zone ? { zone } : {}),
                },
                effects: [
                    { op: "moveZone", target: { target: 0 }, to: "hand" },
                ],
            }) as unknown as CompiledDefinition;
        const synthetic = (expected: CompiledDefinition): GoldenFixture => ({
            rule: "effect clause",
            card: oracleCard({ name: expected.name }),
            expected,
        });
        const fromGraveyard = withZone("Raise", "graveyard");
        expect(
            gate(fromGraveyard, [synthetic(withZone("Bounce", undefined))])
        ).toHaveLength(1);
        expect(
            gate(fromGraveyard, [synthetic(withZone("Raise Two", "graveyard"))])
        ).toEqual([]);
        expect([...fixtureForms([synthetic(fromGraveyard)])]).toEqual([
            expect.stringContaining("slot zone graveyard"),
        ]);
    });
});
