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
    { op: "exile", target: { target: 2 } },
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

describe("validateEffectScript — bind + ref + count constructs (#802)", () => {
    it("accepts the Swords to Plowshares shape (bind then ref-on-bound-object)", () => {
        const effects: EffectOp[] = [
            { op: "exile", target: { target: 0 }, bind: "$c" },
            {
                op: "gainLife",
                player: { ref: "$c.controller" },
                amount: { ref: "$c.power" },
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("accepts a count-driven amount (draw a card for each creature)", () => {
        const effects: EffectOp[] = [
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                },
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects a ref to an undefined binding (static ref-check)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: { ref: "$ghost.power" },
                    },
                ] as never,
            })
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/undefined binding "\$ghost"/);
    });

    it("rejects a ref that reads a binding declared by a LATER Op (snapshot ordering)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: { ref: "$c.power" },
                    },
                    { op: "exile", target: { target: 0 }, bind: "$c" },
                ] as never,
            })
        );
        expect(errors.some((e) => /undefined binding "\$c"/.test(e))).toBe(
            true
        );
    });

    it("rejects an unknown property path on a bound object", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    { op: "exile", target: { target: 0 }, bind: "$c" },
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: { ref: "$c.banana" },
                    },
                ] as never,
            })
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/unknown property path "\.banana"/);
    });

    it("rejects a player property in a numeric position and vice versa", () => {
        const numericMisuse = validateEffectScript(
            host({
                effects: [
                    { op: "exile", target: { target: 0 }, bind: "$c" },
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: { ref: "$c.controller" },
                    },
                ] as never,
            })
        );
        expect(numericMisuse[0]).toMatch(/number position/);

        const playerMisuse = validateEffectScript(
            host({
                effects: [
                    { op: "exile", target: { target: 0 }, bind: "$c" },
                    {
                        op: "gainLife",
                        player: { ref: "$c.power" },
                        amount: 1,
                    },
                ] as never,
            })
        );
        expect(playerMisuse[0]).toMatch(/player position/);
    });

    it("rejects a bad count spec (unknown zone / bad controller)", () => {
        for (const bad of [
            {
                op: "draw",
                player: "controller",
                count: { count: { zone: "moon", controller: "controller" } },
            },
            {
                op: "draw",
                player: "controller",
                count: { count: { zone: "battlefield", controller: "nobody" } },
            },
        ] as never[]) {
            const errors = validateEffectScript(host({ effects: [bad] }));
            expect(errors.length, JSON.stringify(bad)).toBeGreaterThan(0);
        }
    });

    it("rejects `bind` on an Op that does not support it (frozen grammar)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: 1,
                        bind: "$x",
                    },
                ] as never,
            })
        );
        expect(errors.some((e) => /unknown field "bind".*frozen/.test(e))).toBe(
            true
        );
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
        // The frozen STRUCTURAL constructs (ADR 0045: bind / ref / if / forEach)
        // are registered for the coverage guard but bind to interpreter control
        // flow, not a SpellContext primitive — they are exempt from the
        // primitive-binding requirement (they have no game-action primitive).
        const STRUCTURAL_OPS = new Set(["if", "forEach"]);
        for (const row of EFFECT_OP_REGISTRY) {
            expect(row.cr, row.op).toMatch(/^\d+\.\d+/);
            if (STRUCTURAL_OPS.has(row.op)) continue;
            expect(row.binding, row.op).toMatch(/^SpellContext\./);
        }
    });
});

// --- choice / discard Ops (issue #805) ---------------------------------------

describe("validateEffectScript — choice Op (CR 608.2 / 101.4, issue #805)", () => {
    const choiceOp: EffectOp = {
        op: "choice",
        kind: "discard-hand",
        player: { target: 0 },
        zone: "hand",
        count: 2,
        prompt: "Discard two cards.",
        bind: "$picked",
    };
    const discardOp: EffectOp = {
        op: "discard",
        player: { target: 0 },
        cards: { ref: "$picked" },
    };

    it("accepts a well-formed choice → discard script (Mind Rot shape)", () => {
        expect(
            validateEffectScript(host({ effects: [choiceOp, discardOp] }))
        ).toEqual([]);
    });

    it("rejects a choice kind outside the scriptable allow-list", () => {
        const errors = validateEffectScript(
            host({
                effects: [{ ...choiceOp, kind: "untap-pick" } as never],
            })
        );
        expect(errors.some((e) => /field "kind"/.test(e))).toBe(true);
    });

    it("rejects a choice without a bind (a choice whose picks nothing consumes is meaningless)", () => {
        const noBind = { ...(choiceOp as never as Record<string, unknown>) };
        delete noBind.bind;
        const errors = validateEffectScript(
            host({ effects: [noBind] as never })
        );
        expect(errors.some((e) => /missing field "bind"/.test(e))).toBe(true);
    });

    it("rejects a filter on a non-battlefield zone (the submit validator only applies filters to battlefield picks)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    { ...choiceOp, filter: { type: "Creature" } } as never,
                ],
            })
        );
        expect(
            errors.some((e) => /only valid with zone "battlefield"/.test(e))
        ).toBe(true);
        // ... and accepts it on the battlefield.
        expect(
            validateEffectScript(
                host({
                    effects: [
                        {
                            ...choiceOp,
                            kind: "sacrifice-permanents",
                            zone: "battlefield",
                            filter: { type: "Creature" },
                        } as never,
                    ],
                })
            )
        ).toEqual([]);
    });

    it("rejects duplicate binding names (the persisted binding store is keyed by name)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    { op: "destroy", target: { target: 0 }, bind: "$x" },
                    { ...choiceOp, bind: "$x" } as never,
                ],
            })
        );
        expect(
            errors.some((e) => /re-declares an existing binding/.test(e))
        ).toBe(true);
    });

    it("rejects a picks ref carrying a property path", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    choiceOp,
                    {
                        op: "discard",
                        player: { target: 0 },
                        cards: { ref: "$picked.power" },
                    } as never,
                ],
            })
        );
        expect(errors.some((e) => /field "cards"/.test(e))).toBe(true);
    });

    it("rejects a picks ref naming an undefined or later binding", () => {
        const errors = validateEffectScript(
            host({ effects: [discardOp, choiceOp] })
        );
        expect(
            errors.some((e) =>
                /references undefined binding "\$picked"/.test(e)
            )
        ).toBe(true);
    });

    it("rejects a picks position reading a SNAPSHOT binding (family mismatch)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    { op: "exile", target: { target: 0 }, bind: "$gone" },
                    {
                        op: "discard",
                        player: "controller",
                        cards: { ref: "$gone" },
                    },
                ],
            })
        );
        expect(
            errors.some((e) =>
                /names a snapshot binding in a picks position/.test(e)
            )
        ).toBe(true);
    });

    it("rejects a numeric/player position reading a PICKS binding (family mismatch)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    choiceOp,
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: { ref: "$picked.power" },
                    },
                ],
            })
        );
        expect(
            errors.some((e) =>
                /names a picks binding in a number position/.test(e)
            )
        ).toBe(true);
    });

    it("still accepts snapshot refs across a choice (bind across suspended resolution)", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        { op: "exile", target: { target: 0 }, bind: "$gone" },
                        {
                            ...choiceOp,
                            player: "controller",
                        } as never,
                        {
                            op: "discard",
                            player: "controller",
                            cards: { ref: "$picked" },
                        },
                        {
                            op: "gainLife",
                            player: { ref: "$gone.controller" },
                            amount: { ref: "$gone.power" },
                        },
                    ],
                })
            )
        ).toEqual([]);
    });
});

// --- if construct + mayPay / counter Ops (ADR 0045, issue #806) --------------

describe("validateEffectScript — if construct + mayPay/counter (issue #806)", () => {
    it("accepts the Force Spike shape (mayPay binds a boolean, if reads it)", () => {
        const effects: EffectOp[] = [
            {
                op: "mayPay",
                player: { controllerOf: { target: 0 } },
                cost: { X: 1 },
                prompt: "Pay {1}?",
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [{ op: "counter", target: { target: 0 } }],
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("accepts a comparison predicate over a bound snapshot", () => {
        const effects: EffectOp[] = [
            { op: "exile", target: { target: 0 }, bind: "$c" },
            {
                op: "if",
                predicate: { left: { ref: "$c.power" }, op: "ge", right: 3 },
                then: [{ op: "gainLife", player: "controller", amount: 2 }],
                else: [{ op: "gainLife", player: "controller", amount: 1 }],
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects an if predicate naming an undefined boolean binding", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "if",
                        predicate: { binding: "$ghost" },
                        then: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    },
                ] as never,
            })
        );
        expect(errors.some((e) => /undefined binding "\$ghost"/.test(e))).toBe(
            true
        );
    });

    it("rejects a snapshot binding read in a boolean predicate position (family mismatch)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    { op: "exile", target: { target: 0 }, bind: "$snap" },
                    {
                        op: "if",
                        predicate: { binding: "$snap" },
                        then: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    },
                ] as never,
            })
        );
        expect(
            errors.some((e) => /snapshot binding in a boolean position/.test(e))
        ).toBe(true);
    });

    it("rejects a boolean binding read in a numeric position (family mismatch)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "mayPay",
                        player: "opponent",
                        cost: { X: 1 },
                        prompt: "Pay?",
                        bind: "$paid",
                    },
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: { ref: "$paid.power" },
                    },
                ] as never,
            })
        );
        expect(
            errors.some((e) => /boolean binding in a number position/.test(e))
        ).toBe(true);
    });

    it("validates Ops nested inside an if branch (a malformed branch Op fails)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "if",
                        predicate: { left: 1, op: "eq", right: 1 },
                        then: [{ op: "gainLife", player: "controller" }],
                    },
                ] as never,
            })
        );
        expect(errors.some((e) => /then\[0\].*missing field/.test(e))).toBe(
            true
        );
    });

    it("a branch-local bind does not leak past the if (scoping)", () => {
        // `$b` is bound only inside the then branch; a later top-level Op that
        // references it must fail as undefined.
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "if",
                        predicate: { left: 1, op: "eq", right: 1 },
                        then: [
                            { op: "exile", target: { target: 0 }, bind: "$b" },
                        ],
                    },
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: { ref: "$b.power" },
                    },
                ] as never,
            })
        );
        expect(errors.some((e) => /undefined binding "\$b"/.test(e))).toBe(
            true
        );
    });

    it("rejects a mayPay whose bind is missing (a boolean nothing reads is meaningless)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "mayPay",
                        player: "opponent",
                        cost: { X: 1 },
                        prompt: "Pay?",
                    },
                ] as never,
            })
        );
        expect(errors.some((e) => /missing field "bind"/.test(e))).toBe(true);
    });
});

// --- forEach construct + sacrifice Op (ADR 0045, issue #807) -----------------

describe("validateEffectScript — forEach construct (ADR 0045, issue #807)", () => {
    const sweep: EffectOp = {
        op: "forEach",
        select: {
            set: "permanents",
            zone: "battlefield",
            filter: { type: "Creature" },
        },
        effects: [{ op: "destroy", target: { ref: "$each" } }],
    };
    const eachPlayerSac: EffectOp = {
        op: "forEach",
        select: { set: "players" },
        effects: [
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: { ref: "$each" },
                zone: "battlefield",
                filter: { type: "Creature" },
                count: 1,
                prompt: "Choose a creature to sacrifice.",
                bind: "$sac",
            },
            { op: "sacrifice", permanents: { ref: "$sac" } },
        ],
    };

    it("accepts the sweep shape (permanents set, $each object ref)", () => {
        expect(validateEffectScript(host({ effects: [sweep] }))).toEqual([]);
    });

    it("accepts the each-player shape (players set, choice + sacrifice inside)", () => {
        expect(
            validateEffectScript(host({ effects: [eachPlayerSac] }))
        ).toEqual([]);
    });

    it("accepts $each value refs (power/toughness/controller) in a permanents body", () => {
        const script: EffectOp[] = [
            {
                op: "forEach",
                select: { set: "permanents", zone: "battlefield" },
                effects: [
                    {
                        op: "dealDamage",
                        amount: { ref: "$each.power" },
                        to: { player: { ref: "$each.controller" } },
                    },
                ],
            },
        ];
        expect(validateEffectScript(host({ effects: script }))).toEqual([]);
    });

    it("rejects an invalid selector (unknown set, wrong zone, unknown key)", () => {
        for (const select of [
            { set: "graveyards" },
            { set: "permanents", zone: "graveyard" },
            { set: "permanents", zone: "battlefield", colour: "white" },
            { set: "players", zone: "battlefield" },
        ]) {
            const errors = validateEffectScript(
                host({
                    effects: [{ ...sweep, select } as never],
                })
            );
            expect(
                errors.some((e) => /field "select"/.test(e)),
                JSON.stringify(select)
            ).toBe(true);
        }
    });

    it("rejects a forEach with unknown fields or an empty body (frozen grammar)", () => {
        const unknownField = validateEffectScript(
            host({ effects: [{ ...sweep, limit: 3 } as never] })
        );
        expect(unknownField.some((e) => /unknown field "limit"/.test(e))).toBe(
            true
        );
        const emptyBody = validateEffectScript(
            host({ effects: [{ ...sweep, effects: [] } as never] })
        );
        expect(emptyBody.length).toBeGreaterThan(0);
    });

    it("rejects nested forEach — one construct level per script", () => {
        const nested = validateEffectScript(
            host({ effects: [{ ...sweep, effects: [sweep] } as never] })
        );
        expect(
            nested.some((e) => /must not nest inside a forEach body/.test(e))
        ).toBe(true);
    });

    it("validates body Ops against the same schema/vocabulary rules", () => {
        const errors = validateEffectScript(
            host({
                effects: [{ ...sweep, effects: [{ op: "vaporize" }] } as never],
            })
        );
        expect(errors.some((e) => /unknown Op "vaporize"/.test(e))).toBe(true);
    });

    it("rejects $each outside a forEach body (undefined binding)", () => {
        const errors = validateEffectScript(
            host({
                effects: [{ op: "destroy", target: { ref: "$each" } } as never],
            })
        );
        expect(errors.some((e) => /undefined binding "\$each"/.test(e))).toBe(
            true
        );
    });

    it("family-checks $each per selector: a players-set $each is NOT an object/value ref, a permanents-set $each is NOT a bare player ref", () => {
        const objMisuse = validateEffectScript(
            host({
                effects: [
                    {
                        op: "forEach",
                        select: { set: "players" },
                        effects: [{ op: "destroy", target: { ref: "$each" } }],
                    } as never,
                ],
            })
        );
        expect(
            objMisuse.some((e) =>
                /player binding in an object position/.test(e)
            )
        ).toBe(true);
        const valueMisuse = validateEffectScript(
            host({
                effects: [
                    {
                        op: "forEach",
                        select: { set: "players" },
                        effects: [
                            {
                                op: "gainLife",
                                player: "controller",
                                amount: { ref: "$each.power" },
                            },
                        ],
                    } as never,
                ],
            })
        );
        expect(
            valueMisuse.some((e) =>
                /player binding in a number position/.test(e)
            )
        ).toBe(true);
        const playerMisuse = validateEffectScript(
            host({
                effects: [
                    {
                        op: "forEach",
                        select: { set: "permanents", zone: "battlefield" },
                        effects: [
                            {
                                op: "gainLife",
                                player: { ref: "$each" },
                                amount: 1,
                            },
                        ],
                    } as never,
                ],
            })
        );
        expect(
            playerMisuse.some((e) =>
                /snapshot binding in a bare player position/.test(e)
            )
        ).toBe(true);
    });

    it("scopes body bindings to the construct — a later top-level ref to them dangles", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    eachPlayerSac,
                    {
                        op: "discard",
                        player: "controller",
                        cards: { ref: "$sac" },
                    },
                ] as never,
            })
        );
        expect(
            errors.some((e) => /references undefined binding "\$sac"/.test(e))
        ).toBe(true);
    });

    it("keeps OUTER bindings readable inside the body (bind across iterations)", () => {
        const script: EffectOp[] = [
            { op: "exile", target: { target: 0 }, bind: "$c" },
            {
                op: "forEach",
                select: { set: "players" },
                effects: [
                    {
                        op: "dealDamage",
                        amount: { ref: "$c.power" },
                        to: { player: { ref: "$each" } },
                    },
                ],
            },
        ];
        expect(validateEffectScript(host({ effects: script }))).toEqual([]);
    });

    it('reserves "$each" — an Op bind may not shadow it', () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    { op: "destroy", target: { target: 0 }, bind: "$each" },
                ] as never,
            })
        );
        expect(errors.some((e) => /"\$each" is reserved/.test(e))).toBe(true);
    });

    it("rejects re-declaring an OUTER binding inside a forEach body", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    { op: "exile", target: { target: 0 }, bind: "$sac" },
                    eachPlayerSac, // body binds "$sac" again — collides with outer
                ] as never,
            })
        );
        expect(
            errors.some((e) => /re-declares an existing binding/.test(e))
        ).toBe(true);
    });

    it("a valid forEach script survives a JSON round-trip unchanged (ADR 0046 purity)", () => {
        expect(JSON.parse(JSON.stringify([sweep, eachPlayerSac]))).toEqual([
            sweep,
            eachPlayerSac,
        ]);
    });
});

describe("validateEffectScript — sacrifice Op (CR 701.16, issue #807)", () => {
    it("requires a bare picks ref in `permanents`", () => {
        const missing = validateEffectScript(
            host({ effects: [{ op: "sacrifice" } as never] })
        );
        expect(missing.some((e) => /missing field "permanents"/.test(e))).toBe(
            true
        );
        const propertyRef = validateEffectScript(
            host({
                effects: [
                    { op: "sacrifice", permanents: { ref: "$x.power" } },
                ] as never,
            })
        );
        expect(propertyRef.some((e) => /field "permanents"/.test(e))).toBe(
            true
        );
    });

    it("rejects a sacrifice consuming a snapshot binding (family mismatch)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    { op: "exile", target: { target: 0 }, bind: "$snap" },
                    { op: "sacrifice", permanents: { ref: "$snap" } },
                ] as never,
            })
        );
        expect(
            errors.some((e) => /snapshot binding in a picks position/.test(e))
        ).toBe(true);
    });
});
