// The card-level pipeline and the three `ready` gates (convex/oracle/gates.ts).
//
// The gates are what make `ready` mean "playable" rather than "we understood
// the words". Each one is asserted to DEMOTE, because a gate that only ever
// passes is indistinguishable from a gate that is not wired up.

import { describe, expect, it } from "vitest";
import { MECHANICS_REGISTRY } from "../../cards/mechanicsRegistry";
import { compileCard } from "../compile";
import { collectOps, runGates, sortKeys } from "../gates";
import { slugify } from "../lower";
import { oracleCard } from "./fixtures";

describe("compileCard — states", () => {
    it("a vanilla creature is ready with power, toughness and types", () => {
        const outcome = compileCard(
            oracleCard({ name: "Bear", oracleText: "" })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "unparsed") {
            expect(outcome.definition).toMatchObject({
                name: "Bear",
                types: ["Creature"],
                subtypes: ["Bear"],
                power: 2,
                toughness: 2,
                manaCost: { X: 1, G: 1 },
            });
            expect(outcome.slots).toEqual([]);
        }
    });

    it("a creature whose printed power is not a number is unparsed (CR 208.1)", () => {
        const outcome = compileCard(oracleCard({ power: "*", toughness: "*" }));
        expect(outcome.state).toBe("unparsed");
    });

    it("a multi-faced layout is unparsed — its rules text is not in oracleText", () => {
        const outcome = compileCard(
            oracleCard({ layout: "transform", oracleText: "" })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed") {
            expect(outcome.gaps[0]?.reason).toMatch(/layout "transform"/);
        }
    });

    it("a land with a basic land type is unparsed (CR 305.6 intrinsic ability)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Dual",
                typeLine: "Land — Swamp Mountain",
                oracleText: "({T}: Add {B} or {R}.)",
                manaCost: "",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed")
            expect(outcome.gaps[0]?.reason).toMatch(/CR 305\.6/);
    });

    it("records EVERY unconsumed line, not just the first", () => {
        const outcome = compileCard(
            oracleCard({
                typeLine: "Sorcery",
                power: undefined,
                toughness: undefined,
                oracleText: "Draw a card.\nYou gain 2 life.",
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed") {
            expect(outcome.gaps.map((g) => g.fragment)).toEqual([
                "Draw a card.",
                "You gain 2 life.",
            ]);
        }
    });

    it("lowers multiple keyword lines into one staticAbilities list", () => {
        const outcome = compileCard(
            oracleCard({ oracleText: "Flying\nTrample" })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "unparsed") {
            expect(outcome.definition.staticAbilities).toEqual([
                "flying",
                "trample",
            ]);
        }
    });

    it("numbers a second mana ability rather than colliding ids", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Two Taps",
                typeLine: "Artifact",
                manaCost: "{3}",
                power: undefined,
                toughness: undefined,
                oracleText: "{T}: Add {W}.\n{T}: Add {U}.",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "unparsed") {
            expect(
                outcome.definition.activatedAbilities?.map((a) => a.id)
            ).toEqual(["two-taps-mana", "two-taps-mana-2"]);
        }
    });
});

describe("the ready gates demote", () => {
    const plannedKeyword = MECHANICS_REGISTRY.find(
        (r) =>
            r.kind === "keyword-ability" &&
            r.status === "planned" &&
            /^[a-z ]+$/i.test(r.name)
    );

    it("a keyword the registry marks `planned` quarantines with a reason", () => {
        expect(plannedKeyword).toBeDefined();
        const outcome = compileCard(
            oracleCard({ oracleText: plannedKeyword!.name })
        );
        expect(outcome.state).toBe("quarantine");
        if (outcome.state === "quarantine") {
            expect(outcome.reasons.map((r) => r.kind)).toContain(
                "planned-mechanic"
            );
            expect(outcome.reasons[0]?.detail).toMatch(
                new RegExp(plannedKeyword!.name, "i")
            );
        }
    });

    it("an unregistered Op quarantines with a reason", () => {
        const result = runGates({
            oracleId: "x",
            plannedMechanics: [],
            definition: {
                name: "X",
                types: ["Instant"],
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                effects: [{ op: "notARealOp" } as any],
            },
        });
        expect(result.reasons.map((r) => r.kind)).toContain("planned-op");
    });

    it("a `validateEffectScript` error quarantines with a reason", () => {
        const result = runGates({
            oracleId: "x",
            plannedMechanics: [],
            definition: {
                name: "X",
                types: ["Instant"],
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                effects: [{ op: "draw" } as any],
            },
        });
        expect(result.reasons.map((r) => r.kind)).toContain(
            "validate-effect-script"
        );
    });

    it("never throws on a malformed script — a gate that throws aborts the run", () => {
        // `planSmokeTest` throws on a `draw` with no `player`; the gate must
        // turn that into a quarantine reason for ONE card, not a dead sweep.
        for (const effects of [
            [{ op: "draw" }],
            [{ op: "dealDamage" }],
            [{ op: "forEach", each: undefined }],
        ]) {
            expect(() =>
                runGates({
                    oracleId: "x",
                    plannedMechanics: [],
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    definition: {
                        name: "X",
                        types: ["Instant"],
                        effects: effects as any,
                    },
                })
            ).not.toThrow();
        }
    });

    it("a non-JSON value quarantines — the lockfile row must be pure data", () => {
        const result = runGates({
            oracleId: "x",
            plannedMechanics: [],
            definition: {
                name: "X",
                types: ["Instant"],
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                entersTappedUnlessPay: (() => undefined) as any,
            },
        });
        expect(result.reasons.map((r) => r.kind)).toContain("not-json");
    });

    it("a clean definition passes every gate", () => {
        const result = runGates({
            oracleId: "x",
            plannedMechanics: [],
            definition: {
                name: "X",
                types: ["Creature"],
                staticAbilities: ["flying"],
            },
        });
        expect(result.reasons).toEqual([]);
    });
});

describe("gate helpers", () => {
    it("collectOps finds every op name, at any depth, sorted", () => {
        expect(
            collectOps({
                name: "X",
                types: ["Instant"],
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                effects: [{ op: "draw", then: [{ op: "gainLife" }] } as any],
            })
        ).toEqual(["draw", "gainLife"]);
    });

    it("sortKeys makes a closure visible instead of dropping it", () => {
        expect(sortKeys({ b: 1, a: () => undefined })).toEqual({
            a: "[closure]",
            b: 1,
        });
    });

    it("slugify matches the catalogue's own ability-id convention", () => {
        expect(slugify("Llanowar Elves")).toBe("llanowar-elves");
        expect(slugify("Ach! Hans, Run!")).toBe("ach-hans-run");
    });
});
