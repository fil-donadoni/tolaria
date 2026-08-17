// Effect Script validator tests (ADR 0045 / ADR 0046, issue #800): schema,
// vocabulary (Mechanics Registry authority), mutual exclusivity and JSON
// purity — plus the three-way coverage guard keeping the Op registry, the
// interpreter's executor table and the validator's field schemas in exact
// 1:1 correspondence.

import { describe, it, expect } from "vitest";
import type { AbilityMode, CardType, EffectOp } from "../../../cards/types";
import { EFFECT_OP_REGISTRY } from "../../../cards/mechanicsRegistry";
import { enteredTrigger } from "../../../cards/abilities/triggers/enteredTrigger";
import { OP_EXECUTORS } from "../interpreter";
import {
    SCHEMA_OP_NAMES,
    validateEffectScript,
    validateAbilityEffectScript,
    validateAiEffectsScript,
    validateAbilityAiEffectsScript,
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

    // grantAbility carries exactly one payload (issue #738): a keyword static
    // grant (`ability`) OR a duration-scoped activated-ability grant
    // (`grantedActivatedId`). Both-set or neither-set is a schema error.
    it("accepts grantAbility with only ability (keyword grant)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "grantAbility",
                        ability: "haste",
                        target: { target: 0 },
                        duration: { phase: "end-of-turn" },
                    },
                ],
            })
        );
        expect(errors).toEqual([]);
    });

    it("accepts grantAbility with only grantedActivatedId (activated grant)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "grantAbility",
                        grantedActivatedId: "some-template",
                        target: { target: 0 },
                        duration: { phase: "end-of-turn" },
                    },
                ],
            })
        );
        expect(errors).toEqual([]);
    });

    it("rejects grantAbility with BOTH ability and grantedActivatedId", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "grantAbility",
                        ability: "haste",
                        grantedActivatedId: "some-template",
                        target: { target: 0 },
                        duration: { phase: "end-of-turn" },
                    },
                ],
            })
        );
        expect(errors.some((e) => /exactly one of/.test(e))).toBe(true);
    });

    it("rejects grantAbility with NEITHER ability nor grantedActivatedId", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "grantAbility",
                        target: { target: 0 },
                        duration: { phase: "end-of-turn" },
                    } as never,
                ],
            })
        );
        expect(errors.some((e) => /exactly one of/.test(e))).toBe(true);
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

    it("accepts a chosen-cost X amount (Earthquake / Drain Life, issue #852)", () => {
        const effects: EffectOp[] = [
            { op: "dealDamage", amount: { X: true }, to: { target: 0 } },
            { op: "gainLife", player: "controller", amount: { X: true } },
            { op: "draw", player: "controller", count: { X: true } },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("accepts a chosen-cost X in a signed pump position (Howl from Beyond +X/+0)", () => {
        const effects: EffectOp[] = [
            {
                op: "pump",
                target: { target: 0 },
                power: { X: true },
                toughness: 0,
                duration: { phase: "end-of-turn" },
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects a malformed X value (X must be the literal true)", () => {
        for (const bad of [
            { op: "dealDamage", amount: { X: false }, to: { target: 0 } },
            { op: "dealDamage", amount: { X: 1 }, to: { target: 0 } },
            {
                op: "dealDamage",
                amount: { X: true, extra: 1 },
                to: { target: 0 },
            },
        ] as never[]) {
            const errors = validateEffectScript(host({ effects: [bad] }));
            expect(errors.length, JSON.stringify(bad)).toBeGreaterThan(0);
        }
    });

    it("accepts a counters value over an announced target and a forEach $each (issue #1015)", () => {
        // { target: N } at a spell site; { ref: "$each" } inside a permanents
        // forEach body — both legal object selectors for `of`.
        const effects: EffectOp[] = [
            {
                op: "gainLife",
                player: "controller",
                amount: { counters: { of: { target: 0 }, type: "+1/+1" } },
            },
            {
                op: "forEach",
                select: { set: "permanents", zone: "battlefield" },
                effects: [
                    {
                        op: "if",
                        predicate: {
                            left: {
                                counters: {
                                    of: { ref: "$each" },
                                    type: "fuse",
                                },
                            },
                            op: "ge",
                            right: 2,
                        },
                        then: [{ op: "destroy", target: { ref: "$each" } }],
                    },
                ],
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("accepts a counters value over the ability-site $source (issue #1015)", () => {
        const effects: EffectOp[] = [
            {
                op: "gainLife",
                player: "controller",
                amount: {
                    counters: { of: { ref: "$source" }, type: "charge" },
                },
            },
        ];
        // $source is only pre-declared at ability sites.
        expect(
            validateAbilityEffectScript(
                { id: "src-gain", effects },
                "Test Host"
            )
        ).toEqual([]);
    });

    it("rejects a malformed counters value (missing/empty type, unknown key, non-object of)", () => {
        for (const bad of [
            { op: "gainLife", player: "controller", amount: { counters: {} } },
            {
                op: "gainLife",
                player: "controller",
                amount: { counters: { of: { target: 0 } } }, // no type
            },
            {
                op: "gainLife",
                player: "controller",
                amount: { counters: { of: { target: 0 }, type: "" } }, // empty type
            },
            {
                op: "gainLife",
                player: "controller",
                amount: {
                    counters: { of: { target: 0 }, type: "fuse", extra: 1 },
                },
            },
            {
                op: "gainLife",
                player: "controller",
                amount: { counters: { of: 5, type: "fuse" } }, // of not a selector
            },
        ] as never[]) {
            const errors = validateEffectScript(host({ effects: [bad] }));
            expect(errors.length, JSON.stringify(bad)).toBeGreaterThan(0);
        }
    });

    it("rejects a counters value whose $source is unavailable at a spell site (issue #1015)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: {
                            counters: {
                                of: { ref: "$source" },
                                type: "charge",
                            },
                        },
                    },
                ] as never,
            })
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some((e) => /\$source/.test(e))).toBe(true);
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

describe("validateAiEffectsScript / validateAbilityAiEffectsScript — AI-only shadow scripts (PRD #1423, issue #1431/#1514)", () => {
    it("trivially passes a card with no aiEffects", () => {
        expect(validateAiEffectsScript(host({ resolve: () => {} }))).toEqual(
            []
        );
    });

    it("accepts a well-formed shadow script on a resolve()-only card (coexistence is legal)", () => {
        const errors = validateAiEffectsScript(
            host({
                resolve: () => {},
                aiEffects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
            })
        );
        expect(errors).toEqual([]);
    });

    it("rejects an unknown Op name in aiEffects (Mechanics Registry is still the authority)", () => {
        const errors = validateAiEffectsScript(
            host({
                resolve: () => {},
                aiEffects: [{ op: "vaproize", amount: 1 } as never],
            })
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/unknown Op "vaproize"/);
        expect(errors[0]).toContain("aiEffects");
    });

    it("rejects a dangling ref in aiEffects (same ref/binding integrity check as effects[])", () => {
        const errors = validateAiEffectsScript(
            host({
                resolve: () => {},
                aiEffects: [
                    { op: "destroy", target: { ref: "$nope.foo" } } as never,
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects a non-JSON-pure value in aiEffects (ADR 0046 purity)", () => {
        const errors = validateAiEffectsScript(
            host({
                resolve: () => {},
                aiEffects: [
                    { op: "draw", player: "controller", count: () => 1 },
                ] as never,
            })
        );
        expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects an empty aiEffects[]", () => {
        const errors = validateAiEffectsScript(
            host({ resolve: () => {}, aiEffects: [] })
        );
        expect(errors[0]).toMatch(/must not be empty/);
    });

    it("does NOT flag coexistence with resolve/resolveSteps/effect/modes as an error (shadow scripts are legitimate alongside them)", () => {
        const validAiEffects: EffectOp[] = [
            { op: "gainLife", player: "controller", amount: 1 },
        ];
        expect(
            validateAiEffectsScript(
                host({ resolve: () => {}, aiEffects: validAiEffects })
            )
        ).toEqual([]);
        expect(
            validateAiEffectsScript(
                host({ resolveSteps: [() => {}], aiEffects: validAiEffects })
            )
        ).toEqual([]);
        expect(
            validateAiEffectsScript(
                host({
                    effect: "destroy-target",
                    aiEffects: validAiEffects,
                })
            )
        ).toEqual([]);
    });

    it("ability-site: trivially passes an ability with no aiEffects", () => {
        expect(
            validateAbilityAiEffectsScript({ id: "a1" }, "Test (id)")
        ).toEqual([]);
    });

    it("ability-site: accepts a well-formed shadow script alongside resolve()", () => {
        const errors = validateAbilityAiEffectsScript(
            {
                id: "a1",
                resolve: () => {},
                aiEffects: [
                    { op: "gainLife", player: "controller", amount: 2 },
                ],
            },
            "Test (id)"
        );
        expect(errors).toEqual([]);
    });

    it("ability-site: rejects an unknown Op name in aiEffects", () => {
        const errors = validateAbilityAiEffectsScript(
            {
                id: "a1",
                resolve: () => {},
                aiEffects: [{ op: "vaproize", amount: 1 } as never],
            },
            "Test (id)"
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/unknown Op "vaproize"/);
        expect(errors[0]).toContain("aiEffects");
    });

    it("ability-site: accepts an $event ref at a trigger site (same $event scope as a real effects[] script)", () => {
        const errors = validateAbilityAiEffectsScript(
            {
                id: "trig",
                resolve: () => {},
                aiEffects: [
                    { op: "destroy", target: { ref: "$event.blockerId" } },
                ],
            },
            "Test (id)",
            "BLOCKERS_CONFIRMED"
        );
        expect(errors).toEqual([]);
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

    // issue #677 broadened `filter` to zone "library" and "hand" too (both
    // hidden-to-the-opponent zones the interpreter precomputes an explicit
    // `candidateIds` allow-list for); issue #680 broadened it to "graveyard"
    // too (Titania's "a LAND card", Exhume's "a CREATURE card") — the
    // interpreter's graveyard branch now precomputes the same allow-list from
    // the filter, so every zone accepts one.
    it("accepts a filter on the graveyard zone (issue #680 — Titania, Exhume)", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        {
                            ...choiceOp,
                            kind: "choose-graveyard-card",
                            zone: "graveyard",
                            filter: { type: "Creature" },
                        } as never,
                    ],
                })
            )
        ).toEqual([]);
        // ... and on the battlefield too.
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

    // issue #897 — the OR-ACROSS-fields `any` clause list (Magda, Brazen
    // Outlaw's "an artifact or Dragon card": `type: "Artifact"` OR
    // `subtype: "Dragon"`, two different fields).
    it("accepts a filter with a disjunctive any clause (issue #897)", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        {
                            ...choiceOp,
                            zone: "library",
                            filter: {
                                any: [
                                    { type: "Artifact" },
                                    { subtype: "Dragon" },
                                ],
                            },
                        } as never,
                    ],
                })
            )
        ).toEqual([]);
    });

    it("rejects an any clause that isn't a non-empty array of valid filters", () => {
        const emptyArray = validateEffectScript(
            host({
                effects: [
                    {
                        ...choiceOp,
                        zone: "library",
                        filter: { any: [] },
                    } as never,
                ],
            })
        );
        expect(emptyArray.some((e) => /field "filter"/.test(e))).toBe(true);

        const malformedClause = validateEffectScript(
            host({
                effects: [
                    {
                        ...choiceOp,
                        zone: "library",
                        filter: { any: [{ type: 123 }] },
                    } as never,
                ],
            })
        );
        expect(malformedClause.some((e) => /field "filter"/.test(e))).toBe(
            true
        );
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

// --- EffectCardFilter.manaCostEquals (issue #1881, ADR 0078 decision 8) ----

describe("validateEffectScript — EffectCardFilter.manaCostEquals (issue #1881)", () => {
    const libraryChoiceOp = (filter: Record<string, unknown>): EffectOp =>
        ({
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter,
            count: { min: 0, max: 1 },
            prompt: "Search your library for a card.",
            bind: "$picked",
        }) as never;

    it("accepts a scalar ManaCost clause, including generic/xFactor/phyrexian/hybrid pips", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [libraryChoiceOp({ manaCostEquals: {} })],
                })
            )
        ).toEqual([]);
        expect(
            validateEffectScript(
                host({
                    effects: [libraryChoiceOp({ manaCostEquals: { X: 1 } })],
                })
            )
        ).toEqual([]);
        expect(
            validateEffectScript(
                host({
                    effects: [libraryChoiceOp({ manaCostEquals: { X: "X" } })],
                })
            )
        ).toEqual([]);
        expect(
            validateEffectScript(
                host({
                    effects: [
                        libraryChoiceOp({
                            manaCostEquals: {
                                generic: 2,
                                B: 1,
                                xFactor: 2,
                                phyrexian: { U: 1 },
                                hybrid: [["B", "G"]],
                            },
                        }),
                    ],
                })
            )
        ).toEqual([]);
    });

    it("accepts a non-empty array clause (OR, mirroring subtype/type/color)", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        libraryChoiceOp({
                            manaCostEquals: [{}, { X: 1 }],
                        }),
                    ],
                })
            )
        ).toEqual([]);
    });

    it("rejects an empty array clause", () => {
        const errors = validateEffectScript(
            host({
                effects: [libraryChoiceOp({ manaCostEquals: [] })],
            })
        );
        expect(errors.some((e) => /field "filter"/.test(e))).toBe(true);
    });

    it("rejects a malformed pip (negative / non-integer)", () => {
        const negative = validateEffectScript(
            host({
                effects: [libraryChoiceOp({ manaCostEquals: { W: -1 } })],
            })
        );
        expect(negative.some((e) => /field "filter"/.test(e))).toBe(true);

        const fractional = validateEffectScript(
            host({
                effects: [libraryChoiceOp({ manaCostEquals: { W: 1.5 } })],
            })
        );
        expect(fractional.some((e) => /field "filter"/.test(e))).toBe(true);
    });

    it("rejects an unrecognised key inside the ManaCost value (fail closed)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    libraryChoiceOp({ manaCostEquals: { notAManaKey: 1 } }),
                ],
            })
        );
        expect(errors.some((e) => /field "filter"/.test(e))).toBe(true);
    });

    it("rejects a malformed hybrid pip (wrong arity / non-colour entry)", () => {
        const wrongArity = validateEffectScript(
            host({
                effects: [
                    libraryChoiceOp({
                        manaCostEquals: { hybrid: [["B"]] },
                    }),
                ],
            })
        );
        expect(wrongArity.some((e) => /field "filter"/.test(e))).toBe(true);

        const notAColor = validateEffectScript(
            host({
                effects: [
                    libraryChoiceOp({
                        manaCostEquals: { hybrid: [["B", "Z"]] },
                    }),
                ],
            })
        );
        expect(notAColor.some((e) => /field "filter"/.test(e))).toBe(true);
    });

    it("rejects a malformed phyrexian pip map", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    libraryChoiceOp({
                        manaCostEquals: { phyrexian: { Z: 1 } },
                    }),
                ],
            })
        );
        expect(errors.some((e) => /field "filter"/.test(e))).toBe(true);
    });
});

// --- EffectCardFilter.hasAbility — battlefield-only (issue #1097) -----------
//
// `hasAbility` reads the LIVE `staticAbilities` array via `toPermanentFilter`
// / `matchesPermanentFilter` (`gre/effects/interpreter.ts`) — a hidden-zone
// card shape (`matchesCardFilter`, hand/library/graveyard/exile) carries no
// ability data at all, so the field is REJECTED there as a static authoring
// error rather than silently validating and matching every card at runtime
// (the #897 fail-open class this repo already caught once). Pins the
// behaviour at the three sites the field is threaded through:
// `forEach`/`count`'s battlefield-vs-graveyard branch and `choice`'s
// zone-conditional filter.
describe("EffectCardFilter.hasAbility — rejected outside a live battlefield read (issue #1097)", () => {
    it("accepts hasAbility on a forEach permanents (battlefield) selector", () => {
        const effects: EffectOp[] = [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature", hasAbility: "flying" },
                },
                effects: [
                    { op: "dealDamage", amount: 1, to: { ref: "$each" } },
                ],
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects hasAbility on a forEach graveyard selector", () => {
        const effects: EffectOp[] = [
            {
                op: "forEach",
                select: {
                    set: "graveyard",
                    controller: "controller",
                    filter: { type: "Creature", hasAbility: "flying" },
                },
                effects: [
                    {
                        op: "moveZone",
                        target: { ref: "$each" },
                        to: "hand",
                    },
                ],
            },
        ];
        const errors = validateEffectScript(host({ effects }));
        expect(errors.some((e) => /field "select"/.test(e))).toBe(true);
    });

    it("accepts hasAbility on a count construct's battlefield zone", () => {
        const effects: EffectOp[] = [
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature", hasAbility: "flying" },
                    },
                },
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects hasAbility on a count construct's graveyard zone", () => {
        const effects: EffectOp[] = [
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "graveyard",
                        controller: "controller",
                        filter: { type: "Creature", hasAbility: "flying" },
                    },
                },
            },
        ];
        const errors = validateEffectScript(host({ effects }));
        expect(errors.length).toBeGreaterThan(0);
    });

    it("accepts hasAbility on a choice Op scoped to zone: battlefield", () => {
        const effects: EffectOp[] = [
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: { target: 0 },
                zone: "battlefield",
                filter: { type: "Creature", hasAbility: "flying" },
                count: 1,
                prompt: "Sacrifice a creature with flying.",
                bind: "$sac",
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects hasAbility on a choice Op scoped to zone: graveyard", () => {
        const effects: EffectOp[] = [
            {
                op: "choice",
                kind: "choose-graveyard-card",
                player: { target: 0 },
                zone: "graveyard",
                filter: { type: "Creature", hasAbility: "flying" },
                count: 1,
                prompt: "Choose a creature card with flying.",
                bind: "$picked",
            },
        ];
        const errors = validateEffectScript(host({ effects }));
        expect(
            errors.some((e) =>
                /filter\.hasAbility.*zone: "battlefield"/.test(e)
            )
        ).toBe(true);
    });
});

// --- EffectCardFilter.isAttacking — battlefield-only (issue #1097) ----------
//
// `isAttacking` is `hasAbility`'s combat-role sibling: it reads the LIVE
// `isAttacking` flag via `toPermanentFilter` / `matchesPermanentFilter`
// (`gre/effects/interpreter.ts`) — a hidden-zone card shape has no combat
// role at all, so the field is REJECTED there exactly like `hasAbility` is.
// Pins the same three sites `hasAbility`'s own describe block above pins.
describe("EffectCardFilter.isAttacking — rejected outside a live battlefield read (issue #1097)", () => {
    it("accepts isAttacking on a forEach permanents (battlefield) selector", () => {
        const effects: EffectOp[] = [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature", isAttacking: true },
                },
                effects: [{ op: "skipNextUntap", target: { ref: "$each" } }],
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects isAttacking on a forEach graveyard selector", () => {
        const effects: EffectOp[] = [
            {
                op: "forEach",
                select: {
                    set: "graveyard",
                    controller: "controller",
                    filter: { type: "Creature", isAttacking: true },
                },
                effects: [
                    {
                        op: "moveZone",
                        target: { ref: "$each" },
                        to: "hand",
                    },
                ],
            },
        ];
        const errors = validateEffectScript(host({ effects }));
        expect(errors.some((e) => /field "select"/.test(e))).toBe(true);
    });

    it("accepts isAttacking on a count construct's battlefield zone", () => {
        const effects: EffectOp[] = [
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature", isAttacking: true },
                    },
                },
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects isAttacking on a count construct's graveyard zone", () => {
        const effects: EffectOp[] = [
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "graveyard",
                        controller: "controller",
                        filter: { type: "Creature", isAttacking: true },
                    },
                },
            },
        ];
        const errors = validateEffectScript(host({ effects }));
        expect(errors.length).toBeGreaterThan(0);
    });

    it("accepts isAttacking on a choice Op scoped to zone: battlefield", () => {
        const effects: EffectOp[] = [
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: { target: 0 },
                zone: "battlefield",
                filter: { type: "Creature", isAttacking: true },
                count: 1,
                prompt: "Sacrifice an attacking creature.",
                bind: "$sac",
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects isAttacking on a choice Op scoped to zone: graveyard", () => {
        const effects: EffectOp[] = [
            {
                op: "choice",
                kind: "choose-graveyard-card",
                player: { target: 0 },
                zone: "graveyard",
                filter: { type: "Creature", isAttacking: true },
                count: 1,
                prompt: "Choose an attacking creature card.",
                bind: "$picked",
            },
        ];
        const errors = validateEffectScript(host({ effects }));
        expect(
            errors.some((e) =>
                /filter\.isAttacking.*zone: "battlefield"/.test(e)
            )
        ).toBe(true);
    });
});

// --- EffectCardFilter.controlledSinceTurnStart — battlefield-only
// (issue #1944) --------------------------------------------------------------
//
// The third sibling of `hasAbility`/`isAttacking`: Keldon Twilight's "…that
// they controlled since the beginning of the turn" reads a LIVE permanent's
// controller against the turn-scoped control-continuity ledger
// (`gre/controlContinuity.ts`) via `toPermanentFilter`. A card in a hidden
// zone has no controller at all (CR 108.4), so the field is REJECTED there
// rather than silently matching every card.
describe("EffectCardFilter.controlledSinceTurnStart — rejected outside a live battlefield read (issue #1944)", () => {
    it("accepts it on a choice Op scoped to zone: battlefield", () => {
        const effects: EffectOp[] = [
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: { target: 0 },
                zone: "battlefield",
                filter: { type: "Creature", controlledSinceTurnStart: true },
                count: 1,
                prompt: "Sacrifice a creature you have held all turn.",
                bind: "$sac",
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects it on a choice Op scoped to zone: graveyard", () => {
        const effects: EffectOp[] = [
            {
                op: "choice",
                kind: "choose-graveyard-card",
                player: { target: 0 },
                zone: "graveyard",
                filter: { type: "Creature", controlledSinceTurnStart: true },
                count: 1,
                prompt: "Choose a creature card.",
                bind: "$picked",
            },
        ];
        const errors = validateEffectScript(host({ effects }));
        expect(
            errors.some((e) =>
                /filter\.controlledSinceTurnStart.*zone: "battlefield"/.test(e)
            )
        ).toBe(true);
    });

    it("rejects it on a forEach graveyard selector", () => {
        const effects: EffectOp[] = [
            {
                op: "forEach",
                select: {
                    set: "graveyard",
                    controller: "controller",
                    filter: {
                        type: "Creature",
                        controlledSinceTurnStart: true,
                    },
                },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ];
        const errors = validateEffectScript(host({ effects }));
        expect(errors.some((e) => /field "select"/.test(e))).toBe(true);
    });

    it("accepts it on a forEach permanents (battlefield) selector", () => {
        const effects: EffectOp[] = [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: {
                        type: "Creature",
                        controlledSinceTurnStart: true,
                    },
                },
                effects: [{ op: "skipNextUntap", target: { ref: "$each" } }],
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });
});

// --- EffectCardFilter.excludeSource — battlefield-only (issue #2373) --------
//
// `excludeSource` ("another creature or an artifact", Gut, True Soul Zealot)
// is `hasAbility`'s self-identity sibling: it propagates onto
// `PermanentFilter.excludeInstanceIds` via `toPermanentFilter` — a hidden-zone
// card shape (`matchesCardFilter`) has no source-identity comparison to make
// at all, so the field is REJECTED there exactly like `hasAbility` is. Only
// wired through the `choice` Op today (the site Gut needs); pins that one
// site's accept/reject pair.
describe("EffectCardFilter.excludeSource — rejected outside a live battlefield read (issue #2373)", () => {
    it("accepts excludeSource on a choice Op scoped to zone: battlefield", () => {
        const effects: EffectOp[] = [
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: { target: 0 },
                zone: "battlefield",
                filter: { type: "Creature", excludeSource: true },
                count: { min: 0, max: 1 },
                prompt: "Sacrifice another creature.",
                bind: "$sac",
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects excludeSource on a choice Op scoped to zone: graveyard", () => {
        const effects: EffectOp[] = [
            {
                op: "choice",
                kind: "choose-graveyard-card",
                player: { target: 0 },
                zone: "graveyard",
                filter: { type: "Creature", excludeSource: true },
                count: 1,
                prompt: "Choose a creature card.",
                bind: "$picked",
            },
        ];
        const errors = validateEffectScript(host({ effects }));
        expect(
            errors.some((e) =>
                /filter\.excludeSource.*zone: "battlefield"/.test(e)
            )
        ).toBe(true);
    });

    it("accepts excludeSource nested inside an `any` clause (Gut's own shape)", () => {
        const effects: EffectOp[] = [
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: { target: 0 },
                zone: "battlefield",
                filter: {
                    any: [
                        { type: "Creature", excludeSource: true },
                        { type: "Artifact" },
                    ],
                },
                count: { min: 0, max: 1 },
                prompt: "Sacrifice another creature or an artifact.",
                bind: "$sac",
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });
});

// --- EffectCardFilter.manaCostEquals — REJECTED on a live battlefield read
// (issue #1898 finding 3) ----------------------------------------------------
//
// The INVERSE of the `hasAbility`/`isAttacking` describe blocks right above:
// those two fields are honest ONLY for `zone: "battlefield"` and rejected
// elsewhere; `manaCostEquals` is honest ONLY for a hidden-zone card shape
// (`matchesCardFilter`'s `card.cost`, read off the registry by `getHandCards`/
// `getLibraryCards`/`getGraveyardCards`/`getExileCards`) and must be REJECTED
// for `zone: "battlefield"` — `toPermanentFilter` (`gre/effects/
// interpreter.ts`) has no mapping for it at all, so an unguarded acceptance
// would validate cleanly and then silently match EVERY permanent at runtime
// (the exact fail-open hole this ticket exists to close). Pins the same
// selector sites `hasAbility`/`isAttacking` pin, PLUS `objectMatchesFilter`
// (always a live battlefield read, no zone field to switch on at all).
describe("EffectCardFilter.manaCostEquals — rejected on a live battlefield read (issue #1898 finding 3)", () => {
    it("accepts manaCostEquals on a forEach graveyard selector", () => {
        const effects: EffectOp[] = [
            {
                op: "forEach",
                select: {
                    set: "graveyard",
                    controller: "controller",
                    filter: { type: "Creature", manaCostEquals: {} },
                },
                effects: [
                    {
                        op: "moveZone",
                        target: { ref: "$each" },
                        to: "hand",
                    },
                ],
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects manaCostEquals on a forEach permanents (battlefield) selector", () => {
        const effects: EffectOp[] = [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Artifact", manaCostEquals: {} },
                },
                effects: [
                    { op: "dealDamage", amount: 1, to: { ref: "$each" } },
                ],
            },
        ];
        const errors = validateEffectScript(host({ effects }));
        expect(errors.some((e) => /field "select"/.test(e))).toBe(true);
    });

    it("accepts manaCostEquals on a count construct's graveyard zone", () => {
        const effects: EffectOp[] = [
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "graveyard",
                        controller: "controller",
                        filter: { type: "Creature", manaCostEquals: {} },
                    },
                },
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects manaCostEquals on a count construct's battlefield zone", () => {
        const effects: EffectOp[] = [
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Artifact", manaCostEquals: {} },
                    },
                },
            },
        ];
        const errors = validateEffectScript(host({ effects }));
        expect(errors.length).toBeGreaterThan(0);
    });

    it("accepts manaCostEquals on a choice Op scoped to zone: library", () => {
        const effects: EffectOp[] = [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { manaCostEquals: {} },
                count: { min: 0, max: 1 },
                prompt: "Search your library for a card.",
                bind: "$picked",
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects manaCostEquals on a choice Op scoped to zone: battlefield — the Urza's Saga III near-miss", () => {
        const effects: EffectOp[] = [
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: { target: 0 },
                zone: "battlefield",
                filter: { type: "Artifact", manaCostEquals: {} },
                count: 1,
                prompt: "Sacrifice an artifact with mana cost {0}.",
                bind: "$sac",
            },
        ];
        const errors = validateEffectScript(host({ effects }));
        expect(
            errors.some((e) =>
                /filter\.manaCostEquals.*zone: "battlefield"/.test(e)
            )
        ).toBe(true);
    });

    it("rejects manaCostEquals on an objectMatchesFilter predicate (always a live battlefield read, Figure of Destiny shape)", () => {
        const errors = validateAbilityEffectScript(
            {
                id: "ability",
                effects: [
                    {
                        op: "if",
                        predicate: {
                            objectMatchesFilter: { ref: "$source" },
                            filter: { manaCostEquals: {} },
                        },
                        then: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    },
                ],
            },
            "Test (id)"
        );
        expect(errors.length).toBeGreaterThan(0);
    });

    it("accepts an equivalent boundMatchesFilter predicate (CR 608.2h snapshot, unaffected)", () => {
        const errors = validateAbilityEffectScript(
            {
                id: "ability",
                effects: [
                    { op: "exile", target: { target: 0 }, bind: "$gone" },
                    {
                        op: "if",
                        predicate: {
                            boundMatchesFilter: { ref: "$gone" },
                            filter: { manaCostEquals: {} },
                        },
                        then: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    },
                ],
            },
            "Test (id)"
        );
        expect(errors).toEqual([]);
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

// --- forEach { set: "graveyard" }, simultaneous (CR 400.7 / 614-batch,
// issue #1094) -----------------------------------------------------------
describe("validateEffectScript — forEach simultaneous batch reanimation (CR 400.7 / 614-batch, issue #1094)", () => {
    const reanimateBody: EffectOp[] = [
        { op: "moveZone", target: { ref: "$each" }, to: "battlefield" },
    ];
    // `simultaneous` is a valid optional field on the forEach variant, so the
    // canonical shape type-checks without a cast.
    const replenishShape: EffectOp = {
        op: "forEach",
        select: { set: "graveyard", filter: { type: "Enchantment" } },
        simultaneous: true,
        effects: reanimateBody,
    };

    it("accepts the canonical shape (graveyard set + single reanimating moveZone body)", () => {
        expect(
            validateEffectScript(host({ effects: [replenishShape] }))
        ).toEqual([]);
    });

    it("accepts simultaneous with a controller override on the body moveZone", () => {
        const script: EffectOp = {
            op: "forEach",
            select: { set: "graveyard", filter: { type: "Enchantment" } },
            simultaneous: true,
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$each" },
                    to: "battlefield",
                    controller: "controller",
                },
            ],
        };
        expect(validateEffectScript(host({ effects: [script] }))).toEqual([]);
    });

    it("rejects simultaneous over a non-graveyard set", () => {
        const script: EffectOp = {
            op: "forEach",
            select: { set: "permanents", zone: "battlefield" },
            simultaneous: true,
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        };
        const errors = validateEffectScript(host({ effects: [script] }));
        expect(
            errors.some((e) =>
                /"simultaneous" is only valid with .* "graveyard"/.test(e)
            )
        ).toBe(true);
    });

    it("rejects simultaneous with a multi-Op body", () => {
        const script: EffectOp = {
            op: "forEach",
            select: { set: "graveyard", filter: { type: "Enchantment" } },
            simultaneous: true,
            effects: [
                ...reanimateBody,
                { op: "draw", player: "controller", count: 1 },
            ],
        };
        const errors = validateEffectScript(host({ effects: [script] }));
        expect(
            errors.some((e) => /"simultaneous" requires "effects"/.test(e))
        ).toBe(true);
    });

    it("rejects simultaneous with a body that doesn't move $each to the battlefield", () => {
        const wrongTo: EffectOp = {
            op: "forEach",
            select: { set: "graveyard", filter: { type: "Enchantment" } },
            simultaneous: true,
            effects: [{ op: "moveZone", target: { ref: "$each" }, to: "hand" }],
        };
        expect(
            validateEffectScript(host({ effects: [wrongTo] })).some((e) =>
                /"simultaneous" requires "effects"/.test(e)
            )
        ).toBe(true);

        const wrongTarget: EffectOp = {
            op: "forEach",
            select: { set: "graveyard", filter: { type: "Enchantment" } },
            simultaneous: true,
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "battlefield" },
            ],
        };
        expect(
            validateEffectScript(host({ effects: [wrongTarget] })).some((e) =>
                /"simultaneous" requires "effects"/.test(e)
            )
        ).toBe(true);
    });

    it("simultaneous defaults to false/absent — omitting it keeps the sequential per-member walk valid", () => {
        const sequential: EffectOp = {
            op: "forEach",
            select: { set: "graveyard", filter: { type: "Enchantment" } },
            effects: reanimateBody,
        };
        expect(validateEffectScript(host({ effects: [sequential] }))).toEqual(
            []
        );
    });

    it("rejects a non-boolean simultaneous value", () => {
        const script = {
            op: "forEach",
            select: { set: "graveyard", filter: { type: "Enchantment" } },
            simultaneous: "yes",
            effects: reanimateBody,
        } as unknown as EffectOp;
        const errors = validateEffectScript(host({ effects: [script] }));
        expect(
            errors.some((e) => /field "simultaneous" has invalid value/.test(e))
        ).toBe(true);
    });

    it("a valid simultaneous forEach script survives a JSON round-trip unchanged (ADR 0046 purity)", () => {
        expect(JSON.parse(JSON.stringify([replenishShape]))).toEqual([
            replenishShape,
        ]);
    });
});

describe("validateEffectScript — sacrifice Op (CR 701.16, issue #807)", () => {
    it("requires exactly one of `permanents` / `target`", () => {
        // Neither form present (issue #731 — the Op is now a `permanents`
        // picks OR a single `target`).
        const missing = validateEffectScript(
            host({ effects: [{ op: "sacrifice" } as never] })
        );
        expect(missing.some((e) => /exactly one of "permanents"/.test(e))).toBe(
            true
        );
        // Both forms present — also rejected.
        const both = validateEffectScript(
            host({
                effects: [
                    {
                        op: "sacrifice",
                        permanents: { ref: "$sac" },
                        target: { target: 0 },
                    },
                ] as never,
            })
        );
        expect(both.some((e) => /exactly one of "permanents"/.test(e))).toBe(
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

describe("validateEffectScript — reveal Op (CR 701.20a, issue #945)", () => {
    it('requires exactly one of "zone" / "cards"', () => {
        // Both shapes present — rejected (the XOR guard at validate.ts:1073).
        const both = validateEffectScript(
            host({
                effects: [
                    {
                        op: "reveal",
                        player: "controller",
                        zone: "hand",
                        cards: { ref: "$sac" },
                    },
                ] as never,
            })
        );
        expect(
            both.some((e) => /exactly one of "zone" or "cards"/.test(e))
        ).toBe(true);
        // Neither shape present — also rejected.
        const neither = validateEffectScript(
            host({
                effects: [{ op: "reveal", player: "controller" }] as never,
            })
        );
        expect(
            neither.some((e) => /exactly one of "zone" or "cards"/.test(e))
        ).toBe(true);
    });
});

// coinFlip's win/loss branch grammar (CR 705, issue #851) accepts a
// deliberate no-op branch — `effects: []` — as of issue #1367 (Mana Crypt's
// win branch does nothing at all). The relaxation is LENGTH-only: a branch
// still needs a `consequence` string and an `effects` ARRAY, so a branch
// missing `effects` entirely, or carrying a non-array value, stays rejected
// (fail-closed).
describe("validateEffectScript — coinFlip no-op branch (issue #1367)", () => {
    it("accepts a coinFlip whose win branch has an empty effects[] (Mana Crypt shape)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "coinFlip",
                        win: { consequence: "Nothing happens.", effects: [] },
                        loss: {
                            consequence: "Deals 3 damage to you.",
                            effects: [
                                {
                                    op: "dealDamage",
                                    amount: 3,
                                    to: { player: "controller" },
                                },
                            ],
                        },
                    },
                ],
            })
        );
        expect(errors).toEqual([]);
    });

    it("still requires an `effects` array on each branch — missing entirely is rejected", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "coinFlip",
                        win: { consequence: "Nothing happens." },
                        loss: {
                            consequence: "Lose 3 life.",
                            effects: [
                                {
                                    op: "loseLife",
                                    player: "controller",
                                    amount: 3,
                                },
                            ],
                        },
                    } as never,
                ],
            })
        );
        expect(
            errors.some((e) =>
                /Op "coinFlip" field "win" has invalid value/.test(e)
            )
        ).toBe(true);
    });

    it("still requires an `effects` array on each branch — a non-array value is rejected", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "coinFlip",
                        win: {
                            consequence: "Nothing happens.",
                            effects: "not-an-array",
                        },
                        loss: {
                            consequence: "Lose 3 life.",
                            effects: [
                                {
                                    op: "loseLife",
                                    player: "controller",
                                    amount: 3,
                                },
                            ],
                        },
                    } as never,
                ],
            })
        );
        expect(
            errors.some((e) =>
                /Op "coinFlip" field "win" has invalid value/.test(e)
            )
        ).toBe(true);
    });

    it("the same relaxation applies to coinFlipSync's branches", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "coinFlipSync",
                        win: { consequence: "Nothing happens.", effects: [] },
                        loss: {
                            consequence: "Deals 3 damage to you.",
                            effects: [
                                {
                                    op: "dealDamage",
                                    amount: 3,
                                    to: { player: "controller" },
                                },
                            ],
                        },
                    },
                ],
            })
        );
        expect(errors).toEqual([]);
    });
});

// delayedTrigger Op schema + capture/body scoping (CR 603.7, ADR 0048, issue
// #838). The body is validated as a FRESH script (its only initial bindings
// are the capture keys); capture sources resolve in the OUTER scope.
describe("validateEffectScript — delayedTrigger Op (CR 603.7, ADR 0048)", () => {
    const wellFormed: EffectOp[] = [
        { op: "destroy", target: { target: 0 }, bind: "$dead" },
        {
            op: "delayedTrigger",
            timing: "next-end-step",
            oracleText: "At the beginning of the next end step, do things.",
            capture: {
                $it: { target: 0 },
                $who: { ref: "$dead.controller" },
                $tag: "a-literal",
            },
            effects: [
                { op: "destroy", target: { ref: "$it" } },
                { op: "loseLife", player: { ref: "$who" }, amount: 1 },
            ],
        },
    ];

    it("accepts capture from a target slot, a .controller ref and a literal, with a body reading them", () => {
        expect(validateEffectScript(host({ effects: wellFormed }))).toEqual([]);
    });

    it("rejects an unknown timing and a missing oracleText", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-eon",
                        effects: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    } as never,
                ],
            })
        );
        expect(errors.some((e) => /field "timing"/.test(e))).toBe(true);
        expect(errors.some((e) => /missing field "oracleText"/.test(e))).toBe(
            true
        );
    });

    it("rejects an empty body", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-end-step",
                        oracleText: "x",
                        effects: [],
                    } as never,
                ],
            })
        );
        expect(errors.some((e) => /non-empty Op list/.test(e))).toBe(true);
    });

    it("requires targetPlayer for the player-scoped timings and rejects it elsewhere (CR 504/505)", () => {
        const missing = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-main-phase",
                        oracleText: "x",
                        effects: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    } as never,
                ],
            })
        );
        expect(missing.some((e) => /"targetPlayer" is required/.test(e))).toBe(
            true
        );
        const extra = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-end-step",
                        oracleText: "x",
                        targetPlayer: "controller",
                        effects: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    } as never,
                ],
            })
        );
        expect(
            extra.some((e) => /only valid with the player-scoped/.test(e))
        ).toBe(true);
    });

    it("rejects a capture ref naming an undefined outer binding", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-end-step",
                        oracleText: "x",
                        capture: { $it: { ref: "$ghost" } },
                        effects: [{ op: "destroy", target: { ref: "$it" } }],
                    } as never,
                ],
            })
        );
        expect(errors.some((e) => /undefined binding "\$ghost"/.test(e))).toBe(
            true
        );
    });

    it("rejects a body ref that reaches for an OUTER binding — the body scope is the capture keys only", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    { op: "destroy", target: { target: 0 }, bind: "$dead" },
                    {
                        op: "delayedTrigger",
                        timing: "next-end-step",
                        oracleText: "x",
                        effects: [
                            // `$dead` is an outer binding — NOT visible at
                            // fire time (ADR 0048: captures only).
                            {
                                op: "gainLife",
                                player: { ref: "$dead.controller" },
                                amount: 1,
                            },
                        ],
                    } as never,
                ],
            })
        );
        expect(errors.some((e) => /undefined binding "\$dead"/.test(e))).toBe(
            true
        );
    });

    it("rejects a nested delayedTrigger inside a delayedTrigger body (ADR 0048)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-end-step",
                        oracleText: "x",
                        effects: [
                            {
                                op: "delayedTrigger",
                                timing: "next-end-step",
                                oracleText: "y",
                                effects: [
                                    {
                                        op: "gainLife",
                                        player: "controller",
                                        amount: 1,
                                    },
                                ],
                            },
                        ],
                    } as never,
                ],
            })
        );
        expect(
            errors.some((e) => /must not nest inside a delayedTrigger/.test(e))
        ).toBe(true);
    });

    it("rejects reserved capture keys and non-property power captures", () => {
        const reserved = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-end-step",
                        oracleText: "x",
                        capture: { $each: { target: 0 } },
                        effects: [{ op: "destroy", target: { ref: "$each" } }],
                    } as never,
                ],
            })
        );
        expect(
            reserved.some((e) => /field "capture" has invalid value/.test(e))
        ).toBe(true);
        const power = validateEffectScript(
            host({
                effects: [
                    { op: "destroy", target: { target: 0 }, bind: "$dead" },
                    {
                        op: "delayedTrigger",
                        timing: "next-end-step",
                        oracleText: "x",
                        capture: { $n: { ref: "$dead.power" } },
                        effects: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    } as never,
                ],
            })
        );
        expect(
            power.some((e) => /only ".controller" property captures/.test(e))
        ).toBe(true);
    });

    // CR 603.7a / 603.10 (issue #1470) — the INDEFINITE instance leave-watch
    // shares every field rule with its this-turn twin; it differs only at the
    // CLEANUP purge (phases.ts), which the validator never sees.
    it("accepts the indefinite leave-watch timing with a watch, and requires the watch", () => {
        const ok = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "leaves-battlefield-indefinite",
                        oracleText:
                            "When it dies or is exiled, return it to the battlefield tapped.",
                        watch: { target: 0 },
                        capture: { $land: { target: 0 } },
                        effects: [
                            {
                                op: "moveZone",
                                target: { ref: "$land" },
                                from: "graveyard",
                                to: "battlefield",
                                tapped: true,
                            },
                        ],
                    },
                ],
            })
        );
        expect(ok).toEqual([]);
        const missing = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "leaves-battlefield-indefinite",
                        oracleText: "x",
                        effects: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    },
                ],
            })
        );
        expect(
            missing.some((e) =>
                /"leaves-battlefield-indefinite" is instance-scoped/.test(e)
            )
        ).toBe(true);
    });

    // CR 603.7a / 509.1h — the unblocked-attack watch is the THIRD
    // instance-scoped timing: same required `watch`, different firing event
    // (ATTACKER_UNBLOCKED instead of PERMANENT_LEFT). The validator must treat
    // it exactly like the leave-watches, and must still REJECT a `watch` on a
    // phase-boundary timing (a `startsWith("leaves-battlefield")`-style check
    // would have silently let one through).
    it("accepts the unblocked-attack timing with a watch, requires the watch, and still rejects a watch on a phase-boundary timing", () => {
        const ok = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "attacks-unblocked",
                        oracleText:
                            "When that creature attacks and isn't blocked this turn, you gain life equal to its power.",
                        watch: { target: 0 },
                        capture: { $c: { target: 0 } },
                        effects: [
                            {
                                op: "gainLife",
                                player: "controller",
                                amount: { ref: "$c.power" },
                            },
                        ],
                    },
                ],
            })
        );
        expect(ok).toEqual([]);
        const missing = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "attacks-unblocked",
                        oracleText: "x",
                        effects: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    },
                ],
            })
        );
        expect(
            missing.some((e) =>
                /"attacks-unblocked" is instance-scoped/.test(e)
            )
        ).toBe(true);
        const strayWatch = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-end-step",
                        oracleText: "x",
                        watch: { target: 0 },
                        effects: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    },
                ],
            })
        );
        expect(
            strayWatch.some((e) =>
                /field "watch" is only valid with the instance-scoped timings/.test(
                    e
                )
            )
        ).toBe(true);
    });
});

// --- delayedTrigger LIST-valued capture (ADR 0049, issue #866) --------------
// A `{ select }` capture source freezes a `string[]` list binding; the body
// iterates it with `forEach { set: "bound", ref }`. The validator: accepts the
// list-select capture shape, types the body binding as a `list` family, and
// requires a `{ set: "bound" }` ref to name a list binding (never a scalar one).
describe("validateEffectScript — delayedTrigger LIST capture (ADR 0049, issue #866)", () => {
    const wellFormed: EffectOp[] = [
        {
            op: "delayedTrigger",
            timing: "next-end-of-combat",
            oracleText:
                "At end of combat, destroy all creatures that blocked or were blocked by it.",
            capture: {
                $partners: {
                    select: { set: "combatPartners", of: { target: 0 } },
                },
            },
            effects: [
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$partners" },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
        },
    ];

    it("accepts a combatPartners list capture iterated by a bound forEach", () => {
        expect(validateEffectScript(host({ effects: wellFormed }))).toEqual([]);
    });

    it("rejects a bound forEach whose ref names an undefined binding", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-end-of-combat",
                        oracleText: "x",
                        effects: [
                            {
                                op: "forEach",
                                select: { set: "bound", ref: "$ghost" },
                                effects: [
                                    { op: "destroy", target: { ref: "$each" } },
                                ],
                            },
                        ],
                    } as never,
                ],
            })
        );
        expect(
            errors.some((e) =>
                /forEach \{ set: "bound" \} ref "\$ghost" references undefined/.test(
                    e
                )
            )
        ).toBe(true);
    });

    it("rejects a bound forEach whose ref names a NON-list binding (a snapshot)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    // `$dead` is a snapshot binding, not a list — a bound set
                    // may only iterate a list-valued capture.
                    { op: "destroy", target: { target: 0 }, bind: "$dead" },
                    {
                        op: "forEach",
                        select: { set: "bound", ref: "$dead" },
                        effects: [{ op: "destroy", target: { ref: "$each" } }],
                    } as never,
                ],
            })
        );
        expect(
            errors.some((e) =>
                /forEach \{ set: "bound" \} ref "\$dead" names a snapshot binding/.test(
                    e
                )
            )
        ).toBe(true);
    });

    it("rejects a list-valued capture with an unknown set", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-end-of-combat",
                        oracleText: "x",
                        capture: {
                            $partners: {
                                select: { set: "bogusSet", of: { target: 0 } },
                            },
                        },
                        effects: [
                            {
                                op: "forEach",
                                select: { set: "bound", ref: "$partners" },
                                effects: [
                                    { op: "destroy", target: { ref: "$each" } },
                                ],
                            },
                        ],
                    } as never,
                ],
            })
        );
        expect(
            errors.some((e) => /field "capture" has invalid value/.test(e))
        ).toBe(true);
    });

    it("rejects a scalar ref that reads a list binding in an object position (family mismatch)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-end-of-combat",
                        oracleText: "x",
                        capture: {
                            $partners: {
                                select: {
                                    set: "combatPartners",
                                    of: { target: 0 },
                                },
                            },
                        },
                        // A list binding has no scalar object position — reading
                        // `$partners` as a single object is a family error.
                        effects: [
                            { op: "destroy", target: { ref: "$partners" } },
                        ],
                    } as never,
                ],
            })
        );
        expect(
            errors.some((e) =>
                /names a list binding in an object position/.test(e)
            )
        ).toBe(true);
    });
});

// --- forEach{set:"bound"} widened to accept PICKS bindings (issue #1284) ----
// A `choice` Op's `bind` (family "picks") and a delayedTrigger/divideIntoPiles
// list-valued capture (family "list") are the IDENTICAL `string[]` runtime
// storage — `readBinding`/`recallChoice` don't distinguish them, and
// `execForEach`'s per-member `$each` snapshot binding is produced the same way
// regardless of which family supplied the member set. This was a
// validator-only restriction (the interpreter already ran a picks-family bound
// forEach correctly, per the issue's throwaway spike); the four frozen
// structural constructs (bind/ref/if/forEach, ADR 0045) stay frozen — this
// only widens an existing family-check allow-list.
describe('validateEffectScript — forEach{set:"bound"} accepts a PICKS binding (issue #1284)', () => {
    it("accepts a choice Op's picks binding iterated by a bound forEach", () => {
        const script: EffectOp[] = [
            {
                op: "choice",
                kind: "choose-permanents",
                player: "controller",
                zone: "battlefield",
                filter: { type: "Land" },
                count: { min: 0, max: 3 },
                prompt: "Untap up to three lands.",
                bind: "$lands",
            },
            {
                op: "forEach",
                select: { set: "bound", ref: "$lands" },
                effects: [
                    {
                        op: "tapUntap",
                        action: "untap",
                        target: { ref: "$each" },
                    },
                ],
            },
        ];
        expect(validateEffectScript(host({ effects: script }))).toEqual([]);
    });

    it("still rejects a bound forEach whose ref names a BOOLEAN binding (a mayPay bind)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "mayPay",
                        player: "controller",
                        prompt: "Pay {1}?",
                        cost: { generic: 1 },
                        bind: "$paid",
                    },
                    {
                        op: "forEach",
                        select: { set: "bound", ref: "$paid" },
                        effects: [{ op: "destroy", target: { ref: "$each" } }],
                    } as never,
                ],
            })
        );
        expect(
            errors.some((e) =>
                /forEach \{ set: "bound" \} ref "\$paid" names a boolean binding/.test(
                    e
                )
            )
        ).toBe(true);
    });
});

// --- $event.<field> refs at trigger sites (ADR 0049, issue #865) ------------
// `$event.<field>` is legal ONLY at a triggered-ability site: the validator
// carries the firing event type (from `TriggeredAbility.event`) and checks the
// EVENT_FIELD_REGISTRY family against the ref position. It is rejected at spell
// / activated sites (no firing event), in a delayedTrigger BODY (the event is
// gone at fire time), for an uncensused field, and on a family mismatch.
describe("validateAbilityEffectScript — $event.<field> refs (ADR 0049, issue #865)", () => {
    const abilityHost = (effects: EffectOp[]) => ({
        id: "trig",
        effects,
    });

    it("accepts an object-family $event ref in an object position at a trigger site", () => {
        const errors = validateAbilityEffectScript(
            abilityHost([
                { op: "destroy", target: { ref: "$event.blockerId" } },
            ]),
            "Test (id)",
            "BLOCKERS_CONFIRMED"
        );
        expect(errors).toEqual([]);
    });

    it("accepts a player-family $event ref in a player position at a trigger site", () => {
        const errors = validateAbilityEffectScript(
            abilityHost([
                {
                    op: "loseLife",
                    player: { ref: "$event.damagedPlayer" },
                    amount: 1,
                },
            ]),
            "Test (id)",
            "DAMAGE_DEALT"
        );
        expect(errors).toEqual([]);
    });

    it("accepts an $event ref as a delayedTrigger CAPTURE source (nested in the trigger's own script)", () => {
        const errors = validateAbilityEffectScript(
            abilityHost([
                {
                    op: "delayedTrigger",
                    timing: "next-end-of-combat",
                    oracleText: "destroy the blocker at end of combat",
                    capture: { $blk: { ref: "$event.blockerId" } },
                    effects: [{ op: "destroy", target: { ref: "$blk" } }],
                },
            ]),
            "Test (id)",
            "BLOCKERS_CONFIRMED"
        );
        expect(errors).toEqual([]);
    });

    it("rejects a family mismatch (object field in a player position)", () => {
        const errors = validateAbilityEffectScript(
            abilityHost([
                {
                    op: "loseLife",
                    player: { ref: "$event.blockerId" },
                    amount: 1,
                },
            ]),
            "Test (id)",
            "BLOCKERS_CONFIRMED"
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toContain(
            "object field in a player position"
        );
    });

    it("rejects an uncensused $event field", () => {
        const errors = validateAbilityEffectScript(
            abilityHost([{ op: "destroy", target: { ref: "$event.bogusId" } }]),
            "Test (id)",
            "BLOCKERS_CONFIRMED"
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toContain("not a censused field");
    });

    it("rejects $event inside a delayedTrigger BODY (event gone at fire time)", () => {
        const errors = validateAbilityEffectScript(
            abilityHost([
                {
                    op: "delayedTrigger",
                    timing: "next-end-of-combat",
                    oracleText: "…",
                    effects: [
                        {
                            op: "destroy",
                            target: { ref: "$event.blockerId" },
                        },
                    ],
                },
            ]),
            "Test (id)",
            "BLOCKERS_CONFIRMED"
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toContain("delayedTrigger body");
    });

    it("rejects $event on an ACTIVATED ability (no firing event)", () => {
        // No trigger event type passed → activated site.
        const errors = validateAbilityEffectScript(
            abilityHost([
                { op: "destroy", target: { ref: "$event.blockerId" } },
            ]),
            "Test (id)"
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toContain("triggered-ability site");
    });

    it("rejects $event at a SPELL site", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    { op: "destroy", target: { ref: "$event.blockerId" } },
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toContain("triggered-ability site");
    });
});

describe("validateEffectScript — createTokenCopy `source` is an OBJECT position (issue #1459 / #1461)", () => {
    it("accepts a forEach `$each` snapshot as the copy source", () => {
        // Ocelot Pride's shape: iterate the tokens you control that entered
        // this turn and copy each one. `source` must be classified as an
        // object position by the ordered ref pass — otherwise the bare
        // `$each` binding name is parsed as a `<binding>.<property>` numeric
        // ref and reported as a malformed ref.
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "forEach",
                        select: {
                            set: "permanents",
                            zone: "battlefield",
                            controller: "controller",
                            filter: { isToken: true, enteredThisTurn: true },
                        },
                        effects: [
                            {
                                op: "createTokenCopy",
                                source: { ref: "$each" },
                                controller: "controller",
                            },
                        ],
                    },
                ],
            })
        );
        expect(errors).toEqual([]);
    });

    // CR 707.2's "except" clause (issue #2339). It is a JSON-pure literal bag
    // that `applyCopy` reads by KEY, so an unrecognised key is a silent no-op —
    // the exception simply never happens and the card ships wrong with a green
    // suite. The validator therefore rejects unknown keys and mistyped values
    // outright. (`$source` is pre-declared at ABILITY sites only, so these use
    // the same forEach `$each` source shape as the case above.)
    const withExcept = (except: unknown) =>
        host({
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { isToken: true },
                    },
                    effects: [
                        {
                            op: "createTokenCopy",
                            source: { ref: "$each" },
                            controller: "controller",
                            except,
                        },
                    ],
                } as unknown as EffectOp,
            ],
        });

    it("accepts a well-formed CR 707.2 `except` clause", () => {
        expect(
            validateEffectScript(
                withExcept({
                    basePower: 4,
                    baseToughness: 4,
                    colors: ["B"],
                    additionalSubtypes: ["Zombie"],
                    noManaCost: true,
                    imagePrintId: "print-id",
                })
            )
        ).toEqual([]);
    });

    it("rejects an `except` clause with an unknown key", () => {
        // A typo'd exception must be LOUD: `basePwer` would otherwise leave the
        // token at the copied card's printed body with nothing to show for it.
        const errors = validateEffectScript(withExcept({ basePwer: 4 }));
        expect(errors.join("\n")).toContain("except");
    });

    it("rejects an `except` clause with a mistyped value", () => {
        const errors = validateEffectScript(withExcept({ colors: ["Zombie"] }));
        expect(errors.join("\n")).toContain("except");
    });

    it("rejects an EMPTY `except` clause", () => {
        expect(validateEffectScript(withExcept({})).join("\n")).toContain(
            "except"
        );
    });

    it("still rejects an undefined binding in the source position", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "createTokenCopy",
                        source: { ref: "$nope" },
                        controller: "controller",
                    } as EffectOp,
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toContain("undefined binding");
    });
});

// issue #1568 — `{ opponentOf: EffectPlayerRef }`'s `collectRefUses` branch
// (validate.ts, "the wrapped ref occupies the EXACT SAME player position as
// the wrapping key"). A `{ ref }` nested inside `{ opponentOf }` must be
// classified with the OUTER keyHint (here "player"), not the child key name
// "opponentOf" the generic fallback would otherwise use — which mistags the
// ref as a "number" position and rejects `.controller` as an unknown
// property path. None of the four interpreter tests for this issue
// (`interpreter.test.ts`, "Effect Script player ref: { opponentOf }") use a
// bare `{ ref }` inside `{ opponentOf }` — they only exercise `"controller"`
// and `{ controllerOf: { target } }`, neither of which is a `{ ref }` shape —
// so this branch shipped with zero coverage; these are its tests.
describe("validateEffectScript — { opponentOf } wraps a { ref } at the SAME keyHint (issue #1568)", () => {
    it("accepts a { ref } nested ONE level inside { opponentOf } — Fractured Identity's own shape once the target's controller is captured by a bind", () => {
        const effects: EffectOp[] = [
            { op: "destroy", target: { target: 0 }, bind: "$dead" },
            {
                op: "gainLife",
                player: { opponentOf: { ref: "$dead.controller" } },
                amount: 1,
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("accepts a { ref } nested TWO levels inside { opponentOf } — the wrapper is recursive and re-complementing twice still resolves a player position", () => {
        const effects: EffectOp[] = [
            { op: "destroy", target: { target: 0 }, bind: "$dead" },
            {
                op: "gainLife",
                player: {
                    opponentOf: { opponentOf: { ref: "$dead.controller" } },
                },
                amount: 1,
            },
        ];
        expect(validateEffectScript(host({ effects }))).toEqual([]);
    });

    it("rejects { opponentOf: 42 } — the wrapped value must itself be an EffectPlayerRef", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "gainLife",
                        player: { opponentOf: 42 } as never,
                        amount: 1,
                    },
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toMatch(/field "player" has invalid value/);
    });

    it("rejects { opponentOf, ...extraKey } — the grammar is frozen to the single opponentOf key", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "gainLife",
                        player: {
                            opponentOf: "controller",
                            extra: "nope",
                        } as never,
                        amount: 1,
                    },
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toMatch(/field "player" has invalid value/);
    });
});

// issue #1726 — the moveZone POSITIONAL LIBRARY INSERT: a battlefield
// permanent target → library at a 1-based position from the top (Teferi,
// Hero of Dominaria's −3 "third from the top"). Permanent schema coverage
// for the new "position" field.
describe("validateEffectScript — moveZone target → library position (issue #1726)", () => {
    it("accepts a well-formed positional library insert", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "moveZone",
                        target: { target: 0 },
                        to: "library",
                        position: 3,
                    } as EffectOp,
                ],
            })
        );
        expect(errors).toEqual([]);
    });

    it('accepts an omitted "position" with to: "library" (top default / graveyard shuffle-in path)', () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "moveZone",
                        target: { target: 0 },
                        to: "library",
                    } as EffectOp,
                ],
            })
        );
        expect(errors).toEqual([]);
    });

    it('rejects "position" with a non-library destination', () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "moveZone",
                        target: { target: 0 },
                        to: "hand",
                        position: 3,
                    } as EffectOp,
                ],
            })
        );
        expect(errors.join("\n")).toContain(
            'field "position" is only valid with "target" and to: "library"'
        );
    });

    it('rejects "position" on a non-target shape', () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "moveZone",
                        player: "controller",
                        from: "hand",
                        to: "library",
                        position: 3,
                    } as EffectOp,
                ],
            })
        );
        expect(errors.join("\n")).toContain(
            'field "position" is only valid on the "target" shape'
        );
    });

    it("rejects a non-positive position", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "moveZone",
                        target: { target: 0 },
                        to: "library",
                        position: 0,
                    } as EffectOp,
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
    });
});

// issue #1104 — the moveZone FOURTH shape: a filter-driven bulk sweep across
// one or more zones (Lobotomy). Permanent schema coverage for the new
// "fromZones" discriminator.
describe("validateEffectScript — moveZone fromZones/filter shape (issue #1104)", () => {
    it("accepts a well-formed fromZones sweep", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "choice",
                        kind: "choose-hand-card",
                        player: "controller",
                        zone: "hand",
                        zoneOwnerId: { target: 0 },
                        count: 1,
                        prompt: "Choose a card",
                        bind: "$chosen",
                    },
                    {
                        op: "moveZone",
                        player: { target: 0 },
                        fromZones: ["graveyard", "hand", "library"],
                        filter: { name: { ref: "$chosen" } },
                        to: "exile",
                    } as EffectOp,
                ],
            })
        );
        expect(errors).toEqual([]);
    });

    it('requires "player" alongside fromZones', () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "moveZone",
                        fromZones: ["hand"],
                        filter: { name: "Bear" },
                        to: "exile",
                    } as EffectOp,
                ],
            })
        );
        expect(errors.join("\n")).toContain(
            'field "player" is required with "fromZones"'
        );
    });

    it('requires "filter" alongside fromZones', () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "moveZone",
                        player: "controller",
                        fromZones: ["hand"],
                        to: "exile",
                    } as EffectOp,
                ],
            })
        );
        expect(errors.join("\n")).toContain(
            'field "filter" is required with "fromZones"'
        );
    });

    it("rejects fromZones combined with target or cards", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "moveZone",
                        target: { target: 0 },
                        player: "controller",
                        fromZones: ["hand"],
                        filter: { name: "Bear" },
                        to: "exile",
                    } as EffectOp,
                ],
            })
        );
        expect(errors.join("\n")).toContain(
            'at most one of "target" / "cards" / "fromZones"'
        );
    });

    it('rejects to: "battlefield" and to: "library-top" for the fromZones shape', () => {
        for (const to of ["battlefield", "library-top"]) {
            const errors = validateEffectScript(
                host({
                    effects: [
                        {
                            op: "moveZone",
                            player: "controller",
                            fromZones: ["hand"],
                            filter: { name: "Bear" },
                            to,
                        } as EffectOp,
                    ],
                })
            );
            expect(errors.join("\n")).toContain(
                `to: "${to}" is not valid with "fromZones"`
            );
        }
    });

    it("rejects an empty fromZones array", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "moveZone",
                        player: "controller",
                        fromZones: [],
                        filter: { name: "Bear" },
                        to: "exile",
                    } as EffectOp,
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects "filter" on a shape other than fromZones', () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "moveZone",
                        target: { target: 0 },
                        filter: { name: "Bear" },
                        to: "hand",
                    } as EffectOp,
                ],
            })
        );
        expect(errors.join("\n")).toContain(
            'field "filter" is only valid with "fromZones"'
        );
    });
});

// `choice.candidates` + `choice.bindOther` — the constructs that make
// "choose one of THEM, then act on the other" (Barrin's Spite) expressible:
// the pick is narrowed to already-known battlefield objects, and the
// complement is snapshotted under its own binding.
/** Drops a key entirely — an optional field set to `undefined` is not the same
 *  as an absent one for `Object.keys`-based schema walks. */
function omitKey(op: EffectOp, key: string): EffectOp {
    const clone = { ...(op as Record<string, unknown>) };
    delete clone[key];
    return clone as EffectOp;
}

describe("validateEffectScript — choice candidates / bindOther", () => {
    const candidateChoice = (over: Record<string, unknown> = {}) =>
        ({
            op: "choice",
            kind: "sacrifice-permanents",
            player: { controllerOf: { target: 0 } },
            zone: "battlefield",
            candidates: [{ target: 0 }, { target: 1 }],
            count: 1,
            prompt: "Choose which of the two creatures to sacrifice",
            bind: "$sacrificed",
            bindOther: "$spared",
            ...over,
        }) as EffectOp;

    it("accepts the well-formed shape and resolves a ref to bindOther", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    candidateChoice(),
                    {
                        op: "sacrifice",
                        permanents: { ref: "$sacrificed" },
                    } as EffectOp,
                    {
                        op: "moveZone",
                        target: { ref: "$spared" },
                        to: "hand",
                    } as EffectOp,
                ],
            })
        );
        expect(errors).toEqual([]);
    });

    it("rejects candidates outside the battlefield", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    candidateChoice({
                        kind: "choose-hand-card",
                        zone: "hand",
                    }),
                ],
            })
        );
        expect(errors.join("\n")).toContain(
            'valid only with zone: "battlefield"'
        );
    });

    it("rejects bindOther without candidates", () => {
        const errors = validateEffectScript(
            host({
                effects: [omitKey(candidateChoice(), "candidates")],
            })
        );
        expect(errors.join("\n")).toContain(
            '"bindOther" requires "candidates"'
        );
    });

    it("rejects a bindOther name that re-declares an existing binding", () => {
        const errors = validateEffectScript(
            host({
                effects: [candidateChoice({ bindOther: "$sacrificed" })],
            })
        );
        expect(errors.join("\n")).toContain("re-declares an existing binding");
    });
});

// --- exileSelf / shuffleSelfIntoLibrary on a PERMANENT spell (issue #1097) --
//
// Both Ops redirect the resolving SPELL's own post-resolution destination —
// but only `finalizeSpellResolution`'s non-permanent branch (`gre/state.ts`)
// ever reads either flag. A permanent card (Creature/Artifact/Enchantment/
// Planeswalker/Battle/Land, CR 300.1) declaring either Op in its
// spell-resolution `effects[]` would get a functional-looking no-op instead
// of the redirect it names — caught here as a static authoring error instead.
describe("validateEffectScript — exileSelf/shuffleSelfIntoLibrary rejected on a permanent spell (issue #1097)", () => {
    it("rejects exileSelf on a Creature card", () => {
        const errors = validateEffectScript(
            host({
                types: ["Creature"],
                effects: [{ op: "exileSelf" }],
            })
        );
        expect(
            errors.some(
                (e) => /"exileSelf"/.test(e) && /permanent card/.test(e)
            )
        ).toBe(true);
    });

    it("rejects shuffleSelfIntoLibrary on an Artifact card", () => {
        const errors = validateEffectScript(
            host({
                types: ["Artifact"],
                effects: [{ op: "shuffleSelfIntoLibrary" }],
            })
        );
        expect(
            errors.some(
                (e) =>
                    /"shuffleSelfIntoLibrary"/.test(e) &&
                    /permanent card/.test(e)
            )
        ).toBe(true);
    });

    it("catches the Op nested inside an if branch, not just at the top level", () => {
        const errors = validateEffectScript(
            host({
                types: ["Enchantment"],
                effects: [
                    {
                        op: "if",
                        predicate: { left: 1, op: "ge", right: 1 },
                        then: [{ op: "exileSelf" }],
                        else: [],
                    },
                ],
            })
        );
        expect(errors.some((e) => /"exileSelf"/.test(e))).toBe(true);
    });

    it("accepts exileSelf on an Instant/Sorcery (Restock's own shape, issue #1097)", () => {
        const errors = validateEffectScript(
            host({
                types: ["Sorcery"],
                effects: [
                    { op: "moveZone", target: { target: 0 }, to: "hand" },
                    { op: "moveZone", target: { target: 1 }, to: "hand" },
                    { op: "exileSelf" },
                ],
            })
        );
        expect(errors).toEqual([]);
    });
});

// --- hideaway Op + its two supporting vocabulary additions (CR 702.75, issue
// #783) ----------------------------------------------------------------------
describe("hideaway Op + linked-exile / library-count vocabulary (CR 702.75, issue #783)", () => {
    it("accepts the hideaway Op with just player + look", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        { op: "hideaway", player: "controller", look: 4 },
                    ],
                })
            )
        ).toEqual([]);
    });

    it("rejects a hideaway Op carrying digToHand vocabulary the keyword does not offer", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    // `take` / `destination` / `optional` are deliberately NOT
                    // part of hideaway (CR 702.75a exiles exactly one card to a
                    // fixed destination, and it is not a "may").
                    {
                        op: "hideaway",
                        player: "controller",
                        look: 4,
                        take: 2,
                    } as unknown as EffectOp,
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
    });

    /** An activated-ability effect-script host (the shape
     *  `validateAbilityEffectScript` takes — the ABILITY, not the card). */
    const abilityHost = (effects: EffectOp[]) => ({
        id: "play-hidden",
        oracleText: "{U}, {T}: You may play the exiled card.",
        cost: { mana: { U: 1 }, tap: true },
        useStack: true,
        effects,
    });

    it("accepts grantCastFromExile with the CR 607 linked-exile selector", () => {
        expect(
            validateAbilityEffectScript(
                abilityHost([
                    {
                        op: "grantCastFromExile",
                        card: { exiledWithSource: true },
                        player: "controller",
                        window: "this-turn",
                        withoutPayingManaCost: true,
                        includesLand: true,
                    },
                ]),
                "Test Host"
            )
        ).toEqual([]);
    });

    it("rejects a malformed linked-exile selector", () => {
        const errors = validateAbilityEffectScript(
            abilityHost([
                {
                    op: "grantCastFromExile",
                    card: { exiledWithSource: false },
                    player: "controller",
                } as unknown as EffectOp,
            ]),
            "Test Host"
        );
        expect(errors.length).toBeGreaterThan(0);
    });

    const libraryGate = (spec: Record<string, unknown>): EffectOp[] => [
        {
            op: "if",
            predicate: {
                left: { count: spec },
                op: "le",
                right: 20,
            },
            then: [{ op: "draw", player: "controller", count: 1 }],
        } as unknown as EffectOp,
    ];

    it("accepts a library count scoped to one player and to the all-players minimum", () => {
        expect(
            validateEffectScript(
                host({
                    effects: libraryGate({
                        zone: "library",
                        controller: "controller",
                    }),
                })
            )
        ).toEqual([]);
        expect(
            validateEffectScript(
                host({
                    effects: libraryGate({
                        zone: "library",
                        smallestAcrossPlayers: true,
                    }),
                })
            )
        ).toEqual([]);
    });

    it("rejects a filtered or type-counted library count — the zone is hidden, nothing honest to match", () => {
        expect(
            validateEffectScript(
                host({
                    effects: libraryGate({
                        zone: "library",
                        controller: "controller",
                        filter: { type: "Creature" },
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
        expect(
            validateEffectScript(
                host({
                    effects: libraryGate({
                        zone: "library",
                        controller: "controller",
                        countTypes: true,
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
    });

    it("rejects mixing smallestAcrossPlayers with a controller or with acrossAllPlayers", () => {
        expect(
            validateEffectScript(
                host({
                    effects: libraryGate({
                        zone: "library",
                        smallestAcrossPlayers: true,
                        controller: "controller",
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
        expect(
            validateEffectScript(
                host({
                    effects: libraryGate({
                        zone: "graveyard",
                        smallestAcrossPlayers: true,
                        acrossAllPlayers: true,
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
    });
});

// --- hand count + difference value (issue #2006) ---------------------------
//
// The design's whole defence against an expression grammar is what the
// validator REJECTS: a `difference` operand is a terminal (positive-int
// literal or a single `count`), so nesting is unrepresentable; `from: 0` is
// refused because it would be a back-door unary negation of `minus`; and a
// `hand` count is a pure CARDINALITY read (CR 402.2 — hidden zone, public
// size), so a `filter`/`countTypes` on it is refused exactly as it is on
// `library`. Untested, those are claims rather than guarantees.

describe('validateEffectScript — count zone:"hand" + difference (issue #2006)', () => {
    const loseLife = (amount: unknown): EffectOp[] => [
        { op: "loseLife", player: "opponent", amount } as unknown as EffectOp,
    ];

    const handCount = (extra: Record<string, unknown> = {}) => ({
        count: { zone: "hand", controller: "opponent", ...extra },
    });

    it("accepts a bare hand count and a difference of the accepted operand shapes", () => {
        expect(
            validateEffectScript(host({ effects: loseLife(handCount()) }))
        ).toEqual([]);
        // count − count (Dark Suspicions), count − literal (Ivory Tower's
        // "hand minus 4"), literal − count (The Rack's "3 minus their hand").
        for (const difference of [
            {
                from: handCount(),
                minus: { count: { zone: "hand", controller: "controller" } },
            },
            { from: handCount(), minus: 4 },
            { from: 3, minus: handCount() },
        ]) {
            expect(
                validateEffectScript(
                    host({ effects: loseLife({ difference }) })
                )
            ).toEqual([]);
        }
    });

    it("rejects `from: 0` — the back-door unary negation the signed grammar's `negate` already owns", () => {
        for (const from of [0, -2]) {
            expect(
                validateEffectScript(
                    host({
                        effects: loseLife({
                            difference: { from, minus: handCount() },
                        }),
                    })
                ).length
            ).toBeGreaterThan(0);
        }
        // Symmetrically on the subtrahend — neither operand slot is a hole.
        expect(
            validateEffectScript(
                host({
                    effects: loseLife({
                        difference: { from: handCount(), minus: 0 },
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
    });

    it("rejects a NESTED difference — the operand type is a terminal, so the grammar stays depth-1", () => {
        expect(
            validateEffectScript(
                host({
                    effects: loseLife({
                        difference: {
                            from: {
                                difference: { from: handCount(), minus: 1 },
                            },
                            minus: 1,
                        },
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
        // …and in the `minus` slot, and for a non-terminal value member
        // (`X`) that `isEffectValue` would otherwise have accepted.
        expect(
            validateEffectScript(
                host({
                    effects: loseLife({
                        difference: {
                            from: 3,
                            minus: {
                                difference: { from: handCount(), minus: 1 },
                            },
                        },
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
        expect(
            validateEffectScript(
                host({
                    effects: loseLife({
                        difference: { from: { X: true }, minus: 1 },
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
    });

    it("rejects a `filter`/`countTypes` on a hand count — a cardinality read has nothing to filter (CR 402.2)", () => {
        expect(
            validateEffectScript(
                host({
                    effects: loseLife(handCount({ filter: { type: "Land" } })),
                })
            ).length
        ).toBeGreaterThan(0);
        expect(
            validateEffectScript(
                host({ effects: loseLife(handCount({ countTypes: true })) })
            ).length
        ).toBeGreaterThan(0);
        // Nested inside a difference operand too — the operand runs the same
        // `isCountValue` check, so the rejection cannot be sidestepped there.
        expect(
            validateEffectScript(
                host({
                    effects: loseLife({
                        difference: {
                            from: handCount({ filter: { type: "Land" } }),
                            minus: 1,
                        },
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
    });

    it("rejects a malformed difference shape (missing operand, extra key)", () => {
        for (const difference of [
            { from: handCount() },
            { minus: handCount() },
            { from: 3, minus: 1, plus: 1 },
            {},
        ]) {
            expect(
                validateEffectScript(
                    host({ effects: loseLife({ difference }) })
                ).length
            ).toBeGreaterThan(0);
        }
    });
});

// --- scaled value (issue #2366) ---------------------------------------------
//
// The static sweep must accept every terminal operand `scaled` was built for
// (literal, count, X — the reason it exists) and reject anything that would
// widen it into an expression grammar: a nested `scaled`, a `difference`
// operand, or an `X`/ref-valued `times`.

describe("validateEffectScript — scaled (issue #2366)", () => {
    const loseLife = (amount: unknown): EffectOp[] => [
        { op: "loseLife", player: "opponent", amount } as unknown as EffectOp,
    ];

    it("accepts every terminal operand: literal, count, and X", () => {
        for (const value of [
            3,
            { count: { zone: "battlefield", controller: "controller" } },
            { X: true },
        ]) {
            expect(
                validateEffectScript(
                    host({ effects: loseLife({ scaled: { value, times: 2 } }) })
                )
            ).toEqual([]);
        }
    });

    it("rejects a NESTED scaled — the operand type is a terminal, so the grammar stays depth-1", () => {
        expect(
            validateEffectScript(
                host({
                    effects: loseLife({
                        scaled: {
                            value: { scaled: { value: 3, times: 2 } },
                            times: 2,
                        },
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
    });

    it("rejects a `difference` as the scaled operand — a terminal, not a full EffectValue", () => {
        expect(
            validateEffectScript(
                host({
                    effects: loseLife({
                        scaled: {
                            value: { difference: { from: 3, minus: 1 } },
                            times: 2,
                        },
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
    });

    it("rejects a non-positive-int `times` (0, negative, fractional)", () => {
        for (const times of [0, -2, 1.5]) {
            expect(
                validateEffectScript(
                    host({ effects: loseLife({ scaled: { value: 3, times } }) })
                ).length
            ).toBeGreaterThan(0);
        }
    });

    it("rejects an `X`/ref-valued `times` — the multiplier is a literal only (mirrors count.times, issue #999)", () => {
        for (const times of [{ X: true }, { ref: "$source.power" }]) {
            expect(
                validateEffectScript(
                    host({ effects: loseLife({ scaled: { value: 3, times } }) })
                ).length
            ).toBeGreaterThan(0);
        }
    });

    it("rejects a malformed scaled shape (missing key, extra key)", () => {
        for (const scaled of [
            { value: 3 },
            { times: 2 },
            { value: 3, times: 2, extra: 1 },
            {},
        ]) {
            expect(
                validateEffectScript(host({ effects: loseLife({ scaled }) }))
                    .length
            ).toBeGreaterThan(0);
        }
    });
});

// --- divide value (issue #2385) ---------------------------------------------
//
// The static sweep must accept every terminal operand `divide` was built for
// (literal, count — no X, deliberately narrower than `scaled`) and a
// mandatory `rounding`, and reject anything that would widen it into an
// expression grammar or make rounding silently optional.

describe("validateEffectScript — divide (issue #2385)", () => {
    const loseLife = (amount: unknown): EffectOp[] => [
        { op: "loseLife", player: "opponent", amount } as unknown as EffectOp,
    ];

    it("accepts both terminal operands: literal and count", () => {
        for (const value of [
            3,
            { count: { zone: "battlefield", controller: "controller" } },
        ]) {
            expect(
                validateEffectScript(
                    host({
                        effects: loseLife({
                            divide: { value, by: 2, rounding: "up" },
                        }),
                    })
                )
            ).toEqual([]);
        }
    });

    it("accepts both rounding directions", () => {
        for (const rounding of ["up", "down"]) {
            expect(
                validateEffectScript(
                    host({
                        effects: loseLife({
                            divide: { value: 3, by: 2, rounding },
                        }),
                    })
                )
            ).toEqual([]);
        }
    });

    it("rejects an `X` operand — divide stays as narrow as difference, no X dividend", () => {
        expect(
            validateEffectScript(
                host({
                    effects: loseLife({
                        divide: { value: { X: true }, by: 2, rounding: "up" },
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
    });

    it("rejects a NESTED divide — the operand type is a terminal, so the grammar stays depth-1", () => {
        expect(
            validateEffectScript(
                host({
                    effects: loseLife({
                        divide: {
                            value: {
                                divide: { value: 4, by: 2, rounding: "up" },
                            },
                            by: 2,
                            rounding: "up",
                        },
                    }),
                })
            ).length
        ).toBeGreaterThan(0);
    });

    it("rejects a non-positive-int `by` (0, negative, fractional)", () => {
        for (const by of [0, -2, 1.5]) {
            expect(
                validateEffectScript(
                    host({
                        effects: loseLife({
                            divide: { value: 3, by, rounding: "up" },
                        }),
                    })
                ).length
            ).toBeGreaterThan(0);
        }
    });

    it("rejects a missing or invalid `rounding` — mandatory, no default (CR 107.1a)", () => {
        for (const rounding of [undefined, "nearest", "toward-zero", 1]) {
            const divide: Record<string, unknown> = { value: 3, by: 2 };
            if (rounding !== undefined) divide.rounding = rounding;
            expect(
                validateEffectScript(host({ effects: loseLife({ divide }) }))
                    .length
            ).toBeGreaterThan(0);
        }
    });

    it("rejects a malformed divide shape (missing key, extra key)", () => {
        for (const divide of [
            { value: 3, by: 2 },
            { by: 2, rounding: "up" },
            { value: 3, rounding: "up" },
            { value: 3, by: 2, rounding: "up", extra: 1 },
            {},
        ]) {
            expect(
                validateEffectScript(host({ effects: loseLife({ divide }) }))
                    .length
            ).toBeGreaterThan(0);
        }
    });
});

// --- delayedTrigger "until-next-turn-creature-attacks-you" timing
// (CR 606 / 603.7a / 506.2, issue #2385, review round 2) -------------------

describe("validateEffectScript — delayedTrigger until-next-turn-creature-attacks-you (issue #2385)", () => {
    it("accepts the timing with an $event.soleAttacker-reading body, no targetPlayer/watch", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        {
                            op: "delayedTrigger",
                            timing: "until-next-turn-creature-attacks-you",
                            oracleText:
                                "Whenever a creature attacks you or a planeswalker you control, it gets -1/-0 until end of turn.",
                            effects: [
                                {
                                    op: "pump",
                                    target: { ref: "$event.soleAttacker" },
                                    power: -1,
                                    toughness: 0,
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                    ],
                })
            )
        ).toEqual([]);
    });

    it("rejects targetPlayer on this timing (phase-boundary-only field)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "until-next-turn-creature-attacks-you",
                        targetPlayer: "controller",
                        oracleText: "x",
                        effects: [{ op: "becomeMonarch" }],
                    } as unknown as EffectOp,
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toMatch(/"targetPlayer".*only valid/);
    });

    it("rejects watch on this timing (instance-scoped-only field)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "until-next-turn-creature-attacks-you",
                        watch: { ref: "$source" },
                        oracleText: "x",
                        effects: [{ op: "becomeMonarch" }],
                    } as unknown as EffectOp,
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toMatch(/"watch".*only valid/);
    });
});

// --- targetMatchesGraveyardFilter predicate (issue #2385) -------------------

describe("validateEffectScript — targetMatchesGraveyardFilter (issue #2385)", () => {
    it("accepts an announced target, a player ref, and a card filter", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        {
                            op: "moveZone",
                            target: { target: 0 },
                            to: "hand",
                        },
                        {
                            op: "if",
                            predicate: {
                                targetMatchesGraveyardFilter: { target: 0 },
                                player: "controller",
                                filter: { color: "G" },
                            },
                            then: [],
                        },
                    ],
                })
            )
        ).toEqual([]);
    });

    it("rejects a missing `player` or `filter`", () => {
        for (const pred of [
            {
                targetMatchesGraveyardFilter: { target: 0 },
                filter: { color: "G" },
            },
            {
                targetMatchesGraveyardFilter: { target: 0 },
                player: "controller",
            },
        ]) {
            expect(
                validateEffectScript(
                    host({
                        effects: [
                            {
                                op: "if",
                                predicate: pred,
                                then: [],
                            } as unknown as EffectOp,
                        ],
                    })
                ).length
            ).toBeGreaterThan(0);
        }
    });

    // Review round 2 (PR #2487) — `collectRefUses`'s object-family keyHint
    // list was missing "targetMatchesGraveyardFilter", so a `{ ref: "$each"
    // }` there mis-tagged as a NUMBER ref and failed as a "malformed ref"
    // even though the predicate routes through the identical object-selector
    // path `objectMatchesFilter` uses one line above it (validate.ts). The
    // type doc on `targetMatchesGraveyardFilter` advertises this exact form
    // (a forEach-driven graveyard sweep, not just an announced target).
    it("accepts the $each form inside a forEach (review round 2, #2487)", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "graveyard",
                                controller: "controller",
                            },
                            effects: [
                                {
                                    op: "if",
                                    predicate: {
                                        targetMatchesGraveyardFilter: {
                                            ref: "$each",
                                        },
                                        player: "controller",
                                        filter: { color: "G" },
                                    },
                                    then: [],
                                },
                            ],
                        },
                    ],
                })
            )
        ).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Reserved `$target<N>.name` ref (issue #2065) — static half.
//
// The ref namespace has more than one consumer and they do not share code:
// the interpreter RESOLVES a ref, the validator REF-CHECKS it against the
// declared-binding map. A reserved name only the interpreter learns about
// passes its unit test and is then rejected catalogue-wide here; one only the
// validator learns about ships and silently resolves to nothing. These cases
// pin the validator half — one per row of the PR's producer census, including
// every must-NOT row.
// ---------------------------------------------------------------------------

/** Winnow's shape: a board count filtered by the announced target's own name. */
const sameNameCount = (ref: string): EffectOp[] => [
    {
        op: "if",
        predicate: {
            left: {
                count: {
                    zone: "battlefield",
                    acrossAllPlayers: true,
                    filter: { name: { ref } },
                },
            },
            op: "ge",
            right: 2,
        },
        then: [{ op: "destroy", target: { target: 0 } }],
    },
];

describe("validateEffectScript — reserved $target<N>.name ref (issue #2065)", () => {
    it("accepts $target0.name in a filter name position with no preceding bind", () => {
        expect(
            validateEffectScript(
                host({ effects: sameNameCount("$target0.name") })
            )
        ).toEqual([]);
    });

    it("accepts a higher slot index ($target1.name — a multi-target script)", () => {
        expect(
            validateEffectScript(
                host({ effects: sameNameCount("$target1.name") })
            )
        ).toEqual([]);
    });

    it("rejects an unsupported property path on the reserved ref", () => {
        // `.power` is a legal SNAPSHOT property, but `$target0` is not a
        // snapshot binding and the string path has no reader for it — so it
        // must fail statically rather than resolve to undefined at runtime.
        const errors = validateEffectScript(
            host({ effects: sameNameCount("$target0.power") })
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toMatch(/\$target0/);
    });

    it("rejects a bare $target0 (no property) in a name position", () => {
        expect(
            validateEffectScript(host({ effects: sameNameCount("$target0") }))
                .length
        ).toBeGreaterThan(0);
    });

    it("rejects a near-miss that is not the reserved shape ($targetX, $target)", () => {
        for (const ref of ["$targetX.name", "$target.name", "$targets0.name"]) {
            expect(
                validateEffectScript(host({ effects: sameNameCount(ref) }))
                    .length
            ).toBeGreaterThan(0);
        }
    });

    it("rejects the reserved ref in a NUMBER position (no numeric reader)", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        {
                            op: "dealDamage",
                            amount: { ref: "$target0.name" },
                            to: { target: 0 },
                        },
                    ],
                })
            ).length
        ).toBeGreaterThan(0);
    });

    it("rejects the reserved ref in a PICKS position (moveZone cards)", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        {
                            op: "moveZone",
                            cards: { ref: "$target0.name" },
                            to: "hand",
                        } as never,
                    ],
                })
            ).length
        ).toBeGreaterThan(0);
    });

    it("rejects the reserved ref in an OBJECT position (destroy target)", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        { op: "destroy", target: { ref: "$target0.name" } },
                    ],
                })
            ).length
        ).toBeGreaterThan(0);
    });

    it("rejects a bind that SHADOWS a reserved target name", () => {
        // The interpreter reads `$target0` from `ctx.targets` and never
        // consults the binding store, so a bind under that name would be
        // written and silently ignored by every reader.
        expect(
            validateEffectScript(
                host({
                    effects: [
                        {
                            op: "destroy",
                            target: { target: 0 },
                            bind: "$target0",
                        },
                    ],
                })
            ).length
        ).toBeGreaterThan(0);
    });

    it("still rejects an undeclared ordinary binding in a name position", () => {
        // The non-reserved half of the `name` position is unchanged by the
        // split out of `picks` (issues #1085 / #1104).
        const errors = validateEffectScript(
            host({ effects: sameNameCount("$neverBound") })
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toMatch(/undefined binding/);
    });
});

// A `createToken` Op's `token.triggeredAbilities[]` (CR 707.2, issue #2364) —
// `isEffectTokenSpec`/`isTokenTriggeredAbility` shape checks, plus the
// nested-`createToken` `effects[]` validation pass (mirrors the coverage
// `token.activatedAbilities[]` gets structurally, one ability-kind later).
describe("validateEffectScript — createToken token.triggeredAbilities[] (CR 707.2, issue #2364)", () => {
    const validToken = {
        name: "Pest",
        types: ["Creature"] as CardType[],
        subtypes: ["Pest"],
        power: 1,
        toughness: 1,
    };

    it("accepts a well-formed triggeredAbilities descriptor", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        {
                            op: "createToken",
                            token: {
                                ...validToken,
                                triggeredAbilities: [
                                    {
                                        id: "pest-dies",
                                        oracleText:
                                            "When this token dies, you gain 1 life.",
                                        event: "CREATURE_DIED",
                                        effects: [
                                            {
                                                op: "gainLife",
                                                player: "controller",
                                                amount: 1,
                                            },
                                        ],
                                    },
                                ],
                            },
                            controller: "controller",
                        } as EffectOp,
                    ],
                })
            )
        ).toEqual([]);
    });

    it("rejects an unknown event kind", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "createToken",
                        token: {
                            ...validToken,
                            triggeredAbilities: [
                                {
                                    id: "pest-dies",
                                    oracleText: "When this token dies, ...",
                                    event: "DAMAGE_DEALT",
                                    effects: [
                                        {
                                            op: "gainLife",
                                            player: "controller",
                                            amount: 1,
                                        },
                                    ],
                                },
                            ],
                        },
                        controller: "controller",
                    } as unknown as EffectOp,
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects a `resolve`/`effect` field — DSL-only, no closure escape hatch", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "createToken",
                        token: {
                            ...validToken,
                            triggeredAbilities: [
                                {
                                    id: "pest-dies",
                                    oracleText: "When this token dies, ...",
                                    event: "CREATURE_DIED",
                                    effects: [],
                                    resolve: () => {},
                                },
                            ],
                        },
                        controller: "controller",
                    } as unknown as EffectOp,
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
    });

    it("validates the ability's effects[] independently (bad ref inside the token trigger is caught)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "createToken",
                        token: {
                            ...validToken,
                            triggeredAbilities: [
                                {
                                    id: "pest-dies",
                                    oracleText: "When this token dies, ...",
                                    event: "CREATURE_DIED",
                                    effects: [
                                        {
                                            op: "gainLife",
                                            player: "controller",
                                            amount: { ref: "$neverBound" },
                                        },
                                    ],
                                },
                            ],
                        },
                        controller: "controller",
                    } as EffectOp,
                ],
            })
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toMatch(
            /createToken token\.triggeredAbilities/
        );
    });
});

describe("validateEffectScript — reflexiveTrigger inline targetRequirement (CR 603.3d, review finding on issue #2365)", () => {
    // A `reflexiveTrigger` (CR 603.3c) queues its own targeted trigger via
    // `StackItem.inlineTargetRequirement`, resolved by the SAME
    // `triggerTargetMinMax` (gre/rules.ts) a card-def `TriggeredAbility`
    // uses. That resolver has no CR 601.2b X-announcement step (603.3d
    // incorporates 601.2c–d, not 601.2b), so it collapses ANY `max: "X"`
    // straight down to `min` — a `{min, max: "X"}` inline requirement would
    // tsc-check and then silently choose zero variable targets at runtime.
    // `isInlineTargetRequirement` rejects that object-form shape on purpose
    // (not merely as a side effect of the bare-integer check next to it) —
    // this is that rejection's permanent proof, so nobody "fixes" the
    // integer check into accepting it without noticing what breaks.
    const reflexive = (count: unknown): EffectOp => ({
        op: "reflexiveTrigger",
        oracleText: "When you do, ~ deals damage to any target.",
        targetRequirement: { type: "any", count } as never,
        effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
    });

    it("accepts a bare 'X' count (the pre-existing always-inert shape)", () => {
        expect(
            validateEffectScript(host({ effects: [reflexive("X")] }))
        ).toEqual([]);
    });

    it("accepts a fixed-integer object-form count", () => {
        expect(
            validateEffectScript(
                host({ effects: [reflexive({ min: 0, max: 2 })] })
            )
        ).toEqual([]);
        expect(
            validateEffectScript(host({ effects: [reflexive({ min: 1 })] }))
        ).toEqual([]);
    });

    it("REJECTS the object-form 'up to X' shape { min, max: \"X\" } deliberately", () => {
        const errors = validateEffectScript(
            host({ effects: [reflexive({ min: 0, max: "X" })] })
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.join("\n")).toMatch(
            /Op "reflexiveTrigger" field "targetRequirement" has invalid value/
        );
    });
});

describe("validateAbilityEffectScript — modes[] XOR ability-level body (CR 700.2 / 603.3c, issue #2461)", () => {
    // A MODAL ability's body lives on its modes; resolution dispatches the
    // chosen mode and IGNORES an ability-level body, so declaring both is a
    // silently-dead effect. The check has to run even though the ability
    // carries no `effects[]` of its own — that is the normal shape of a modal
    // ability, and the spell-site pattern (keyed off `def.effects`) would never
    // fire for it.
    const modes = [
        {
            id: "a",
            label: "A",
            oracleText: "A.",
            effects: [{ op: "draw", count: 1 }],
        },
    ];

    it("rejects modes[] alongside an ability-level effects[]", () => {
        const errors = validateAbilityEffectScript(
            {
                id: "ab",
                modes,
                effects: [{ op: "draw", count: 1 }],
            },
            "Test Card (test-id)"
        );
        expect(errors.join("\n")).toMatch(
            /declares both modes\[\] and effects — a modal ability's body lives on its modes/
        );
    });

    it("rejects modes[] alongside an ability-level resolve()", () => {
        const errors = validateAbilityEffectScript(
            {
                id: "ab",
                modes,
                resolve: () => {},
            },
            "Test Card (test-id)"
        );
        expect(errors.join("\n")).toMatch(
            /declares both modes\[\] and resolve/
        );
    });

    it("rejects modes[] alongside ability-level resolveSteps", () => {
        const errors = validateAbilityEffectScript(
            {
                id: "ab",
                modes,
                resolveSteps: [() => {}],
            },
            "Test Card (test-id)"
        );
        expect(errors.join("\n")).toMatch(
            /declares both modes\[\] and resolveSteps/
        );
    });

    it("accepts a modal ability with no ability-level body", () => {
        expect(
            validateAbilityEffectScript(
                { id: "ab", modes },
                "Test Card (test-id)"
            )
        ).toEqual([]);
    });

    /** The same one-mode list, typed as the factory's `modes` parameter. */
    const typedModes: AbilityMode[] = [
        {
            id: "a",
            label: "A",
            oracleText: "A.",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ];

    // The three checks above are only reachable if the ability the AUTHOR wrote
    // is the ability the validator sees. `enteredTrigger` builds most ETB
    // triggers in the catalogue, so if it dropped a body passed alongside
    // `modes` the conflict would be invisible catalogue-wide and the mode-less
    // body would ship inert.
    it("sees a body the enteredTrigger factory was given alongside modes[]", () => {
        const built = enteredTrigger({
            id: "ab",
            oracleText: "When this creature enters, choose one — • A.",
            scope: "self",
            modes: typedModes,
            effects: [
                { op: "draw", player: "controller", count: 1 },
            ] as EffectOp[],
        });
        expect(
            validateAbilityEffectScript(built, "Test Card (test-id)").join("\n")
        ).toMatch(/declares both modes\[\] and effects/);
    });

    it("sees a resolve() the enteredTrigger factory was given alongside modes[]", () => {
        const built = enteredTrigger({
            id: "ab",
            oracleText: "When this creature enters, choose one — • A.",
            scope: "self",
            modes: typedModes,
            resolve: () => {},
        });
        expect(
            validateAbilityEffectScript(built, "Test Card (test-id)").join("\n")
        ).toMatch(/declares both modes\[\] and resolve/);
    });

    it("a modal enteredTrigger with no body stays body-less", () => {
        const built = enteredTrigger({
            id: "ab",
            oracleText: "When this creature enters, choose one — • A.",
            scope: "self",
            modes: typedModes,
        });
        expect(built.effects).toBeUndefined();
        expect(built.resolve).toBeUndefined();
        expect(
            validateAbilityEffectScript(built, "Test Card (test-id)")
        ).toEqual([]);
    });
});

// --- delayedTrigger `next-cleanup-step` timing (CR 603.7 / 514.3a, #2472) ---
// The cleanup boundary is a PHASE-boundary timing: accepted by the Op's
// vocabulary, and — like its five siblings — rejecting both `targetPlayer`
// (player-scoped only, CR 504/505) and `watch` (instance-scoped only,
// CR 603.7a).
describe("validateEffectScript — delayedTrigger next-cleanup-step (CR 514.3a)", () => {
    const body: EffectOp[] = [
        { op: "gainLife", player: "controller", amount: 1 },
    ];

    it("accepts the cleanup-step boundary timing", () => {
        expect(
            validateEffectScript(
                host({
                    effects: [
                        {
                            op: "delayedTrigger",
                            timing: "next-cleanup-step",
                            oracleText:
                                "At the beginning of the next cleanup step, sacrifice it.",
                            effects: body,
                        },
                    ],
                })
            )
        ).toEqual([]);
    });

    it("rejects targetPlayer on the cleanup-step timing (CR 504/505)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-cleanup-step",
                        oracleText: "x",
                        targetPlayer: "controller",
                        effects: body,
                    } as never,
                ],
            })
        );
        expect(errors.some((e) => /"targetPlayer" is only valid/.test(e))).toBe(
            true
        );
    });

    it("rejects watch on the cleanup-step timing (CR 603.7a)", () => {
        const errors = validateEffectScript(
            host({
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-cleanup-step",
                        oracleText: "x",
                        watch: { ref: "$source" },
                        effects: body,
                    } as never,
                ],
            })
        );
        expect(errors.some((e) => /"watch" is only valid/.test(e))).toBe(true);
    });
});

// CR 303.4 / 702.5a (issue #2471) — the enchant clause an `addSubtype` Op
// grants alongside an `"Aura"` subtype. Every assertion below runs through the
// real `validateEffectScript`, and every rejection is a shape that would
// otherwise be SILENT: a misspelt key is dropped into a restriction nothing
// can satisfy (the Aura is binned by the next CR 704.5m sweep), and a clause
// stamped on a non-Aura subtype sits inert on the instance until something
// else grants that permanent the Aura subtype.
describe("validateEffectScript — addSubtype enchantRestriction (CR 303.4, issue #2471)", () => {
    const grant = (op: Record<string, unknown>): string[] =>
        validateEffectScript(host({ effects: [op as never] }));

    it("accepts the full authored shape (types + players + host selector)", () => {
        expect(
            grant({
                op: "addSubtype",
                target: { target: 0 },
                subtype: "Aura",
                enchantRestriction: {
                    types: ["Creature"],
                    players: false,
                    host: { target: 0 },
                },
            })
        ).toEqual([]);
    });

    it("accepts the Op with no enchantRestriction at all (the shipped shape)", () => {
        expect(
            grant({
                op: "addSubtype",
                target: { target: 0 },
                subtype: "Angel",
            })
        ).toEqual([]);
    });

    it("rejects an unknown key inside the clause", () => {
        const errors = grant({
            op: "addSubtype",
            target: { target: 0 },
            subtype: "Aura",
            enchantRestriction: { type: "Creature" },
        });
        expect(
            errors.some((e) => /field "enchantRestriction" has invalid/.test(e))
        ).toBe(true);
    });

    it("rejects `hostId` — the RESOLVED shape, never the authored one", () => {
        const errors = grant({
            op: "addSubtype",
            target: { target: 0 },
            subtype: "Aura",
            enchantRestriction: { types: ["Creature"], hostId: "bear-1" },
        });
        expect(
            errors.some((e) => /field "enchantRestriction" has invalid/.test(e))
        ).toBe(true);
    });

    it("rejects an empty clause — a restriction that restricts nothing", () => {
        const errors = grant({
            op: "addSubtype",
            target: { target: 0 },
            subtype: "Aura",
            enchantRestriction: {},
        });
        expect(
            errors.some((e) => /field "enchantRestriction" has invalid/.test(e))
        ).toBe(true);
    });

    it("rejects a non-CardType in `types`", () => {
        const errors = grant({
            op: "addSubtype",
            target: { target: 0 },
            subtype: "Aura",
            enchantRestriction: { types: ["Goblin"] },
        });
        expect(
            errors.some((e) => /field "enchantRestriction" has invalid/.test(e))
        ).toBe(true);
    });

    it("rejects a non-object clause", () => {
        const errors = grant({
            op: "addSubtype",
            target: { target: 0 },
            subtype: "Aura",
            enchantRestriction: "creature",
        });
        expect(
            errors.some((e) => /field "enchantRestriction" has invalid/.test(e))
        ).toBe(true);
    });

    it("CR 303.4 — rejects a clause on any subtype other than Aura", () => {
        const errors = grant({
            op: "addSubtype",
            target: { target: 0 },
            subtype: "Angel",
            enchantRestriction: { types: ["Creature"] },
        });
        expect(
            errors.some((e) =>
                /"enchantRestriction" is only valid with subtype "Aura"/.test(e)
            )
        ).toBe(true);
    });
});
