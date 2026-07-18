// RTR — green card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { worldspineWurm } from "../green";
import { grizzlyBears } from "../../lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import {
    removePermanentTo,
    discardToGraveyard,
    processPendingActionTriggers,
    resolveTopOfStack,
    moveCard,
    emitCardMilled,
    getPlayer,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

/** Drains the stack, resolving every pending item (including any
 *  `trigger-order` PendingChoice that lands a simultaneous batch — CR
 *  603.3b, ADR 0058). Used because Worldspine Wurm's death fires TWO
 *  distinct simultaneous triggers under the same controller (the token
 *  creation + the graveyard-from-anywhere shuffle), which the engine holds
 *  off-stack behind an ordering choice until submitted. */
function drainStack(state: ReturnType<typeof makeState>): void {
    let guard = 0;
    while (
        (state.stack.length > 0 || state.pendingChoices?.length) &&
        guard++ < 10
    ) {
        if (state.pendingChoices?.[0]?.kind === "trigger-order") {
            resolveTriggerOrder(state);
            continue;
        }
        if (state.stack.length === 0) break;
        resolveTopOfStack(state);
    }
}

describe("Worldspine Wurm (CR 702.19 trample, CR 603.2 dies-trigger, CR 400.7/701.24 graveyard-from-anywhere shuffle)", () => {
    it("definitional: 15/15 trample with two triggered abilities", () => {
        expect(worldspineWurm.manaCost).toEqual({ X: 8, G: 3 });
        expect(worldspineWurm.power).toBe(15);
        expect(worldspineWurm.toughness).toBe(15);
        expect(worldspineWurm.staticAbilities).toContain("trample");
        expect(worldspineWurm.triggeredAbilities).toHaveLength(2);
        const zones = worldspineWurm.triggeredAbilities!.map((a) => a.zone);
        // The token-creation dies-trigger is the plain battlefield scan (no
        // `zone`); the single "from anywhere" shuffle trigger opts into the
        // graveyard scan (CR 603.6e) and listens on all three zone-change
        // events via `event` + `events[]` (CR 603.2).
        expect(zones.filter((z) => z === "graveyard")).toHaveLength(1);
        expect(zones.filter((z) => z === undefined)).toHaveLength(1);
        const shuffle = worldspineWurm.triggeredAbilities!.find(
            (a) => a.zone === "graveyard"
        )!;
        expect(shuffle.event).toBe("CREATURE_DIED");
        expect(shuffle.events).toEqual(["CARD_DISCARDED", "CARD_MILLED"]);
    });

    describe("dies on the battlefield: both triggers fire off the SAME event", () => {
        function setup() {
            const wurm = makeInstance(worldspineWurm.id, {
                id: "wurm",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [wurm] }),
                    makePlayer("p2"),
                ],
            });
            return { state, wurm };
        }

        it("creates three 5/5 trample Wurm tokens AND shuffles itself into its owner's library", () => {
            const { state } = setup();
            removePermanentTo(state, "wurm", "graveyard");
            processPendingActionTriggers(state);
            drainStack(state);

            const p1 = state.players[0];
            const tokens = p1.battlefield.filter(
                (c) => c.isToken && c.id !== "wurm"
            );
            expect(tokens).toHaveLength(3);
            for (const token of tokens) {
                expect(token.power).toBe(5);
                expect(token.toughness).toBe(5);
                expect(token.staticAbilities).toContain("trample");
            }
            // The Wurm itself is neither on the battlefield nor in the
            // graveyard — it was shuffled into its owner's library.
            expect(p1.battlefield.some((c) => c.id === "wurm")).toBe(false);
            expect(p1.graveyard.some((c) => c.id === "wurm")).toBe(false);
            expect(p1.library.some((c) => c.id === "wurm")).toBe(true);
        });

        it("wire format: the created tokens survive projectPublicState", () => {
            const { state } = setup();
            removePermanentTo(state, "wurm", "graveyard");
            processPendingActionTriggers(state);
            drainStack(state);

            const projected = projectPublicState(state, 1, "p1");
            const tokens = projected.players[0].battlefield.filter(
                (c) => c.id !== "wurm"
            );
            expect(tokens).toHaveLength(3);
            for (const token of tokens) {
                expect(token.power).toBe(5);
                expect(token.toughness).toBe(5);
                expect(token.staticAbilities).toContain("trample");
            }
        });
    });

    it("discarded from hand: shuffles itself into its owner's library (no battlefield presence needed)", () => {
        const wurm = makeInstance(worldspineWurm.id, {
            id: "wurm",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const filler = makeInstance(grizzlyBears.id, {
            id: "filler",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [wurm, filler] }),
                makePlayer("p2"),
            ],
        });

        expect(discardToGraveyard(state, "p1", "wurm")).toBe(true);
        processPendingActionTriggers(state);
        drainStack(state);

        const p1 = state.players[0];
        expect(p1.hand.some((c) => c.id === "wurm")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "wurm")).toBe(false);
        expect(p1.library.some((c) => c.id === "wurm")).toBe(true);
        // No tokens created — the "dies" trigger only fires from the
        // battlefield (CR 603.2), and this card was never there.
        expect(p1.battlefield).toHaveLength(0);
    });

    it("milled from library: shuffles itself into its owner's library (CR 701.17)", () => {
        const wurm = makeInstance(worldspineWurm.id, {
            id: "wurm",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [makePlayer("p1", { library: [wurm] }), makePlayer("p2")],
        });

        const p1 = getPlayer(state, "p1");
        moveCard(p1, "wurm", "library", "graveyard");
        emitCardMilled(state, "p1", "wurm", worldspineWurm.id);
        processPendingActionTriggers(state);
        drainStack(state);

        expect(p1.graveyard.some((c) => c.id === "wurm")).toBe(false);
        expect(p1.library.some((c) => c.id === "wurm")).toBe(true);
        expect(p1.battlefield).toHaveLength(0);
    });
});
