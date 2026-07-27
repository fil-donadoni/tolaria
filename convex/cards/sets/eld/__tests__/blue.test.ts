// Throne of Eldraine (ELD) — blue cards, per-card behavior tests
// (`convex/cards/sets/eld/blue.ts`, ADR 0043 colour split). Each non-trivial
// card gets a describe block citing the CR section it exercises; assertions
// check external behavior only. Shared fixtures live in
// `convex/cards/__tests__/setup.ts`.

import { describe, it, expect } from "vitest";
import { emryLurkerOfTheLoch } from "..";
import { solRing } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { getLegalActions } from "../../../../gre/rules";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
    type GameState,
} from "../../../../gre/state";

// ─────────────────────────────────────────────────────────────────────────────
// Slice #1337 (PRD #702, ADR 0063) — count-driven SELF-HOST cost reduction:
// Emry, Lurker of the Loch, "This spell costs {1} less to cast for each
// artifact you control." Unlike every other `costReduction` consumer (Mana
// Matrix, Planar Gate, Power Artifact, Stone Calendar — all discovered via a
// battlefield `staticEffects` scan and asserted unchanged by their OWN
// existing test suites, run as this change's regression), Emry's reducer is
// intrinsic to the spell being cast and is read directly off her own
// `CardDefinition.selfCostReduction` at the same CR 601.2f apply site
// (`getCostModifiers`, `gre/state.ts`). Generic-only, floored at 0, evaluated
// against the ANNOUNCING player's own battlefield.
// ─────────────────────────────────────────────────────────────────────────────

describe("Emry, Lurker of the Loch (count-driven self cost-reduction, CR 601.2f / ADR 0063)", () => {
    /** Mirror game.ts's plain hand-cast cost calc: normalize the printed cost,
     *  then fold in cost modifiers (battlefield scan + self-host) — the exact
     *  functions game.ts calls at the real cast site (`convex/game.ts:4685`). */
    function effectiveCastCost(
        state: GameState,
        controllerId = "p1"
    ): Record<string, number> {
        const spellView = makeInstance(emryLurkerOfTheLoch.id, {
            id: "emry-spell-view",
            controllerId,
            zone: "hand",
        });
        const cost = normalizeManaCost(emryLurkerOfTheLoch.manaCost ?? {});
        applyCostModifiers(cost, getCostModifiers(state, spellView, "spell"));
        return cost;
    }

    function boardWithArtifacts(n: number, controllerId: "p1" | "p2" = "p1") {
        const artifacts = Array.from({ length: n }, (_, i) =>
            makeInstance(solRing.id, { id: `art-${i}`, controllerId })
        );
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: controllerId === "p1" ? artifacts : [],
                }),
                makePlayer("p2", {
                    battlefield: controllerId === "p2" ? artifacts : [],
                }),
            ],
        });
    }

    it("definition: {2}{U} Legendary Creature — Merfolk Wizard, 1/2, with a self-host cost reduction", () => {
        expect(emryLurkerOfTheLoch.manaCost).toEqual({ X: 2, U: 1 });
        expect(emryLurkerOfTheLoch.types).toEqual(["Creature"]);
        expect(emryLurkerOfTheLoch.subtypes).toEqual(["Merfolk", "Wizard"]);
        expect(emryLurkerOfTheLoch.power).toBe(1);
        expect(emryLurkerOfTheLoch.toughness).toBe(2);
        expect(emryLurkerOfTheLoch.selfCostReduction).toEqual({
            costReduction: {
                perCount: { X: 1 },
                countFilter: { types: "Artifact" },
            },
        });
    });

    it("costs the full {2}{U} with no artifacts controlled", () => {
        expect(effectiveCastCost(boardWithArtifacts(0))).toEqual({
            X: 2,
            U: 1,
        });
    });

    it("costs {1} less per artifact you control (1 artifact → {1}{U})", () => {
        expect(effectiveCastCost(boardWithArtifacts(1))).toEqual({
            X: 1,
            U: 1,
        });
    });

    it("drops the generic portion entirely at 2 artifacts (2 × {1} = the full {2})", () => {
        expect(effectiveCastCost(boardWithArtifacts(2))).toEqual({ U: 1 });
    });

    it("floors at 0 generic — never goes negative (5 artifacts, only {2} generic to reduce)", () => {
        expect(effectiveCastCost(boardWithArtifacts(5))).toEqual({ U: 1 });
    });

    it("never reduces the colored {U} pip (CR 601.2f generic-only)", () => {
        expect(effectiveCastCost(boardWithArtifacts(5)).U).toBe(1);
    });

    it("only counts the CASTER's own artifacts, never an opponent's", () => {
        // The 3 artifacts belong to p2; p1 is casting Emry.
        expect(effectiveCastCost(boardWithArtifacts(3, "p2"), "p1")).toEqual({
            X: 2,
            U: 1,
        });
    });

    it("does not count herself (a Creature is never an Artifact, and she isn't a permanent while being cast)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(emryLurkerOfTheLoch.id, {
                            id: "other-emry",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(effectiveCastCost(state)).toEqual({ X: 2, U: 1 });
    });

    it("ETB triggered ability mills four cards (CR 603.6a)", () => {
        // `mill` is an already-exercised Op (gre-development.md § per-Op
        // regime) — a definition-level assertion covers the wiring; the Op's
        // own behavior is covered by the interpreter suite.
        const trigger = emryLurkerOfTheLoch.triggeredAbilities?.find((t) =>
            t.oracleText?.includes("mill four cards")
        );
        expect(trigger).toBeDefined();
    });

    it("castability (server legalActions) is NOT offered without enough mana or artifacts", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(emryLurkerOfTheLoch.id, {
                            id: "emry-hand",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const card = state.players[0].hand[0];
        // Only {U} floating — the un-reduced {2}{U} isn't payable.
        expect(getLegalActions(state, state.players[0], card)).not.toContain(
            "cast"
        );
    });

    it("castability (server legalActions) reflects the reduction once enough artifacts are controlled", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(emryLurkerOfTheLoch.id, {
                            id: "emry-hand",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(solRing.id, {
                            id: "art-1",
                            controllerId: "p1",
                        }),
                        makeInstance(solRing.id, {
                            id: "art-2",
                            controllerId: "p1",
                        }),
                    ],
                    manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const card = state.players[0].hand[0];
        // {2} generic fully reduced by 2 artifacts → {U} only, payable with
        // the {U} floating in the pool.
        expect(getLegalActions(state, state.players[0], card)).toContain(
            "cast"
        );
    });

    it("the castability flip survives the wire projection (GRE → UI full path)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(emryLurkerOfTheLoch.id, {
                            id: "emry-hand",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(solRing.id, {
                            id: "art-1",
                            controllerId: "p1",
                        }),
                        makeInstance(solRing.id, {
                            id: "art-2",
                            controllerId: "p1",
                        }),
                    ],
                    manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const projectedEmry = projected.players[0].hand.find(
            (c) => c?.id === "emry-hand"
        )!;
        expect(projectedEmry.legalActions).toContain("cast");
    });
});
