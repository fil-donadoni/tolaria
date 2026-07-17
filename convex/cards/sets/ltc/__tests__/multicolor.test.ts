// LTC (Tales of Middle-earth Commander) — multicolor card behavior tests
// (ADR 0043 colour split).
import { describe, it, expect } from "vitest";
import { forthEorlingas } from "../multicolor";
import { makePlayer, makeState, pushSpell } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyAllCombatDamage } from "../../../../gre/phases";
import type { GameState } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

describe("Forth Eorlingas! — X tokens + delayed monarch grab (CR 720.2, issue #1199)", () => {
    it("is registered with the modern Oracle text (LTC, not the paraphrased LTR text)", () => {
        expect(forthEorlingas.manaCost).toEqual({ X: "X", R: 1, W: 1 });
        expect(forthEorlingas.types).toEqual(["Sorcery"]);
        expect(forthEorlingas.oracleText).toBe(
            "Create X 2/2 red Human Knight creature tokens with trample and haste.\nWhenever one or more creatures you control deal combat damage to one or more players this turn, you become the monarch."
        );
        expect(forthEorlingas.resolve).toBeUndefined();
        expect(forthEorlingas.effects).toBeDefined();
    });

    it("creates X 2/2 red Human Knight tokens with trample and haste", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, forthEorlingas.id, "p1");
        item.chosenX = 3;
        resolveTopOfStack(state);

        const tokens = state.players[0].battlefield;
        expect(tokens).toHaveLength(3);
        for (const t of tokens) {
            expect(t.types).toEqual(["Creature"]);
            expect(t.subtypes).toEqual(["Human", "Knight"]);
            expect(t.power).toBe(2);
            expect(t.toughness).toBe(2);
            expect(t.staticAbilities).toEqual(
                expect.arrayContaining(["trample", "haste"])
            );
            expect(t.isToken).toBe(true);
        }
    });

    it("X=0 creates no tokens (CR 707.1) but still schedules the monarch-grab watch", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, forthEorlingas.id, "p1");
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(
            state.delayedTriggers?.some(
                (t) =>
                    t.timing ===
                    "this-turn-creature-deals-combat-damage-to-player"
            )
        ).toBe(true);
    });

    it("becomes the monarch once a created token deals combat damage to a player", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, forthEorlingas.id, "p1");
        item.chosenX = 1;
        resolveTopOfStack(state);
        const token = state.players[0].battlefield[0];
        expect(state.monarchId).toBeUndefined();

        // Tokens have haste, so they can attack the turn they're created.
        state.phase = "COMBAT_DAMAGE";
        state.activePlayerId = "p1";
        state.combat = {
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
            damageConfirmed: false,
            attackerIds: [token.id],
        } as GameState["combat"];

        applyAllCombatDamage(state, {});
        while (
            state.stack.some(
                (s) =>
                    s.delayedTriggerId !== undefined &&
                    s.triggerEvent?.type === "DAMAGE_DEALT"
            )
        ) {
            resolveTopOfStack(state);
        }

        expect(state.monarchId).toBe("p1");
        expect(state.players[1].life).toBe(18);
    });

    it("the Monarch designation survives the wire projection (issue #1199)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, forthEorlingas.id, "p1");
        item.chosenX = 1;
        resolveTopOfStack(state);
        const token = state.players[0].battlefield[0];
        state.phase = "COMBAT_DAMAGE";
        state.activePlayerId = "p1";
        state.combat = {
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
            damageConfirmed: false,
            attackerIds: [token.id],
        } as GameState["combat"];
        applyAllCombatDamage(state, {});
        while (
            state.stack.some(
                (s) =>
                    s.delayedTriggerId !== undefined &&
                    s.triggerEvent?.type === "DAMAGE_DEALT"
            )
        ) {
            resolveTopOfStack(state);
        }

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.monarchId).toBe("p1");
    });
});
