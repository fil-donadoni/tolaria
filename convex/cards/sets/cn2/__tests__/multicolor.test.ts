// CN2 — multicolor card behavior tests. Leovold, Emissary of Trest rides the
// unified draw-replacement seam (CR 614 / 616.1, ADR 0061) for its "can't draw
// more than one card each turn" clause and the BECAME_TARGET trigger foundation
// (CR 603.2b, issue #1265) for its "becomes the target" draw.

import { describe, it, expect } from "vitest";
import type { EffectOp, GameEvent } from "../../../types";
import { leovoldEmissaryOfTrest } from "../multicolor";
import { registerTokenDefinition, getCardByName } from "../../../index";
import {
    buildDrawEvent,
    emitBecameTargetEvents,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

const bearsId = getCardByName("Balduvian Bears").id;

function leovoldInstance(controllerId: string, id = "leo") {
    return makeInstance(leovoldEmissaryOfTrest.id, {
        id,
        controllerId,
        ownerId: controllerId,
    });
}

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

function libCard(id: string, owner: string) {
    return makeInstance(bearsId, { id, ownerId: owner, zone: "library" });
}

describe("Leovold, Emissary of Trest (CR 614 / 603.2b, ADR 0061 — issue #1265)", () => {
    it("has the right cost / type / P-T (Scryfall)", () => {
        expect(leovoldEmissaryOfTrest.manaCost).toEqual({ B: 1, G: 1, U: 1 });
        expect(leovoldEmissaryOfTrest.types).toEqual(["Creature"]);
        expect(leovoldEmissaryOfTrest.supertypes).toEqual(["Legendary"]);
        expect(leovoldEmissaryOfTrest.subtypes).toEqual(["Elf", "Advisor"]);
        expect(leovoldEmissaryOfTrest.power).toBe(3);
        expect(leovoldEmissaryOfTrest.toughness).toBe(3);
    });

    // --- Clause 1: "Each opponent can't draw more than one card each turn." ---
    describe("draw-replacement scope (CR 614 — prevent 2nd+ opponent draw)", () => {
        const draw = leovoldEmissaryOfTrest.drawReplacement!;
        const source = { controllerId: "p2" } as never;

        it("prevents an opponent's SECOND draw this turn (drawIndex >= 1)", () => {
            const state = makeState({
                players: [
                    makePlayer("p1", { drawnThisTurn: ["a"] }),
                    makePlayer("p2"),
                ],
            });
            const event = buildDrawEvent(state, "p1", 1, false);
            expect(event.drawIndexThisTurn).toBe(1);
            expect(draw.applies(event, source, state as never)).toBe(true);
        });

        it("does NOT prevent an opponent's FIRST draw (incl. draw-step)", () => {
            const state = makeState();
            const first = buildDrawEvent(state, "p1", 1, false);
            expect(first.drawIndexThisTurn).toBe(0);
            expect(draw.applies(first, source, state as never)).toBe(false);
            const drawStep = buildDrawEvent(state, "p1", 1, true);
            expect(draw.applies(drawStep, source, state as never)).toBe(false);
        });

        it("does NOT prevent the controller's own draws", () => {
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { drawnThisTurn: ["a", "b"] }),
                ],
            });
            const event = buildDrawEvent(state, "p2", 1, false);
            expect(draw.applies(event, source, state as never)).toBe(false);
        });

        it("outcome is `prevent`", () => {
            expect(draw.outcome).toEqual({ kind: "prevent" });
        });
    });

    describe("prevent e2e — opponent's 2nd effect draw is prevented", () => {
        it("draws nothing and triggers no draw-from-empty loss", () => {
            const id = registerDrawSpell("test-leovold-prevent", 1);
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        drawnThisTurn: ["already"],
                        library: [libCard("p1-top", "p1")],
                    }),
                    makePlayer("p2", { battlefield: [leovoldInstance("p2")] }),
                ],
            });
            pushSpell(state, id, "p1");
            resolveTopOfStack(state);
            expect(state.players[0].hand).toHaveLength(0);
            expect(state.players[0].library).toHaveLength(1);
            expect(state.players[0].hasDrawnFromEmpty).toBeFalsy();
        });

        it("an opponent's FIRST effect draw of the turn is unaffected", () => {
            const id = registerDrawSpell("test-leovold-first", 1);
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        drawnThisTurn: [],
                        library: [libCard("p1-top", "p1")],
                    }),
                    makePlayer("p2", { battlefield: [leovoldInstance("p2")] }),
                ],
            });
            pushSpell(state, id, "p1");
            resolveTopOfStack(state);
            expect(state.players[0].hand.map((c) => c.id)).toContain("p1-top");
        });
    });

    // --- Clause 2: BECAME_TARGET trigger (CR 603.2b) ---
    describe("becomes-the-target trigger (CR 603.2b)", () => {
        const trig = leovoldEmissaryOfTrest.triggeredAbilities![0];
        const self = {
            id: "leo",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Creature"],
            subtypes: ["Elf", "Advisor"],
            isTapped: false,
            card: {},
        } as never;

        const targetedByOpponent: GameEvent = {
            type: "BECAME_TARGET",
            target: { type: "permanent", id: "leo" },
            targetControllerId: "p2",
            sourceControllerId: "p1",
            sourceInstanceId: "opponent-spell-1",
        };

        it("matches when a permanent you control is targeted by an opponent", () => {
            expect(trig.matches(targetedByOpponent, self)).toBe(true);
        });

        it("matches when YOU (the player) are targeted by an opponent", () => {
            expect(
                trig.matches(
                    {
                        type: "BECAME_TARGET",
                        target: { type: "player", id: "p2" },
                        targetControllerId: "p2",
                        sourceControllerId: "p1",
                        sourceInstanceId: "opponent-spell-1",
                    },
                    self
                )
            ).toBe(true);
        });

        it("does NOT match your OWN spell/ability targeting your object", () => {
            expect(
                trig.matches(
                    { ...targetedByOpponent, sourceControllerId: "p2" },
                    self
                )
            ).toBe(false);
        });

        it("does NOT match an opponent's object being targeted", () => {
            expect(
                trig.matches(
                    { ...targetedByOpponent, targetControllerId: "p1" },
                    self
                )
            ).toBe(false);
        });

        it("collapses one spell targeting several of your objects to ONE trigger", () => {
            expect(trig.oncePerEventBatch).toBe(true);
        });
    });

    describe("becomes-the-target e2e — opponent target lets you may-draw", () => {
        function stateTargetedByOpponent() {
            return makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", {
                        battlefield: [leovoldInstance("p2")],
                        library: [libCard("p2-top", "p2")],
                    }),
                ],
            });
        }

        it("accepting the may-pay draws a card", () => {
            const state = stateTargetedByOpponent();
            // An opponent (p1) spell/ability targets Leovold (a permanent p2
            // controls) — the BECAME_TARGET emission choke.
            emitBecameTargetEvents(
                state,
                [{ type: "permanent", id: "leo" }],
                "p1",
                "opponent-spell-1"
            );
            processPendingActionTriggers(state);
            // Leovold's trigger resolves and raises the optional draw.
            resolveTopOfStack(state);
            expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
            expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
            applyMayPaySubmit(state, { playerId: "p2", accept: true });
            expect(state.players[1].hand.map((c) => c.id)).toContain("p2-top");
        });

        it("declining the may-pay draws nothing", () => {
            const state = stateTargetedByOpponent();
            emitBecameTargetEvents(
                state,
                [{ type: "permanent", id: "leo" }],
                "p1",
                "opponent-spell-1"
            );
            processPendingActionTriggers(state);
            resolveTopOfStack(state);
            applyMayPaySubmit(state, { playerId: "p2", accept: false });
            expect(state.players[1].hand).toHaveLength(0);
        });

        it("your OWN spell targeting your permanent does not trigger it", () => {
            const state = stateTargetedByOpponent();
            emitBecameTargetEvents(
                state,
                [{ type: "permanent", id: "leo" }],
                "p2",
                "opponent-spell-1"
            );
            processPendingActionTriggers(state);
            expect(state.stack).toHaveLength(0);
            expect(state.pendingChoices ?? []).toHaveLength(0);
        });
    });

    describe("wire format (S5) — the may-draw choice survives projection", () => {
        it("the may-pay pending choice crosses projectPublicState", () => {
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", {
                        battlefield: [leovoldInstance("p2")],
                        library: [libCard("p2-top", "p2")],
                    }),
                ],
            });
            emitBecameTargetEvents(
                state,
                [{ type: "permanent", id: "leo" }],
                "p1",
                "opponent-spell-1"
            );
            processPendingActionTriggers(state);
            resolveTopOfStack(state);
            const projected = projectPublicState(state, 2, "p2");
            expect(projected.pendingChoices?.[0]?.kind).toBe("may-pay");
            expect(projected.pendingChoices?.[0]?.playerId).toBe("p2");
        });
    });
});
