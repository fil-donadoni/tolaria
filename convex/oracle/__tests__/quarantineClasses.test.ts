// ADR 0105 § 7.1 (issue #3823) — the two classes of smoke skip.
//
// An `op-covered` skip (a dormant regeneration shield, a Pay/Skip suspension,
// an untap of a permanent the generator already seeds untapped) is the per-Op
// regime of ADR 0045 and no longer withholds a Compiled Definition. A
// `card-dependent` skip (`$source` targeting, an unmodelled zone, a cast-time
// X) withholds the card until a golden fixture exhibits the same form.

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
const REGENERATOR = oracleCard({
    name: "Metallurgeon",
    manaCost: "{1}{W}",
    typeLine: "Artifact Creature — Human Artificer",
    oracleText: "{W}, {T}: Regenerate target artifact.",
    power: "1",
    toughness: "2",
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
    it("a dormant regeneration shield (CR 701.19a) on a target reaches ready", () => {
        const outcome = compileCard(REGENERATOR);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "ready")
            expect(outcome.opsUsed).toContain("regenerate");
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

describe("card-dependent smoke skips quarantine until a fixture exhibits the form", () => {
    it("a $source pump stays quarantined with no fixture", () => {
        const outcome = compileCard(SELF_PUMP);
        expect(outcome.state).toBe("quarantine");
        expect(smokeReasons(outcome)).toEqual([
            `Op "pump" targets $source/$each — covered by the card's own per-card test`,
        ]);
    });

    it("clears once a fixture of ANOTHER card exhibits the same form", () => {
        const definition = compiled(SELF_PUMP);
        expect(gate(definition, [])).toHaveLength(1);
        expect(gate(definition, [fixture(SELF_PUMP_TWO)])).toEqual([]);
    });

    it("a fixture of a different form clears nothing", () => {
        const definition = compiled(SELF_PUMP);
        expect(gate(definition, [fixture(SELF_HASTE)])).toHaveLength(1);
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

    it("an op-covered Op does not hide a $source subject in its own arguments", () => {
        const outcome = compileCard(SELF_REGENERATOR);
        expect(outcome.state).toBe("quarantine");
        expect(smokeReasons(outcome)).toEqual([
            `Op "regenerate" acts on $source — covered by the card's own per-card test`,
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
