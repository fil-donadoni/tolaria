// Per-Op value model unit tests (PRD #1423, issue #1426). One block per
// charter valuer, asserting its `{ points, tags }` under context-free grounding
// (the card-in-hand mode `cardValue` consumes) and — where the two modes
// diverge — context-aware grounding (the decision-node prior mode).

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../cards/types";
import {
    valueOp,
    valueEffectScript,
    OP_VALUERS,
    STRUCTURAL_CONSTRUCTS,
    contextFreeGrounding,
    contextAwareGrounding,
} from "../index";

const cf = contextFreeGrounding();

describe("OP_VALUERS — charter valuers (PRD #1423, issue #1426)", () => {
    describe("dealDamage (CR 120)", () => {
        it("scores damage to a player positively, scaled by amount", () => {
            const op: EffectOp = {
                op: "dealDamage",
                amount: 3,
                to: { player: "opponent" },
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(66); // 3 × 22
            expect(v.tags).toContain("damage");
            expect(v.tags).not.toContain("targeted");
        });

        it("tags an announced-target damage `targeted`", () => {
            const op: EffectOp = {
                op: "dealDamage",
                amount: 2,
                to: { target: 0 },
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(44);
            expect(v.tags).toEqual(
                expect.arrayContaining(["damage", "targeted"])
            );
        });

        it("flags a variable (X) amount board-scaling with a floor value", () => {
            const op: EffectOp = {
                op: "dealDamage",
                amount: { X: true },
                to: { player: "opponent" },
            };
            const v = valueOp(op, cf);
            expect(v.tags).toContain("board-scaling");
            expect(v.points).toBeGreaterThan(0);
        });

        it("context-aware reads the real X amount (no board-scaling tag)", () => {
            const op: EffectOp = {
                op: "dealDamage",
                amount: { X: true },
                to: { player: "opponent" },
            };
            const ctx = contextAwareGrounding({
                resolveValue: () => 7,
                resolveIsSelf: () => false,
                resolveForEachCount: () => 1,
            });
            const v = valueOp(op, ctx);
            expect(v.points).toBe(154); // 7 × 22
            expect(v.tags).not.toContain("board-scaling");
        });

        // Issue #1521 — a player-directed damage Op is not always aimed at
        // the opponent: a recoil/symmetric rider names the caster's own side.
        it("a self-directed damage rider is a cost (negative, self-cost)", () => {
            const op: EffectOp = {
                op: "dealDamage",
                amount: 4,
                to: { player: "controller" },
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(-88); // -(4 × 22)
            expect(v.tags).toContain("self-cost");
        });

        it("an opponent-only burn (via a player ref) stays positive", () => {
            const op: EffectOp = {
                op: "dealDamage",
                amount: 4,
                to: { player: "opponent" },
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(88);
            expect(v.tags).not.toContain("self-cost");
        });

        it("a symmetric each-player damage script values near neutral", () => {
            // Earthquake/Flame Rift/Fissure-style: `forEach { set: "players" }`
            // over `dealDamage` to the `$each` iteration variable hits every
            // player, including the caster — net contribution ≈ 0, not the
            // pure-gain value a blanket "damage always helps the caster"
            // assumption would produce.
            const script: EffectOp[] = [
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 4,
                            to: { player: { ref: "$each" } },
                        },
                    ],
                },
            ];
            const v = valueEffectScript(script, cf);
            expect(v.points).toBe(0);
        });

        it("a two-sided recoil script (target + self rider) nets near zero", () => {
            // Fire and Brimstone-shaped: N damage to an opponent-resolving
            // target, N damage to the caster — the two legs cancel.
            const script: EffectOp[] = [
                { op: "dealDamage", amount: 4, to: { player: "opponent" } },
                { op: "dealDamage", amount: 4, to: { player: "controller" } },
            ];
            expect(valueEffectScript(script, cf).points).toBe(0);
        });
    });

    describe("draw (CR 121.1)", () => {
        it("scores a self-draw as card advantage (positive)", () => {
            const op: EffectOp = { op: "draw", player: "controller", count: 2 };
            const v = valueOp(op, cf);
            expect(v.points).toBe(90); // 2 × 45
            expect(v.tags).toContain("cardAdvantage");
        });

        it("scores an opponent-draw (a downside) negatively", () => {
            const op: EffectOp = { op: "draw", player: "opponent", count: 1 };
            expect(valueOp(op, cf).points).toBe(-45);
        });
    });

    describe("gainLife / loseLife (CR 119.3)", () => {
        it("gainLife to self is a positive life swing", () => {
            const op: EffectOp = {
                op: "gainLife",
                player: "controller",
                amount: 3,
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(24); // 3 × 8
            expect(v.tags).toContain("lifeSwing");
        });

        it("loseLife aimed at the opponent is positive (a drain)", () => {
            const op: EffectOp = {
                op: "loseLife",
                player: "opponent",
                amount: 4,
            };
            expect(valueOp(op, cf).points).toBe(32); // 4 × 8
        });

        it("loseLife the caster pays is a self-cost (negative)", () => {
            const op: EffectOp = {
                op: "loseLife",
                player: "controller",
                amount: 2,
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(-16);
            expect(v.tags).toContain("self-cost");
        });
    });

    describe("destroy / exile (CR 701.8 / 701.13)", () => {
        it("destroy scores board removal, targeted", () => {
            const op: EffectOp = { op: "destroy", target: { target: 0 } };
            const v = valueOp(op, cf);
            expect(v.points).toBe(160);
            expect(v.tags).toEqual(
                expect.arrayContaining(["boardRemoval", "targeted"])
            );
        });

        it("exile scores a hair above destroy (no regen/recursion)", () => {
            const exileV = valueOp(
                { op: "exile", target: { target: 0 } },
                cf
            ).points;
            const destroyV = valueOp(
                { op: "destroy", target: { target: 0 } },
                cf
            ).points;
            expect(exileV).toBeGreaterThan(destroyV);
        });
    });

    describe("counter (CR 701.5a)", () => {
        it("scores disruption, targeted", () => {
            const v = valueOp({ op: "counter", target: { target: 0 } }, cf);
            expect(v.points).toBe(130);
            expect(v.tags).toEqual(
                expect.arrayContaining(["disruption", "targeted"])
            );
        });
    });

    describe("mayPay (CR 117.3a)", () => {
        it("is neutral — its consequence lives in the following `if`", () => {
            const op: EffectOp = {
                op: "mayPay",
                player: "controller",
                cost: { life: 2 },
                prompt: "Pay 2 life?",
                bind: "$paid",
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(0);
            expect(v.tags).toEqual([]);
        });
    });

    describe("sacrifice (CR 701.16)", () => {
        it("a forced picks-set sacrifice (edict) is positive removal", () => {
            const op: EffectOp = {
                op: "sacrifice",
                permanents: { ref: "$picked" },
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(120);
            expect(v.tags).toContain("boardRemoval");
            expect(v.tags).not.toContain("self-cost");
        });

        it("a self/target sacrifice is a cost (negative, self-cost)", () => {
            const op: EffectOp = {
                op: "sacrifice",
                target: { ref: "$source" },
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(-40);
            expect(v.tags).toContain("self-cost");
        });

        // Issue #1521 — an ANNOUNCED target slot (as opposed to a `$source`/
        // snapshot-bound ref) is a legal target chosen at cast/activation
        // time — the target requirement may allow an opponent's permanent —
        // so it reads as removal, not the caster's own cost.
        it("an announced-target sacrifice is positive removal, not a cost", () => {
            const op: EffectOp = {
                op: "sacrifice",
                target: { target: 0 },
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(120);
            expect(v.tags).toEqual(
                expect.arrayContaining(["boardRemoval", "targeted"])
            );
            expect(v.tags).not.toContain("self-cost");
        });
    });

    describe("divideIntoPiles (ADR 0053)", () => {
        const pileScript = (): {
            chosenEffect: EffectOp[];
            otherEffect: EffectOp[];
        } => ({
            chosenEffect: [
                { op: "gainLife", player: "controller", amount: 10 },
            ],
            otherEffect: [{ op: "gainLife", player: "controller", amount: 2 }],
        });

        it("values the BEST pile when the chooser is the caster (self)", () => {
            const { chosenEffect, otherEffect } = pileScript();
            const op: EffectOp = {
                op: "divideIntoPiles",
                objects: { set: "library-top", player: "controller", count: 4 },
                divider: "opponent",
                chooser: "controller",
                dividePrompt: "Divide",
                pickPrompt: "Pick",
                chosenBind: "$chosen",
                otherBind: "$other",
                chosenEffect,
                otherEffect,
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(80); // max(10, 2) × 8 (LIFE_PER_POINT)
        });

        it("values the WORST pile (≈ min) when the chooser is the opponent", () => {
            const { chosenEffect, otherEffect } = pileScript();
            const op: EffectOp = {
                op: "divideIntoPiles",
                objects: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "controller",
                },
                divider: "controller",
                chooser: "opponent",
                dividePrompt: "Divide",
                pickPrompt: "Pick",
                chosenBind: "$chosen",
                otherBind: "$other",
                chosenEffect,
                otherEffect,
            };
            const v = valueOp(op, cf);
            const chosen = valueEffectScript(chosenEffect, cf).points;
            const other = valueEffectScript(otherEffect, cf).points;
            expect(v.points).toBe(Math.min(chosen, other));
            expect(v.points).toBe(16); // min(80, 16)
            expect(v.points).toBeLessThanOrEqual((chosen + other) / 2);
        });
    });

    describe("moveZone (CR 400.7)", () => {
        it("reanimation (→ battlefield) is high-value recursion", () => {
            const op: EffectOp = {
                op: "moveZone",
                target: { target: 0 },
                to: "battlefield",
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(140);
            expect(v.tags).toContain("recursion");
        });

        it("bounce/regrowth (→ hand) is a positive tempo/advantage swing", () => {
            const op: EffectOp = {
                op: "moveZone",
                target: { target: 0 },
                to: "hand",
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(55);
            expect(v.tags).toEqual(
                expect.arrayContaining(["tempo", "targeted"])
            );
        });
    });

    describe("createToken (CR 111 / 707.2)", () => {
        it("values a creature token by its (discounted) body × count", () => {
            const op: EffectOp = {
                op: "createToken",
                token: {
                    name: "Bear",
                    types: ["Creature"],
                    power: 2,
                    toughness: 2,
                },
                controller: "controller",
            };
            const v = valueOp(op, cf);
            // 0.85 × creatureValueRaw(2,2,0,[]) = 0.85 × (100+30+28) = 134.3
            expect(v.points).toBeCloseTo(134.3, 1);
            expect(v.tags).toContain("tokens");
        });

        it("scales with count and flags board-scaling on a variable count", () => {
            const op: EffectOp = {
                op: "createToken",
                token: {
                    name: "Goblin",
                    types: ["Creature"],
                    power: 1,
                    toughness: 1,
                },
                controller: "controller",
                count: { X: true },
            };
            const v = valueOp(op, cf);
            expect(v.tags).toContain("board-scaling");
            expect(v.points).toBeGreaterThan(0);
        });
    });

    describe("pump (CR 613.4c)", () => {
        it("a positive pump loads the `pump` feature", () => {
            const op: EffectOp = {
                op: "pump",
                target: { target: 0 },
                power: 3,
                toughness: 3,
                duration: { phase: "end-of-turn" },
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(54); // (3+3) × 9
            expect(v.tags).toContain("pump");
        });

        it("a negative pump (shrink) loads `boardRemoval`, magnitude positive", () => {
            const op: EffectOp = {
                op: "pump",
                target: { target: 0 },
                power: -2,
                toughness: -2,
                duration: { phase: "end-of-turn" },
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(36); // |−4| × 9
            expect(v.tags).toContain("boardRemoval");
        });
    });

    describe("counters (CR 122)", () => {
        it("adding +1/+1 counters loads `pump`", () => {
            const op: EffectOp = {
                op: "counters",
                action: "add",
                counter: "+1/+1",
                target: { target: 0 },
                count: 2,
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(36); // (1+1) × 2 × 9
            expect(v.tags).toContain("pump");
        });

        it("adding -1/-1 counters loads `boardRemoval`", () => {
            const op: EffectOp = {
                op: "counters",
                action: "add",
                counter: "-1/-1",
                target: { target: 0 },
                count: 1,
            };
            const v = valueOp(op, cf);
            expect(v.tags).toContain("boardRemoval");
            expect(v.points).toBeGreaterThan(0);
        });
    });
});

describe("OP_VALUERS — representative backfilled valuers (issue #1430)", () => {
    describe("extraTurn (CR 500.7) — high value", () => {
        it("scores a large flat tempo swing", () => {
            const op: EffectOp = { op: "extraTurn", player: "controller" };
            const v = valueOp(op, cf);
            expect(v.points).toBe(300);
            expect(v.tags).toContain("tempo");
            // An extra turn must out-score ordinary removal/burn by a wide
            // margin — it is the biggest single-Op swing in the basis.
            expect(v.points).toBeGreaterThan(
                valueOp({ op: "destroy", target: { target: 0 } }, cf).points
            );
        });
    });

    describe("winGame (CR 104.2a) — effectively infinite value", () => {
        it("scores far above every other Op", () => {
            const op: EffectOp = { op: "winGame", player: "controller" };
            const v = valueOp(op, cf);
            expect(v.points).toBe(100000);
            expect(v.points).toBeGreaterThan(
                valueOp({ op: "extraTurn", player: "controller" }, cf).points
            );
        });
    });

    describe("mill (CR 701.17) — card-selection/denial", () => {
        it("scores milling the opponent as a small positive denial, scaled by count", () => {
            const op: EffectOp = { op: "mill", player: "opponent", count: 3 };
            const v = valueOp(op, cf);
            expect(v.points).toBe(18); // 3 × 6
            expect(v.tags).toContain("cardAdvantage");
        });

        it("scores self-mill as a small negative (a library-resource cost)", () => {
            const op: EffectOp = { op: "mill", player: "controller", count: 2 };
            expect(valueOp(op, cf).points).toBe(-12); // -(2 × 6)
        });
    });

    describe("digToHand (CR 401.4) — card selection", () => {
        it("scores an impulse-style dig by how many cards land in hand", () => {
            const op: EffectOp = {
                op: "digToHand",
                player: "controller",
                look: 3,
                take: 2,
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(60); // 2 × 30
            expect(v.tags).toContain("cardAdvantage");
        });

        it("defaults `take` to 1 when omitted", () => {
            const op: EffectOp = {
                op: "digToHand",
                player: "controller",
                look: 4,
            };
            expect(valueOp(op, cf).points).toBe(30);
        });
    });

    describe("setColor / nameCard — near-zero enablers", () => {
        it("setColor carries no intrinsic material", () => {
            const op: EffectOp = {
                op: "setColor",
                target: { target: 0 },
                colors: ["U"],
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(0);
            expect(v.tags).toEqual([]);
        });

        it("nameCard carries no intrinsic material", () => {
            const op: EffectOp = {
                op: "nameCard",
                player: "controller",
                prompt: "Name a card",
                bind: "$named",
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(0);
            expect(v.tags).toEqual([]);
        });
    });

    describe("regenerate (CR 701.15) — defensive", () => {
        it("scores a destroy-proof shield, targeted", () => {
            const op: EffectOp = {
                op: "regenerate",
                target: { target: 0 },
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(60);
            expect(v.tags).toEqual(
                expect.arrayContaining(["protection", "targeted"])
            );
        });
    });

    describe("preventDamage (CR 615) — defensive", () => {
        it("`next-n` scales with the prevented amount", () => {
            const op: EffectOp = {
                op: "preventDamage",
                mode: "next-n",
                to: { player: "controller" },
                amount: 3,
                duration: { phase: "end-of-turn" },
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(24); // 3 × 8 (LIFE_PER_POINT)
            expect(v.tags).toContain("protection");
        });

        it("`all-combat` (Fog) is a flat defensive shield with no amount", () => {
            const op: EffectOp = { op: "preventDamage", mode: "all-combat" };
            const v = valueOp(op, cf);
            expect(v.points).toBe(70);
            expect(v.tags).toContain("protection");
        });
    });

    describe("castDuringResolution (CR 608.2f) — issue #1515 backfill", () => {
        it("values a free (Cascade-style) mini-cast above a plain drawn card", () => {
            const op: EffectOp = {
                op: "castDuringResolution",
                card: { ref: "$discarded" },
                player: "controller",
                source: "graveyard",
                free: true,
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(55);
            expect(v.points).toBeGreaterThan(
                valueOp({ op: "draw", player: "controller", count: 1 }, cf)
                    .points // 45 — CARD_VALUE
            );
            expect(v.tags).toEqual(
                expect.arrayContaining(["cardAdvantage", "board-scaling"])
            );
        });

        it("values a pay-the-cost mini-cast lower (the mana cost offsets the card)", () => {
            const op: EffectOp = {
                op: "castDuringResolution",
                player: "controller",
                fromTopOfLibrary: true,
            };
            const v = valueOp(op, cf);
            expect(v.points).toBe(20);
            expect(v.tags).toContain("cardAdvantage");
        });
    });

    describe("createTokenCopy (CR 707.2 + CR 111.1) — issue #1515 backfill", () => {
        it("values a token copy by a representative (discounted) body", () => {
            const op: EffectOp = {
                op: "createTokenCopy",
                source: { target: 0 },
                controller: "controller",
            };
            const v = valueOp(op, cf);
            // 0.85 × creatureValueRaw(2,2,0,[]) = 0.85 × (100+30+28) = 134.3 —
            // the SAME representative magnitude as createToken's 2/2 example,
            // since the copied body is unknown until runtime.
            expect(v.points).toBeCloseTo(134.3, 1);
            expect(v.tags).toEqual(
                expect.arrayContaining(["tokens", "board-scaling", "targeted"])
            );
        });

        it("scales with count and stays board-scaling even at a fixed count", () => {
            const op: EffectOp = {
                op: "createTokenCopy",
                source: { ref: "$token" },
                controller: "controller",
                count: 2,
            };
            const v = valueOp(op, cf);
            expect(v.points).toBeCloseTo(134.3 * 2, 1);
            expect(v.tags).toContain("board-scaling");
            expect(v.tags).not.toContain("targeted"); // a `ref` source, not an announced target
        });
    });
});

describe("walker — structural constructs (PRD #1423)", () => {
    it("sums a flat script's Op values", () => {
        const script: EffectOp[] = [
            { op: "dealDamage", amount: 2, to: { player: "opponent" } },
            { op: "draw", player: "controller", count: 1 },
        ];
        expect(valueEffectScript(script, cf).points).toBe(44 + 45);
    });

    it("`if` takes the effect-happens (`then`) branch", () => {
        const op: EffectOp = {
            op: "if",
            predicate: { left: { X: true }, op: "ge", right: 1 },
            then: [{ op: "destroy", target: { target: 0 } }],
        };
        expect(valueOp(op, cf).points).toBe(160);
    });

    it("`forEach` values the body once and flags board-scaling (context-free)", () => {
        const op: EffectOp = {
            op: "forEach",
            select: { set: "permanents", zone: "battlefield" },
            effects: [{ op: "dealDamage", amount: 1, to: { ref: "$each" } }],
        };
        const v = valueOp(op, cf);
        expect(v.points).toBe(22); // 1 member × (1 × 22)
        expect(v.tags).toContain("board-scaling");
    });

    it("`forEach` multiplies by the real member count (context-aware)", () => {
        const op: EffectOp = {
            op: "forEach",
            select: { set: "permanents", zone: "battlefield" },
            effects: [{ op: "dealDamage", amount: 1, to: { ref: "$each" } }],
        };
        const ctx = contextAwareGrounding({
            resolveValue: (v) => (typeof v === "number" ? v : 1),
            resolveIsSelf: () => false,
            resolveForEachCount: () => 4,
        });
        expect(valueOp(op, ctx).points).toBe(88); // 4 × 22
    });

    it("`optionChoice` is worth its best mode", () => {
        const op: EffectOp = {
            op: "optionChoice",
            prompt: "Choose one",
            modes: [
                {
                    label: "gain",
                    effects: [
                        { op: "gainLife", player: "controller", amount: 2 },
                    ],
                },
                {
                    label: "kill",
                    effects: [{ op: "destroy", target: { target: 0 } }],
                },
            ],
        };
        expect(valueOp(op, cf).points).toBe(160);
    });

    it("`coinFlip` is the expected value of its branches", () => {
        const op: EffectOp = {
            op: "coinFlip",
            player: "controller",
            win: {
                consequence: "deal 4",
                effects: [
                    { op: "dealDamage", amount: 4, to: { player: "opponent" } },
                ],
            },
            loss: { consequence: "nothing", effects: [] },
        };
        expect(valueOp(op, cf).points).toBe((88 + 0) / 2);
    });

    it("an Op with no valuer contributes nothing (defensive default)", () => {
        // The backfill allowlist is empty (issue #1430) — every implemented
        // Op now has a valuer. This asserts the walker's own fallback for a
        // (hypothetical) Op name absent from `OP_VALUERS` never throws or
        // fabricates a value; it's a not-yet-registered name, never a real
        // catalogue Op.
        const op = {
            op: "notARealOp",
            player: "opponent",
        } as unknown as EffectOp;
        expect(valueOp(op, cf).points).toBe(0);
    });
});

describe("dispatch-table invariants", () => {
    it("every charter Op has a valuer and no structural construct does", () => {
        for (const s of STRUCTURAL_CONSTRUCTS) {
            expect(OP_VALUERS[s as keyof typeof OP_VALUERS]).toBeUndefined();
        }
        const charter = [
            "dealDamage",
            "draw",
            "gainLife",
            "loseLife",
            "destroy",
            "exile",
            "counter",
            "mayPay",
            "sacrifice",
            "moveZone",
            "createToken",
            "pump",
            "counters",
        ] as const;
        for (const op of charter) {
            expect(OP_VALUERS[op]).toBeTypeOf("function");
        }
    });
});
