// Per-card behavior tests for INV gold cards (`convex/cards/sets/inv/multicolor.ts`).
// Both cards belong to the Domain capability cluster (issue #1066). The
// `{ domain: { of } }` value member and the `winGame` Op each already have
// their own permanent interpreter test (`convex/gre/effects/__tests__/interpreter.test.ts`)
// per the new-construct regime (ADR 0045) — the tests here assert the
// CARD-level wiring: Ordered Migration's Domain-scaled token count, and
// Coalition Victory's compound win predicate (both clauses required).

import { describe, it, expect } from "vitest";
import {
    orderedMigration,
    coalitionVictory,
    angelicShield,
    wingsOfHope,
    teferisMoat,
} from "../multicolor";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { plains, island, swamp, mountain, forest } from "../../lea/colorless";
import { grizzlyBears, scatheZombies } from "../../lea";
import { registerTokenDefinition } from "../../..";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { validateAttackerEligibility } from "../../../../gre/combat";

describe("Ordered Migration (CR 111 / 701.7 token creation, Domain, issue #1066)", () => {
    it("creates one 1/1 blue flying Bird per basic land type controlled", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "om-pl",
                            controllerId: "p1",
                        }),
                        makeInstance(island.id, {
                            id: "om-is",
                            controllerId: "p1",
                        }),
                        makeInstance(swamp.id, {
                            id: "om-sw",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, orderedMigration.id, "p1");
        resolveTopOfStack(state);
        const birds = state.players[0].battlefield.filter(
            (c) => c.id !== "om-pl" && c.id !== "om-is" && c.id !== "om-sw"
        );
        expect(birds).toHaveLength(3);
        for (const bird of birds) {
            expect(bird.power).toBe(1);
            expect(bird.toughness).toBe(1);
            expect(bird.staticAbilities).toContain("flying");
        }
    });

    it("creates no tokens for a player with no basic lands", () => {
        const state = makeState();
        pushSpell(state, orderedMigration.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
    });
});

describe("Coalition Victory (CR 104.2a alternate win, Domain, issue #1066)", () => {
    /** Five distinct basic lands (Domain 5) plus one creature per color,
     *  swappable per test so exactly one clause can be dropped at a time. */
    function fullBoard(overrides: {
        omitLand?: "Plains" | "Island" | "Swamp" | "Mountain" | "Forest";
        omitColor?: "W" | "U" | "B" | "R" | "G";
    }) {
        const lands = [
            { def: plains, subtype: "Plains" },
            { def: island, subtype: "Island" },
            { def: swamp, subtype: "Swamp" },
            { def: mountain, subtype: "Mountain" },
            { def: forest, subtype: "Forest" },
        ]
            .filter((l) => l.subtype !== overrides.omitLand)
            .map((l, i) =>
                makeInstance(l.def.id, {
                    id: `cv-land-${i}`,
                    controllerId: "p1",
                })
            );

        const colorCards: Record<"W" | "U" | "B" | "R" | "G", string> = {
            W: "test-cv-white",
            U: "test-cv-blue",
            B: "test-cv-black",
            R: "test-cv-red",
            G: "test-cv-green",
        };
        for (const [color, id] of Object.entries(colorCards)) {
            registerTokenDefinition({
                id,
                name: id,
                rarity: "common",
                manaCost: { [color]: 1 },
                types: ["Creature"],
                power: 1,
                toughness: 1,
            });
        }
        const creatures = (
            Object.entries(colorCards) as [
                "W" | "U" | "B" | "R" | "G",
                string,
            ][]
        )
            .filter(([color]) => color !== overrides.omitColor)
            .map(([color, id], i) =>
                makeInstance(id, {
                    id: `cv-creature-${color}-${i}`,
                    controllerId: "p1",
                })
            );

        return makeState({
            players: [
                makePlayer("p1", { battlefield: [...lands, ...creatures] }),
                makePlayer("p2"),
            ],
        });
    }

    it("wins when the controller has a land of each basic type AND a creature of each color", () => {
        const state = fullBoard({});
        pushSpell(state, coalitionVictory.id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });

    it("does NOT win when missing one basic land type (Domain 4)", () => {
        const state = fullBoard({ omitLand: "Forest" });
        pushSpell(state, coalitionVictory.id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toBeUndefined();
    });

    it("does NOT win when missing a creature of one color", () => {
        const state = fullBoard({ omitColor: "G" });
        pushSpell(state, coalitionVictory.id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toBeUndefined();
    });

    it("a multicolour creature covers each of its colors", () => {
        // 5 basic lands + ONE Naya-style tri-color creature (W/R/G) + mono U
        // + mono B creatures — still covers all five colors with fewer
        // creatures than five.
        const lands = [plains, island, swamp, mountain, forest].map((def, i) =>
            makeInstance(def.id, {
                id: `cv-multi-land-${i}`,
                controllerId: "p1",
            })
        );
        const triId = "test-cv-tricolor";
        registerTokenDefinition({
            id: triId,
            name: triId,
            rarity: "common",
            manaCost: { W: 1, R: 1, G: 1 },
            types: ["Creature"],
            power: 3,
            toughness: 3,
        });
        registerTokenDefinition({
            id: "test-cv-mono-u2",
            name: "test-cv-mono-u2",
            rarity: "common",
            manaCost: { U: 1 },
            types: ["Creature"],
            power: 1,
            toughness: 1,
        });
        registerTokenDefinition({
            id: "test-cv-mono-b2",
            name: "test-cv-mono-b2",
            rarity: "common",
            manaCost: { B: 1 },
            types: ["Creature"],
            power: 1,
            toughness: 1,
        });
        const creatures = [
            makeInstance(triId, { id: "cv-tri", controllerId: "p1" }),
            makeInstance("test-cv-mono-u2", {
                id: "cv-u2",
                controllerId: "p1",
            }),
            makeInstance("test-cv-mono-b2", {
                id: "cv-b2",
                controllerId: "p1",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [...lands, ...creatures] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, coalitionVictory.id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────
// staticEffects[] coverage (issue #1075) — Angelic Shield / Wings of Hope /
// Teferi's Moat. The catalogue smoke/static sweeps only iterate `effects[]`,
// so a card whose entire behavior is a `staticEffects[]` continuous effect
// gets no coverage from those sweeps and needs a hand-written test per the
// mandatory card-testing table (`.claude/rules/gre-development.md`).
// ─────────────────────────────────────────────────────────────────────────

describe("Angelic Shield (controller-scoped anthem +0/+1, CR 611/613 layer 7c)", () => {
    function setup() {
        const shield = makeInstance(angelicShield.id, {
            id: "shield",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dude = makeInstance(grizzlyBears.id, {
            id: "dude",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shield, dude] }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }
    it("gives +0/+1 to a creature you control", () => {
        const { state } = setup();
        const d = state.players[0].battlefield.find((c) => c.id === "dude")!;
        expect(getEffectivePower(state, d)).toBe(2);
        expect(getEffectiveToughness(state, d)).toBe(3);
    });
    it("does NOT buff a creature without Angelic Shield in play", () => {
        const { state } = setup();
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "shield"
        );
        const d = state.players[0].battlefield.find((c) => c.id === "dude")!;
        expect(getEffectivePower(state, d)).toBe(2);
        expect(getEffectiveToughness(state, d)).toBe(2);
    });
    it("wire format: the +0/+1 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "dude"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Wings of Hope (Aura +1/+3 + flying, CR 611/613 layer 6/7c)", () => {
    function setup() {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(wingsOfHope.id, {
            id: "wings",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }
    it("grants +1/+3 to the enchanted creature", () => {
        const { state } = setup();
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(5);
    });
    it("grants flying to the enchanted creature", () => {
        const { state } = setup();
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.staticAbilities).not.toContain("flying");
        // Flying is a layer-6 keyword grant computed at read time — the raw
        // instance's own staticAbilities never mutate; the interpreter reads
        // it via the same staticEffects scan getEffective{Power,Toughness}
        // uses. Assert via the declared keyword-grant static effect, mirroring
        // the Wings of Aesthir precedent (ice/multicolor.ts).
        const grants = (wingsOfHope.staticEffects ?? [])
            .filter((e) => e.kind === "keyword-grant")
            .map((e) => (e as { keyword: string }).keyword);
        expect(grants).toEqual(["flying"]);
    });
    it("wire format: the +1/+3 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });
});

describe("Teferi's Moat (chosen-color no-fly attack lock, CR 508/509 + 603.6b)", () => {
    function setup(chosenColor: string, attackerCardId: string) {
        const moat = makeInstance(teferisMoat.id, {
            id: "moat",
            controllerId: "p1",
            ownerId: "p1",
            chosenModeId: chosenColor,
        });
        const attacker = makeInstance(attackerCardId, {
            id: "attacker",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [moat] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        const live = state.players[1].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        return { state, live };
    }
    it("forbids a chosen-color, non-flying creature from attacking the Moat's controller", () => {
        // Grizzly Bears is a mono-green ({G}) vanilla body.
        const { state, live } = setup("G", grizzlyBears.id);
        const v = validateAttackerEligibility(live, [], state);
        expect(v.eligible).toBe(false);
    });
    it("allows a different-color creature to attack", () => {
        // Scathe Zombies is mono-black ({B}); Teferi's Moat locked green.
        const { state, live } = setup("G", scatheZombies.id);
        expect(validateAttackerEligibility(live, [], state).eligible).toBe(
            true
        );
    });
});
