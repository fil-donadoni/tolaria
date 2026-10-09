// cardValue DSL-precedence + wire-format tests (PRD #1423, issue #1426; the
// `aiEffects` shadow-script precedence, issue #1431; the creature/non-creature
// precedence unification, issue #1512). The semantic layer wires the per-Op
// value model into `cardValue`. ONE precedence rule now applies identically to
// BOTH card classes (issue #1512 — PRD #1423's order, previously only honored
// by the CREATURE branch):
//
//     `aiValue`  >  real `effects[]` / `aiEffects` shadow script  >  `base + MV`
//
// An explicit `aiValue` override wins outright — the correction-on-divergence
// knob PRD #1423 exists to preserve for a card whose script `OP_VALUERS`
// misvalues — over the derived script value (folded together into the
// caller-computed `dslSpellValue`/`dslAbilityValue`), which in turn beats the
// blind `base + MV` fallback. See `latentValue`'s doc comment for the full
// precedence. A burn / removal spell — whose Effect Script the value model
// reads — scores far above a do-nothing spell of the same mana value. The
// valuation is read CLIENT-SIDE (`src/lib/ai/bot-view.ts` →
// `cardValueById(card.card.id)`), so the change must survive the wire
// projection: the DSL value is derived from the REGISTRY definition keyed by
// the id that survives `projectPublicState`, never off the fat `card.card`
// blob the projection strips.

import { describe, it, expect } from "vitest";
import {
    makePlayer,
    makeState,
    makeInstance,
} from "../../cards/__tests__/setup.helper";
import { cardValueById, dslLatentPieces, latentValue } from "../cardValue";
import { registeredDefinitions } from "../../cards";
import { manaValue } from "../constants";
import { projectPublicState } from "../../gameProjections";
import {
    dslSpellScriptValue,
    dslStandingAbilityScriptValue,
} from "../ai/cardScriptValue";
import { contextFreeGrounding } from "../ai/grounding";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { permanentRealisedValue } from "../evaluate";
import type { CardDefinition, EffectOp } from "../../cards/types";

// Real, registered cards of equal mana value (probed from the catalogue):
//   Lightning Bolt — DSL `dealDamage 3` burn, MV 1.
//   Black Ward      — a do-nothing-for-the-evaluator aura shell, MV 1.
const LIGHTNING_BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const BLACK_WARD = "15967a39-303f-457d-bcde-51837c8d63e1";
// Ashes to Ashes — DSL exile-two-creatures removal, MV 3.
const ASHES_TO_ASHES = "825496e5-19c7-4f50-8070-0265a58608dc";

describe("cardValue DSL precedence (PRD #1423, issue #1426)", () => {
    it("a burn spell scores far above a do-nothing spell of equal mana value", () => {
        const burn = cardValueById(LIGHTNING_BOLT);
        const doNothing = cardValueById(BLACK_WARD);
        expect(burn).toBeGreaterThan(doNothing * 3);
    });

    it("a removal spell scores far above a do-nothing spell", () => {
        expect(cardValueById(ASHES_TO_ASHES)).toBeGreaterThan(
            cardValueById(BLACK_WARD) * 3
        );
    });

    describe("latentValue precedence order", () => {
        const base = {
            isCreature: false,
            power: 0,
            toughness: 0,
            manaValue: 3,
            staticAbilities: [] as string[],
        };

        it("an explicit aiValue wins outright over a DSL-derived script value (PRD #1423 order, issue #1512)", () => {
            // The correction-on-divergence knob: an explicit aiValue always
            // wins, even when the script value would otherwise be higher.
            expect(
                latentValue({ ...base, aiValue: 7, dslSpellValue: 250 })
            ).toBe(7);
        });

        it("DSL-derived value beats the base+MV fallback when higher (no aiValue override)", () => {
            // base+MV fallback for MV3 = 8 + 3×10 = 38.
            expect(latentValue({ ...base, dslSpellValue: 200 })).toBe(200);
        });

        it("DSL value is FLOORED at base+MV — it never lowers a card below its MV worth", () => {
            // A script the current Op vocabulary can't value fully (a backfilled
            // Op, #1430) must not drop the card below its mana-value floor.
            expect(latentValue({ ...base, dslSpellValue: 5 })).toBe(38);
        });

        it("no DSL script → the aiValue scalar override (issue #1431, the 'no honest shadow script' escape hatch)", () => {
            expect(latentValue({ ...base, aiValue: 99 })).toBe(99);
        });

        it("no DSL script and no aiValue → the base+MV fallback (unchanged behavior)", () => {
            expect(latentValue(base)).toBe(38);
        });

        // Issue #5145 — a non-creature permanent's standing ability scripts.
        describe("non-creature standing ability value (issue #5145)", () => {
            it("an ability script above the base+MV floor lifts the card above it", () => {
                expect(
                    latentValue({ ...base, dslStandingAbilityValue: 85 })
                ).toBe(85);
            });

            it("an ability script below the floor, or a negative one, stays AT the floor", () => {
                expect(
                    latentValue({ ...base, dslStandingAbilityValue: 12 })
                ).toBe(38);
                expect(
                    latentValue({ ...base, dslStandingAbilityValue: -40 })
                ).toBe(38);
            });

            it("composes additively with the spell script, and a negative ability nets against it", () => {
                expect(
                    latentValue({
                        ...base,
                        dslSpellValue: 100,
                        dslStandingAbilityValue: 30,
                    })
                ).toBe(130);
                expect(
                    latentValue({
                        ...base,
                        dslSpellValue: 100,
                        dslStandingAbilityValue: -30,
                    })
                ).toBe(70);
            });

            it("is bounded by the latent-script clamp and still beaten by aiValue", () => {
                expect(
                    latentValue({ ...base, dslStandingAbilityValue: 100_000 })
                ).toBe(300);
                expect(
                    latentValue({
                        ...base,
                        aiValue: 7,
                        dslStandingAbilityValue: 85,
                    })
                ).toBe(7);
            });

            it("never reads the field on a creature (its abilities ride in dslAbilityValue)", () => {
                const creature = {
                    ...base,
                    isCreature: true,
                    power: 2,
                    toughness: 2,
                };
                expect(
                    latentValue({ ...creature, dslStandingAbilityValue: 85 })
                ).toBe(latentValue(creature));
            });

            it("an ability that sacrifices its own source is not standing worth (Seal of Cleansing stays at its floor)", () => {
                const seal = [...registeredDefinitions()].find(
                    (d) => d.name === "Seal of Cleansing"
                );
                expect(seal).toBeDefined();
                expect(dslStandingAbilityScriptValue(seal!)).toBeUndefined();
                expect(cardValueById(seal!.id)).toBe(
                    latentValue({
                        ...base,
                        manaValue: manaValue(seal!.manaCost),
                    })
                );
            });

            it("an ability that exiles its own source is not standing worth (Brittle Effigy)", () => {
                const effigy = [...registeredDefinitions()].find(
                    (d) => d.name === "Brittle Effigy"
                );
                expect(effigy).toBeDefined();
                expect(dslStandingAbilityScriptValue(effigy!)).toBeUndefined();
            });

            it("a planeswalker carries no standing ability value (the loyalty model prices it)", () => {
                const walkers = [...registeredDefinitions()].filter((d) =>
                    d.types.includes("Planeswalker")
                );
                expect(walkers.length).toBeGreaterThan(0);
                for (const w of walkers) {
                    expect(dslLatentPieces(w).dslStandingAbilityValue).toBe(
                        undefined
                    );
                }
            });

            // Issue #5151 — a standing trigger on a per-turn step is worth
            // every firing its permanent lives to see.
            describe("recurrence multiplier for per-turn standing triggers (issue #5151)", () => {
                const byName = (name: string) => {
                    const def = [...registeredDefinitions()].find(
                        (d) => d.name === name
                    );
                    expect(def, name).toBeDefined();
                    return def!;
                };
                const floorOf = (def: CardDefinition) =>
                    latentValue({
                        ...base,
                        manaValue: manaValue(def.manaCost),
                    });

                it("Black Vise, Ivory Tower and Essence Flare read ABOVE their base+MV floor", () => {
                    // Before the multiplier each sat exactly AT its floor
                    // (12.7, 3.8 and 5.1 against 18 — issue #5150's inert
                    // census), so Disenchant picked its target by mana value.
                    for (const name of [
                        "Black Vise",
                        "Ivory Tower",
                        "Essence Flare",
                    ]) {
                        const def = byName(name);
                        expect(cardValueById(def.id), name).toBeGreaterThan(
                            floorOf(def)
                        );
                    }
                });

                it("a one-shot trigger of the same script keeps weight 1; a per-turn one is scaled by latent.recurrence", () => {
                    const script: EffectOp[] = [
                        {
                            op: "dealDamage",
                            amount: 3,
                            to: { player: "opponent" },
                        },
                    ];
                    const artifact = (
                        id: string,
                        event: "PHASE_BEGIN" | "PERMANENT_ENTERED"
                    ) =>
                        ({
                            id,
                            name: id,
                            rarity: "common",
                            types: ["Artifact"],
                            manaCost: { X: 1 },
                            triggeredAbilities: [
                                {
                                    id: `${id}-trigger`,
                                    oracleText: "",
                                    event,
                                    matches: () => true,
                                    effects: script,
                                },
                            ],
                        }) as unknown as CardDefinition;
                    const oneShot = dslStandingAbilityScriptValue(
                        artifact("one-shot", "PERMANENT_ENTERED")
                    );
                    const perTurn = dslStandingAbilityScriptValue(
                        artifact("per-turn", "PHASE_BEGIN")
                    );
                    expect(oneShot).toBeDefined();
                    expect(perTurn).toBeCloseTo(
                        oneShot! * DEFAULT_EVAL_WEIGHTS.latent.recurrence,
                        9
                    );
                    expect(
                        DEFAULT_EVAL_WEIGHTS.latent.recurrence
                    ).toBeGreaterThan(1);
                });

                it("a per-turn trigger that sacrifices its own source unguarded fires once (weight 1)", () => {
                    const def = {
                        id: "self-sac",
                        name: "self-sac",
                        rarity: "common",
                        types: ["Artifact"],
                        manaCost: { X: 1 },
                        triggeredAbilities: [
                            {
                                id: "self-sac-upkeep",
                                oracleText: "",
                                event: "PHASE_BEGIN",
                                matches: () => true,
                                effects: [
                                    {
                                        op: "dealDamage",
                                        amount: 3,
                                        to: { player: "opponent" },
                                    },
                                    {
                                        op: "sacrifice",
                                        target: { ref: "$source" },
                                    },
                                ],
                            },
                        ],
                    } as unknown as CardDefinition;
                    const once = dslStandingAbilityScriptValue(def);
                    const unscaled = dslStandingAbilityScriptValue(def, {
                        ...contextFreeGrounding(),
                        latent: {
                            ...contextFreeGrounding().latent,
                            weights: {
                                ...DEFAULT_EVAL_WEIGHTS.latent,
                                recurrence: 1,
                            },
                        },
                    });
                    expect(once).toBe(unscaled);
                });

                it("the hand face and the board face of a recurring-trigger permanent are one number", () => {
                    // `nonCreatureBodyValue` (evaluate.ts) scores a permanent in
                    // play through `cardValue` → the same `latentValue`
                    // composition the hand reads, so the multiplier reaches
                    // both faces and casting the permanent is never a loss
                    // the multiplier causes (issue #5145's one-number rule).
                    const vise = byName("Black Vise");
                    const perm = makeInstance(vise.id, {
                        controllerId: "p1",
                        ownerId: "p1",
                    });
                    const state = makeState({
                        players: [
                            makePlayer("p1", { battlefield: [perm] }),
                            makePlayer("p2"),
                        ],
                    });
                    const onBoard =
                        permanentRealisedValue(state, perm) -
                        DEFAULT_EVAL_WEIGHTS.permanentWeight;
                    expect(onBoard).toBeCloseTo(cardValueById(vise.id), 9);
                    expect(onBoard).toBeGreaterThan(floorOf(vise));
                });

                it("a non-creature card ANIMATED on the battlefield keeps the multiplier (Opalescence): board ≥ hand", () => {
                    // Under Opalescence an enchantment is a creature on the
                    // board, scored by `evaluateCreature` through the REALIZED
                    // reader. Without the multiplier there, Sylvan Library
                    // read 282 in hand and ~47 in play, and casting it was a
                    // 230-point loss the Verdict corpus then paid for by
                    // pulling `latent.recurrence` down for every card.
                    const library = byName("Sylvan Library");
                    const opalescence = byName("Opalescence");
                    const perm = makeInstance(library.id, {
                        controllerId: "p1",
                        ownerId: "p1",
                    });
                    const anim = makeInstance(opalescence.id, {
                        controllerId: "p1",
                        ownerId: "p1",
                    });
                    const state = makeState({
                        players: [
                            makePlayer("p1", { battlefield: [anim, perm] }),
                            makePlayer("p2"),
                        ],
                    });
                    const onBoard =
                        permanentRealisedValue(state, perm) -
                        DEFAULT_EVAL_WEIGHTS.permanentWeight;
                    const inHand = cardValueById(library.id);
                    expect(inHand).toBeGreaterThan(floorOf(library));
                    expect(onBoard).toBeGreaterThanOrEqual(inHand);
                });

                it("the multiplier is what lifts them: at recurrence 1 all three sit back at the floor", () => {
                    const flat = contextFreeGrounding({
                        ...DEFAULT_EVAL_WEIGHTS.latent,
                        recurrence: 1,
                    });
                    for (const name of [
                        "Black Vise",
                        "Ivory Tower",
                        "Essence Flare",
                    ]) {
                        const def = byName(name);
                        const standing = dslStandingAbilityScriptValue(
                            def,
                            flat
                        );
                        expect(standing, name).toBeDefined();
                        expect(standing!, name).toBeLessThan(floorOf(def));
                    }
                });
            });

            it("a real card: Nevinyrral's Disk outranks a script-less artifact of equal mana value", () => {
                const disk = cardValueById(
                    "12926dc8-8e6f-4a47-a12b-4d674189615a"
                );
                const weakstone = cardValueById(
                    "46adf48f-99d2-440e-9129-794584c1ea21"
                );
                expect(disk).toBeGreaterThan(weakstone);
            });
        });

        // Issue #1508 — a latent (in-hand) script value is clamped so no single
        // card can saturate the material signal. The `winGame` valuer returns
        // 100 000 and context-free grounding always assumes the `then` branch,
        // so a conditional alternate-win card (Coalition Victory) would report a
        // latent hand value of 100 000; unclamped, that pins the reward band
        // (MATERIAL_FULL = 500, `search.ts`) at its edge for any leaf while the
        // card sits in a hand, blinding the search to material.
        describe("latent-script clamp (issue #1508 — saturation impossible)", () => {
            const MATERIAL_FULL = 500; // mirror of `search.ts` band constant

            it("clamps an alternate-win-condition latent value far below the material band", () => {
                // A winGame-style script grounds to ~100 000 context-free.
                const clamped = latentValue({
                    ...base,
                    dslSpellValue: 100_000,
                });
                // The clamped worth must leave enough headroom below the band
                // edge that a creature dying (a ~170-200 pt swing) still moves
                // the reward — i.e. a single hand card cannot saturate it.
                expect(clamped).toBeLessThan(MATERIAL_FULL);
                expect(clamped).toBeLessThanOrEqual(300);
            });

            it("is exactly zero-impact for an ordinary hand (values below the clamp unchanged)", () => {
                // Ashes to Ashes tops out around 460 context-free? No — ordinary
                // scripts sit well under the cap; a 200-pt script is untouched.
                expect(latentValue({ ...base, dslSpellValue: 200 })).toBe(200);
                // And the floored small-script case is unchanged too.
                expect(latentValue({ ...base, dslSpellValue: 5 })).toBe(38);
            });

            it("even the most valuable known card in hand still leaves the reward responsive to a creature dying", () => {
                // The clamped hand value must leave more headroom below the band
                // edge than a realistic creature-death swing, so that material
                // swing still moves the reward rather than being swamped.
                const handCard = latentValue({
                    ...base,
                    dslSpellValue: 100_000,
                });
                const creatureSwing = 170; // a modest creature dying
                expect(MATERIAL_FULL - handCard).toBeGreaterThanOrEqual(
                    creatureSwing
                );
            });
        });

        it("a creature adds its ability-script value on top of its body", () => {
            const body = latentValue({
                isCreature: true,
                power: 2,
                toughness: 2,
                manaValue: 2,
                staticAbilities: [],
            });
            const withAbility = latentValue({
                isCreature: true,
                power: 2,
                toughness: 2,
                manaValue: 2,
                staticAbilities: [],
                dslAbilityValue: 50,
            });
            expect(withAbility).toBe(body + 50);
        });

        it("a creature's aiValue still overrides its WHOLE computed worth outright (unchanged; unified with the non-creature fix, issue #1512)", () => {
            expect(
                latentValue({
                    isCreature: true,
                    power: 2,
                    toughness: 2,
                    manaValue: 2,
                    staticAbilities: [],
                    dslAbilityValue: 500,
                    aiValue: 7,
                })
            ).toBe(7);
        });

        it("creature and non-creature branches apply IDENTICAL aiValue-over-script precedence (issue #1512)", () => {
            // Both branches: an explicit aiValue wins outright over a large
            // DSL-derived script value, regardless of card type.
            const creature = latentValue({
                isCreature: true,
                power: 2,
                toughness: 2,
                manaValue: 2,
                staticAbilities: [],
                dslAbilityValue: 500,
                aiValue: 42,
            });
            const nonCreature = latentValue({
                ...base,
                dslSpellValue: 500,
                aiValue: 42,
            });
            expect(creature).toBe(42);
            expect(nonCreature).toBe(42);
        });
    });
});

// --- aiEffects shadow-script mechanism (issue #1431) ------------------------
// A `resolve()` card given an `aiEffects` sketch gets a sensible derived
// cardValue: the SAME `OP_VALUERS` walker values the sketch identically to
// how it would value an equivalent real `effects[]` script, and that value
// flows through `dslSpellScriptValue` → `latentValue` exactly like a real
// script would (never executed — `resolve` still runs at resolution time).
describe("aiEffects shadow-script mechanism (issue #1431)", () => {
    it("a resolve()-only card's aiEffects sketch yields the same value a real effects[] script would", () => {
        const sketch: EffectOp[] = [
            { op: "dealDamage", amount: 3, to: { player: "opponent" } },
        ];
        const real: EffectOp[] = [
            { op: "dealDamage", amount: 3, to: { player: "opponent" } },
        ];
        const shadowValue = dslSpellScriptValue({
            id: "shadow-test",
            name: "Shadow Test",
            rarity: "common",
            types: ["Instant"],
            resolve: () => {},
            aiEffects: sketch,
        } as CardDefinition);
        const realValue = dslSpellScriptValue({
            id: "real-test",
            name: "Real Test",
            rarity: "common",
            types: ["Instant"],
            effects: real,
        } as CardDefinition);
        expect(shadowValue).toBeDefined();
        expect(shadowValue).toBe(realValue);
    });

    it("a resolve()-only card with a burn aiEffects sketch scores far above a do-nothing base+MV fallback", () => {
        const sketchValue = dslSpellScriptValue({
            id: "shadow-burn-test",
            name: "Shadow Burn Test",
            rarity: "common",
            types: ["Instant"],
            manaCost: { generic: 1 },
            resolve: () => {},
            aiEffects: [
                { op: "dealDamage", amount: 3, to: { player: "opponent" } },
            ],
        } as CardDefinition);
        expect(sketchValue).toBeDefined();
        const cardValue = latentValue({
            isCreature: false,
            power: 0,
            toughness: 0,
            manaValue: 1,
            staticAbilities: [],
            dslSpellValue: sketchValue,
        });
        // base+MV fallback for MV1 = 8 + 1×10 = 18.
        expect(cardValue).toBeGreaterThan(18 * 2);
    });

    it("real effects[] wins over aiEffects when a card carries both (defensive precedence check)", () => {
        const value = dslSpellScriptValue({
            id: "both-test",
            name: "Both Test",
            rarity: "common",
            types: ["Instant"],
            effects: [{ op: "gainLife", amount: 1, player: "controller" }],
            aiEffects: [
                { op: "dealDamage", amount: 20, to: { player: "opponent" } },
            ],
        } as CardDefinition);
        const realOnly = dslSpellScriptValue({
            id: "real-only-test",
            name: "Real Only Test",
            rarity: "common",
            types: ["Instant"],
            effects: [{ op: "gainLife", amount: 1, player: "controller" }],
        } as CardDefinition);
        expect(value).toBe(realOnly);
    });
});

describe("cardValue wire-format (issue #1426, client-read via bot-view)", () => {
    it("the DSL-derived value survives projectPublicState (id-keyed, projection-safe)", () => {
        const bolt = makeInstance(LIGHTNING_BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [bolt] }), makePlayer("p2")],
        });

        // Server-side (fat state): the burn is worth its DSL value.
        const fatId = String(state.players[0].hand[0].card.id);
        const fatValue = cardValueById(fatId);
        expect(fatValue).toBeGreaterThan(cardValueById(BLACK_WARD) * 3);

        // The same assertion after the wire projection — the client reads
        // `cardValueById(card.card.id)`, and `card.card` is stripped to `{ id }`.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].hand[0];
        const slimId = String((slim as { card: { id: string } }).card.id);
        expect(slimId).toBe(fatId); // the id survives the wire
        expect(cardValueById(slimId)).toBe(fatValue); // identical valuation
    });
});
