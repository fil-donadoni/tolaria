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
import {
    buildDrawEvent,
    getPlayer,
    resolveTopOfStack,
} from "../../../../gre/state";
import { tapSourceIntoPayment } from "../../../../game";
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
    });

    describe("opponent effect draw → Treasure, opponent draws nothing", () => {
        function stateWithHullbreacher(
            spellId: string
        ): ReturnType<typeof makeState> {
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
            const def = getDefinition((treasures[0].card as { id: string }).id);
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

    describe("Treasure mana ability activated e2e (issue #778 — sacrifice for any color)", () => {
        it("activating the redirected Treasure adds the chosen color and sacrifices it", () => {
            // Redirect an opponent's effect draw into a Treasure for p2, exactly
            // as the golden path above, then ACTIVATE the token's synthesized
            // "{T}, Sacrifice: Add one mana of any color" ability through the
            // real production entry point (`tapSourceIntoPayment` — the same path
            // Black Lotus's mana ability drives, CR 605.1a / 707.2).
            const id = registerDrawSpell(
                "test-hullbreacher-treasure-activate",
                1
            );
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

            const p2 = getPlayer(state, "p2");
            const treasure = p2.battlefield.find((c) =>
                c.subtypes.includes("Treasure")
            );
            expect(treasure).toBeDefined();

            // Choose option index 2 → {B} (manaChoices [{W},{U},{B},{R},{G}]).
            tapSourceIntoPayment(state, p2, treasure!, 2, []);

            // The chosen color is added; no other color leaked into the pool.
            expect(p2.manaPool.B).toBe(1);
            expect(p2.manaPool.W).toBe(0);
            expect(p2.manaPool.U).toBe(0);
            // CR 707.2 — the Treasure was sacrificed: it has left the battlefield.
            expect(p2.battlefield.some((c) => c.id === treasure!.id)).toBe(
                false
            );
        });

        it("a different color pick is honored (index 4 → {G})", () => {
            const id = registerDrawSpell("test-hullbreacher-treasure-green", 1);
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

            const p2 = getPlayer(state, "p2");
            const treasure = p2.battlefield.find((c) =>
                c.subtypes.includes("Treasure")
            )!;
            tapSourceIntoPayment(state, p2, treasure, 4, []);
            expect(p2.manaPool.G).toBe(1);
            expect(p2.battlefield.some((c) => c.id === treasure.id)).toBe(
                false
            );
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
