// CMR — blue card behavior tests. Hullbreacher rides the unified
// draw-replacement seam (CR 614 / 616.1, ADR 0061, issue #1265): an opponent's
// non-draw-step draw is redirected to a Treasure token for Hullbreacher's
// controller.

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../types";
import { hullbreacher } from "../blue";
import {
    registerTokenDefinition,
    getCardByName,
    getDefinition,
} from "../../../index";
import { buildDrawEvent, resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

const bearsId = getCardByName("Balduvian Bears").id;

function hullbreacherInstance(controllerId: string) {
    return makeInstance(hullbreacher.id, {
        controllerId,
        ownerId: controllerId,
    });
}

/** A synthetic sorcery whose only effect is a DSL `draw` Op (registered under a
 *  test id so the catalogue sweep never sees it). Drives an opponent's EFFECT
 *  draw through the real `resolveTopOfStack` path. */
function registerDrawSpell(id: string, count: number): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { U: 1 },
        types: ["Sorcery"],
        effects: [{ op: "draw", player: "controller", count } as EffectOp],
    });
    return id;
}

describe("Hullbreacher (CR 614 / 616.1, ADR 0061 — issue #1265)", () => {
    const draw = hullbreacher.drawReplacement!;

    it("has the right cost / type / P-T and Flash (Scryfall)", () => {
        expect(hullbreacher.manaCost).toEqual({ X: 2, U: 1 });
        expect(hullbreacher.types).toEqual(["Creature"]);
        expect(hullbreacher.subtypes).toEqual(["Merfolk", "Pirate"]);
        expect(hullbreacher.power).toBe(3);
        expect(hullbreacher.toughness).toBe(2);
        expect(hullbreacher.staticAbilities).toContain("flash");
    });

    describe("draw-replacement scope (CR 614)", () => {
        const source = { controllerId: "p2" } as never;
        const state = makeState();

        it("applies to an opponent's NON-draw-step draw", () => {
            const event = buildDrawEvent(state, "p1", 1, false);
            expect(draw.applies(event, source, state as never)).toBe(true);
        });

        it("does NOT apply to an opponent's turn-based draw-step draw", () => {
            const event = buildDrawEvent(state, "p1", 1, true);
            expect(draw.applies(event, source, state as never)).toBe(false);
        });

        it("does NOT apply to the controller's own draw", () => {
            const event = buildDrawEvent(state, "p2", 1, false);
            expect(draw.applies(event, source, state as never)).toBe(false);
        });

        it("redirects to a Treasure token for the controller", () => {
            expect(draw.outcome.kind).toBe("redirect-to-token");
        });
    });

    describe("opponent effect draw → Treasure, opponent draws nothing", () => {
        function stateWithHullbreacher(spellId: string): ReturnType<
            typeof makeState
        > {
            const top = makeInstance(bearsId, {
                id: "p1-top",
                ownerId: "p1",
                zone: "library",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { library: [top] }),
                    makePlayer("p2", {
                        battlefield: [hullbreacherInstance("p2")],
                    }),
                ],
            });
            // p1 (the opponent of Hullbreacher's controller) casts a draw spell.
            pushSpell(state, spellId, "p1");
            return state;
        }

        it("an opponent's effect draw makes the controller a Treasure and draws nothing", () => {
            const id = registerDrawSpell("test-hullbreacher-divination", 1);
            const state = stateWithHullbreacher(id);
            resolveTopOfStack(state);

            // p1 (drawing player) drew nothing — no card, library untouched.
            expect(state.players[0].hand).toHaveLength(0);
            expect(state.players[0].library).toHaveLength(1);
            expect(state.players[0].hasDrawnFromEmpty).toBeFalsy();

            // p2 (Hullbreacher's controller) got a Treasure token.
            const treasures = state.players[1].battlefield.filter((c) =>
                c.subtypes.includes("Treasure")
            );
            expect(treasures).toHaveLength(1);
            const def = getDefinition(
                (treasures[0].card as { id: string }).id
            );
            expect(def.types).toContain("Artifact");
            // The Treasure ships with its sacrifice-for-mana ability (issue #778).
            expect(def.activatedAbilities?.[0]?.id).toBe("treasure-token-mana");
        });

        it("a two-card effect draw makes TWO Treasures (fires per card)", () => {
            const id = registerDrawSpell("test-hullbreacher-two", 2);
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        library: [
                            makeInstance(bearsId, {
                                id: "a",
                                ownerId: "p1",
                                zone: "library",
                            }),
                            makeInstance(bearsId, {
                                id: "b",
                                ownerId: "p1",
                                zone: "library",
                            }),
                        ],
                    }),
                    makePlayer("p2", {
                        battlefield: [hullbreacherInstance("p2")],
                    }),
                ],
            });
            pushSpell(state, id, "p1");
            resolveTopOfStack(state);
            expect(state.players[0].hand).toHaveLength(0);
            const treasures = state.players[1].battlefield.filter((c) =>
                c.subtypes.includes("Treasure")
            );
            expect(treasures).toHaveLength(2);
        });
    });

    describe("wire format (S5) — the Treasure survives projection", () => {
        it("the created Treasure crosses projectPublicState", () => {
            const id = registerDrawSpell("test-hullbreacher-wire", 1);
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        library: [
                            makeInstance(bearsId, {
                                id: "p1-top",
                                ownerId: "p1",
                                zone: "library",
                            }),
                        ],
                    }),
                    makePlayer("p2", {
                        battlefield: [hullbreacherInstance("p2")],
                    }),
                ],
            });
            pushSpell(state, id, "p1");
            resolveTopOfStack(state);

            const projected = projectPublicState(state, 2, "p2");
            const treasures = projected.players[1].battlefield.filter((c) =>
                c.subtypes.includes("Treasure")
            );
            expect(treasures).toHaveLength(1);
        });
    });
});
