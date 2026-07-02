// Effect Script validator tests (ADR 0045 / ADR 0046, issue #800): schema,
// vocabulary (Mechanics Registry authority), mutual exclusivity and JSON
// purity — plus the three-way coverage guard keeping the Op registry, the
// interpreter's executor table and the validator's field schemas in exact
// 1:1 correspondence.

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../cards/types";
import { EFFECT_OP_REGISTRY } from "../../../cards/mechanicsRegistry";
import { OP_EXECUTORS } from "../interpreter";
import {
    SCHEMA_OP_NAMES,
    validateEffectScript,
    type EffectScriptHost,
} from "../validate";

const host = (overrides: Partial<EffectScriptHost>): EffectScriptHost => ({
    id: "test-host",
    name: "Test Host",
    ...overrides,
});

const validScript: EffectOp[] = [
    { op: "dealDamage", amount: 3, to: { target: 0 } },
    { op: "draw", player: "controller", count: 2 },
    { op: "gainLife", player: { target: 0 }, amount: 1 },
    { op: "loseLife", player: "opponent", amount: 2 },
    { op: "destroy", target: { target: 1 } },
];

describe("validateEffectScript — schema + vocabulary (ADR 0045)", () => {
    it("accepts a well-formed flat script using every Op", () => {
        expect(validateEffectScript(host({ effects: validScript }))).toEqual(
            []
        );
    });

    it("trivially passes a card without effects[]", () => {
        expect(validateEffectScript(host({ resolve: () => {} }))).toEqual([]);
    });

    it("rejects an unknown Op name (Mechanics Registry is the authority)", () => {
        const errors = validateEffectScript(
            host({ effects: [{ op: "vaporize", amount: 1 } as never] })
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/unknown Op "vaporize"/);
        expect(errors[0]).toMatch(/EFFECT_OP_REGISTRY/);
    });

    it("rejects an empty effects[]", () => {
        expect(validateEffectScript(host({ effects: [] }))[0]).toMatch(
            /must not be empty/
        );
    });

    it("rejects a non-object entry and an entry without an op string", () => {
        const errors = validateEffectScript(
            host({ effects: ["dealDamage", { amount: 3 }] as never })
        );
        expect(errors.some((e) => /plain object/.test(e))).toBe(true);
        expect(errors.some((e) => /missing string "op"/.test(e))).toBe(true);
    });

    it("rejects a missing required field", () => {
        const errors = validateEffectScript(
            host({ effects: [{ op: "draw", player: "controller" } as never] })
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/missing field "count"/);
    });

    it("rejects invalid field values (zero / negative / non-integer amounts, bad refs)", () => {
        for (const bad of [
            { op: "dealDamage", amount: 0, to: { target: 0 } },
            { op: "dealDamage", amount: -3, to: { target: 0 } },
            { op: "draw", player: "controller", count: 1.5 },
            { op: "gainLife", player: "somebody", amount: 1 },
            { op: "destroy", target: { target: -1 } },
            {
                op: "dealDamage",
                amount: 1,
                to: { target: 0, player: "controller" },
            },
        ] as never[]) {
            const errors = validateEffectScript(host({ effects: [bad] }));
            expect(errors.length, JSON.stringify(bad)).toBeGreaterThan(0);
        }
    });

    it("rejects unknown extra fields — the grammar is frozen (ADR 0045)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: 1,
                        forEach: "$each",
                    } as never,
                ],
            })
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/unknown field "forEach".*frozen/);
    });
});

describe("validateEffectScript — mutual exclusivity per effect site", () => {
    const effects: EffectOp[] = [
        { op: "gainLife", player: "controller", amount: 1 },
    ];

    it("rejects effects[] combined with resolve", () => {
        const errors = validateEffectScript(
            host({ effects, resolve: () => {} })
        );
        expect(errors.some((e) => /effects\[\] and resolve/.test(e))).toBe(
            true
        );
    });

    it("rejects effects[] combined with resolveSteps", () => {
        const errors = validateEffectScript(
            host({ effects, resolveSteps: [() => {}] })
        );
        expect(errors.some((e) => /effects\[\] and resolveSteps/.test(e))).toBe(
            true
        );
    });

    it("rejects effects[] combined with the effect shorthand", () => {
        const errors = validateEffectScript(
            host({ effects, effect: "destroy-target" })
        );
        expect(errors.some((e) => /effects\[\] and effect/.test(e))).toBe(true);
    });

    it("rejects effects[] combined with modes", () => {
        const errors = validateEffectScript(
            host({
                effects,
                modes: [{ id: "m1", label: "Mode", oracleText: "..." }],
            })
        );
        expect(errors.some((e) => /effects\[\] and modes/.test(e))).toBe(true);
    });
});

describe("validateEffectScript — JSON purity (ADR 0046)", () => {
    it("rejects non-finite numbers", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    { op: "gainLife", player: "controller", amount: NaN },
                ] as never,
            })
        );
        expect(errors.some((e) => /non-finite|invalid value/.test(e))).toBe(
            true
        );
    });

    it("rejects non-plain-JSON values (RegExp, functions, undefined holes)", () => {
        for (const impure of [
            { op: "destroy", target: /x/ },
            { op: "draw", player: "controller", count: () => 1 },
            {
                op: "gainLife",
                player: "controller",
                amount: 1,
                note: undefined,
            },
        ] as never[]) {
            const errors = validateEffectScript(host({ effects: [impure] }));
            expect(errors.length, JSON.stringify(impure)).toBeGreaterThan(0);
        }
    });

    it("a valid script round-trips through JSON.stringify unchanged", () => {
        expect(JSON.parse(JSON.stringify(validScript))).toEqual(validScript);
    });
});

describe("Op coverage guard — registry ↔ interpreter ↔ validator (1:1)", () => {
    const registryOps = EFFECT_OP_REGISTRY.map((row) => row.op).sort();

    it("Op names in EFFECT_OP_REGISTRY are unique", () => {
        expect(new Set(registryOps).size).toBe(registryOps.length);
    });

    it("every registered Op has an interpreter executor, and vice versa", () => {
        expect(Object.keys(OP_EXECUTORS).sort()).toEqual(registryOps);
    });

    it("every registered Op has a validator field schema, and vice versa", () => {
        expect([...SCHEMA_OP_NAMES].sort()).toEqual(registryOps);
    });

    it("every registered Op carries a CR reference and a SpellContext binding", () => {
        for (const row of EFFECT_OP_REGISTRY) {
            expect(row.cr, row.op).toMatch(/^\d+\.\d+/);
            expect(row.binding, row.op).toMatch(/^SpellContext\./);
        }
    });
});
