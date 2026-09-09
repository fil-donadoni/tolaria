// The card-level pipeline and the three `ready` gates (convex/oracle/gates.ts).
//
// The gates are what make `ready` mean "playable" rather than "we understood
// the words". Each one is asserted to DEMOTE, because a gate that only ever
// passes is indistinguishable from a gate that is not wired up.

import { describe, expect, it } from "vitest";
import type { ActivatedAbility, EffectOp } from "../../cards/types";
import { MECHANICS_REGISTRY } from "../../cards/mechanicsRegistry";
import { compileCard } from "../compile";
import { collectOps, runGates, sortKeys } from "../gates";
import { slugify } from "../lower";
import { declareTargets } from "../lowerActivated";
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

    it("an ADVENTURE layout lowers its second face into `insetSpell` (CR 715)", () => {
        // ADR 0120 §5 — adventure leaves the fail-closed layout bucket because
        // CR 715.4 keeps both faces off every zone but the stack: the front
        // face IS the card, and the inset half is one optional field on it.
        const outcome = compileCard(
            oracleCard({
                name: "Test Adventurer",
                layout: "adventure",
                typeLine: "Creature — Faerie",
                oracleText: "",
                faces: [
                    {
                        name: "Test Adventurer",
                        manaCost: "{1}{U}",
                        typeLine: "Creature — Faerie",
                        oracleText: "Flying",
                        power: "2",
                        toughness: "1",
                    },
                    {
                        name: "Test Errand",
                        manaCost: "{U}",
                        typeLine: "Instant — Adventure",
                        oracleText:
                            "Return target creature to its owner's hand.",
                    },
                ],
            })
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        // The FRONT face is the card (CR 715.4).
        expect(outcome.definition).toMatchObject({
            name: "Test Adventurer",
            types: ["Creature"],
            power: 2,
            toughness: 1,
            staticAbilities: ["flying"],
        });
        // …and the second face is its inset spell, with its OWN name, cost,
        // type line and script (CR 715.2).
        expect(outcome.definition.insetSpell).toMatchObject({
            kind: "adventure",
            name: "Test Errand",
            manaCost: { U: 1 },
            types: ["Instant"],
            subtypes: ["Adventure"],
        });
        expect(outcome.definition.insetSpell?.effects).toHaveLength(1);
        // CR 715.3b — the inset half's characteristics are ITS own: nothing of
        // the creature face leaks into it.
        expect(
            (outcome.definition.insetSpell as { staticAbilities?: unknown })
                .staticAbilities
        ).toBeUndefined();
    });

    it("an adventurer card without exactly two faces is unparsed", () => {
        const outcome = compileCard(
            oracleCard({ layout: "adventure", oracleText: "" })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed") {
            expect(outcome.gaps[0]?.reason).toMatch(/exactly two faces/);
        }
    });

    it("an inset face carrying anything an InsetSpell cannot hold is unparsed", () => {
        // Fail CLOSED rather than truncate. This module's card-level invariant
        // is that "a definition missing one of its abilities is worse than no
        // definition at all", and the inset half is where a silent truncation
        // would be least visible — a keyword on the Adventure would simply
        // vanish.
        const outcome = compileCard(
            oracleCard({
                name: "Test Adventurer",
                layout: "adventure",
                typeLine: "Creature — Faerie",
                oracleText: "",
                faces: [
                    {
                        name: "Test Adventurer",
                        manaCost: "{1}{U}",
                        typeLine: "Creature — Faerie",
                        oracleText: "",
                        power: "2",
                        toughness: "1",
                    },
                    {
                        name: "Test Errand",
                        manaCost: "{U}",
                        typeLine: "Creature — Adventure",
                        oracleText: "Flying",
                        power: "1",
                        toughness: "1",
                    },
                ],
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed") {
            expect(outcome.gaps[0]?.reason).toMatch(
                /an InsetSpell cannot hold/
            );
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
                // Two lines the grammar cannot read, on a card type whose
                // slot IS implemented (#2699) — the point is that the loop
                // does not stop at the first gap, so both lines must fail for
                // a reason of their own rather than because no slot applies.
                oracleText:
                    "Destroy all green creatures.\nEach player sacrifices a creature.",
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed") {
            expect(outcome.gaps.map((g) => g.fragment)).toEqual([
                "Destroy all green creatures.",
                "Each player sacrifices a creature.",
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
            ungrantableKeywords: [],
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
            ungrantableKeywords: [],
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
        const malformed = [
            [{ op: "draw" }],
            [{ op: "dealDamage" }],
            [{ op: "forEach", each: undefined }],
        ] as unknown as EffectOp[][];
        for (const effects of malformed) {
            expect(() =>
                runGates({
                    oracleId: "x",
                    plannedMechanics: [],
                    ungrantableKeywords: [],
                    definition: { name: "X", types: ["Instant"], effects },
                })
            ).not.toThrow();
        }
    });

    it("a non-JSON value quarantines — the lockfile row must be pure data", () => {
        const result = runGates({
            oracleId: "x",
            plannedMechanics: [],
            ungrantableKeywords: [],
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
            ungrantableKeywords: [],
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

describe("declareTargets (CR 601.2c)", () => {
    function ability(): ActivatedAbility {
        return {
            id: "x",
            oracleText: "{T}: Do a thing.",
            cost: { tap: true },
            useStack: true,
            effects: [],
        };
    }

    it("declares the one announced target", () => {
        const a = ability();
        expect(
            declareTargets(a, [{ type: "Creature" as const, count: 1 }])
        ).toBeNull();
        expect(a.targetRequirement).toEqual({ type: "Creature", count: 1 });
    });

    it("declares nothing when no target was announced", () => {
        const a = ability();
        expect(declareTargets(a, [])).toBeNull();
        expect(a.targetRequirement).toBeUndefined();
    });

    it("REFUSES two announced targets instead of dropping them", () => {
        // The ops already reference `{target: 0}` and `{target: 1}`
        // positionally, so silently dropping the requirements emits a
        // definition whose script points at targets nothing declares — the
        // shape that reads as `ready` and is broken on the stack.
        // `TargetSlots.allocate` refuses the second allocation first, which is
        // why the list is a parameter: it is the only way to reach the second
        // line of defence, and a refusal no test can enter is one nobody has
        // watched hold.
        const a = ability();
        const reason = declareTargets(a, [
            { type: "Creature" as const, count: 1 },
            { type: "Artifact" as const, count: 1 },
        ]);
        expect(reason).toMatch(/at most one/);
        expect(a.targetRequirement).toBeUndefined();
    });
});
