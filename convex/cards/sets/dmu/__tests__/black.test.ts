// Per-card behavior tests for black cards in `convex/cards/sets/dmu/black.ts`
// (Dominaria United, split by colour per ADR 0043). Fixtures stay in
// `convex/cards/__tests__/setup.ts` — do not duplicate them here.

import { describe, it, expect } from "vitest";
import { sheoldredTheApocalypse } from "..";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    type GameState,
    emitCardDrawn,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";

// ---------------------------------------------------------------------------
// Sheoldred, the Apocalypse — {2}{B}{B} Legendary Creature — Phyrexian
// Praetor 4/5, deathtouch. "Whenever you draw a card, you gain 2 life.
// Whenever an opponent draws a card, they lose 2 life." (CR 121.1 draw event,
// CR 603.2 triggered ability). Both clauses are `drawTrigger`s keyed off the
// CARD_DRAWN event scoped relative to Sheoldred's controller: the "your"
// clause is an Effect Script (ADR 0045), the "opponents" clause stays
// imperative because it must act on the DRAWING player, not the controller
// (see the card-file comment in dmu/black.ts). Both halves need coverage —
// this describe block is that coverage.
// ---------------------------------------------------------------------------
describe("Sheoldred, the Apocalypse (CR 121.1 draw-triggered life swing)", () => {
    function makeSheoldred(
        controllerId: string
    ): ReturnType<typeof makeInstance> {
        return makeInstance(sheoldredTheApocalypse.id, {
            id: "sheol",
            controllerId,
            ownerId: controllerId,
        });
    }

    /** Simulates a real draw (library → hand) and runs it through the
     *  engine's real CARD_DRAWN choke point — `processPendingActionTriggers`
     *  — exactly like the turn-based draw / effect-driven draw paths do.
     *  This exercises `drawTrigger`'s scope-matching AND both resolution
     *  shapes (the `effects` DSL script and the imperative `resolve`)
     *  through `resolveTopOfStack`, never the closures directly. */
    function simulateDraw(state: GameState, drawingPlayerId: string) {
        const player = state.players.find((p) => p.id === drawingPlayerId)!;
        const drawn = player.library.shift();
        if (drawn) player.hand.push(drawn);
        state.pendingEvents = [
            {
                type: "CARD_DRAWN",
                playerId: drawingPlayerId,
                count: 1,
                isTurnBasedDrawStepDraw: false,
            },
        ];
        processPendingActionTriggers(state);
    }

    it("an opponent drawing a card makes that opponent lose 2 life (CR 121.1)", () => {
        const sheol = makeSheoldred("p1");
        const p1 = makePlayer("p1", { battlefield: [sheol], life: 20 });
        const p2 = makePlayer("p2", {
            library: [makeInstance(sheoldredTheApocalypse.id, { id: "lib-1" })],
            life: 20,
        });
        const state = makeState({ players: [p1, p2] });

        simulateDraw(state, "p2");

        expect(
            state.stack.some(
                (s) =>
                    s.triggeredAbilityId === "sheoldred-opponent-draw-lose-life"
            )
        ).toBe(true);
        resolveTopOfStack(state);

        expect(p2.life).toBe(18); // opponent (drawing player) lost 2 life
        expect(p1.life).toBe(20); // Sheoldred's controller is unaffected

        // Wire format — life totals are client-visible.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players.find((p) => p.id === "p2")!.life).toBe(18);
        expect(projected.players.find((p) => p.id === "p1")!.life).toBe(20);
    });

    it("you drawing a card makes you gain 2 life (CR 121.1)", () => {
        const sheol = makeSheoldred("p1");
        const p1 = makePlayer("p1", {
            battlefield: [sheol],
            library: [makeInstance(sheoldredTheApocalypse.id, { id: "lib-2" })],
            life: 20,
        });
        const p2 = makePlayer("p2", { life: 20 });
        const state = makeState({ players: [p1, p2] });

        simulateDraw(state, "p1");

        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "sheoldred-your-draw-gain-life"
            )
        ).toBe(true);
        resolveTopOfStack(state);

        expect(p1.life).toBe(22); // controller gained 2 life
        expect(p2.life).toBe(20); // opponent is unaffected

        // Wire format — life totals are client-visible.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players.find((p) => p.id === "p1")!.life).toBe(22);
        expect(projected.players.find((p) => p.id === "p2")!.life).toBe(20);
    });

    /** Batch draw through the REAL choke point: move `n` cards library → hand
     *  and call `emitCardDrawn(state, id, n)` exactly as `ctx.drawCards` /
     *  Griselbrand's "draw seven" does. Proves the per-card fanout — one
     *  CARD_DRAWN event PER card (CR 120.3), so a per-card trigger fires `n`
     *  times, not once. Unlike `simulateDraw`, this does NOT hand-build the
     *  event, so it would catch a regression to single-count-N emission. */
    function simulateBatchDraw(
        state: GameState,
        drawingPlayerId: string,
        n: number
    ) {
        const player = state.players.find((p) => p.id === drawingPlayerId)!;
        for (let i = 0; i < n; i++) {
            const drawn = player.library.shift();
            if (drawn) player.hand.push(drawn);
        }
        emitCardDrawn(state, drawingPlayerId, n, false);
        processPendingActionTriggers(state);
    }

    it("opponent draws 7 (Griselbrand): 7 lose-life triggers, opponent loses 14 (CR 120.3)", () => {
        const sheol = makeSheoldred("p1");
        const p1 = makePlayer("p1", { battlefield: [sheol], life: 20 });
        const p2 = makePlayer("p2", {
            library: Array.from({ length: 7 }, (_, i) =>
                makeInstance(sheoldredTheApocalypse.id, { id: `lib-${i}` })
            ),
            life: 20,
        });
        const state = makeState({ players: [p1, p2] });

        simulateBatchDraw(state, "p2", 7);

        // One trigger PER card drawn — not a single collapsed trigger.
        expect(
            state.stack.filter(
                (s) =>
                    s.triggeredAbilityId === "sheoldred-opponent-draw-lose-life"
            )
        ).toHaveLength(7);

        while (state.stack.length > 0) resolveTopOfStack(state);

        expect(p2.life).toBe(6); // 20 − 7×2
        expect(p1.life).toBe(20);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players.find((p) => p.id === "p2")!.life).toBe(6);
    });

    it("you draw 7 (Griselbrand): 7 gain-life triggers, you gain 14 (CR 120.3)", () => {
        const sheol = makeSheoldred("p1");
        const p1 = makePlayer("p1", {
            battlefield: [sheol],
            library: Array.from({ length: 7 }, (_, i) =>
                makeInstance(sheoldredTheApocalypse.id, { id: `lib-${i}` })
            ),
            life: 20,
        });
        const p2 = makePlayer("p2", { life: 20 });
        const state = makeState({ players: [p1, p2] });

        simulateBatchDraw(state, "p1", 7);

        expect(
            state.stack.filter(
                (s) => s.triggeredAbilityId === "sheoldred-your-draw-gain-life"
            )
        ).toHaveLength(7);

        while (state.stack.length > 0) resolveTopOfStack(state);

        expect(p1.life).toBe(34); // 20 + 7×2
        expect(p2.life).toBe(20);
    });

    it("does not cross-fire: your draw never drains the opponent, their draw never gains you life", () => {
        const sheol = makeSheoldred("p1");
        const p1 = makePlayer("p1", {
            battlefield: [sheol],
            library: [makeInstance(sheoldredTheApocalypse.id, { id: "lib-3" })],
            life: 20,
        });
        const p2 = makePlayer("p2", {
            library: [makeInstance(sheoldredTheApocalypse.id, { id: "lib-4" })],
            life: 20,
        });
        const state = makeState({ players: [p1, p2] });

        // Your own draw: only the gain-life clause may fire.
        simulateDraw(state, "p1");
        expect(
            state.stack.some(
                (s) =>
                    s.triggeredAbilityId === "sheoldred-opponent-draw-lose-life"
            )
        ).toBe(false);
        resolveTopOfStack(state);
        expect(p1.life).toBe(22);
        expect(p2.life).toBe(20);

        // Opponent's draw: only the lose-life clause may fire.
        simulateDraw(state, "p2");
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "sheoldred-your-draw-gain-life"
            )
        ).toBe(false);
        resolveTopOfStack(state);
        expect(p1.life).toBe(22); // unchanged by the opponent's draw
        expect(p2.life).toBe(18);
    });
});
