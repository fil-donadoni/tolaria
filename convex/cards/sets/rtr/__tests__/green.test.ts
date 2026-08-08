// RTR — green card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { worldspineWurm } from "../green";
import { grizzlyBears } from "../../lea/green";
import { malevolentRumble } from "../../mh3/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
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

    // The RESIDUAL graveyard entry (CR 603.6 / 603.2): "reveal the top four
    // cards … put the rest into your graveyard" (Malevolent Rumble, mh3/green.ts)
    // is NOT a mill (CR 701.17a), so it emits no CARD_MILLED — and before
    // CARD_PUT_INTO_GRAVEYARD existed nothing else either, so a Wurm binned that
    // way just sat in the graveyard and "from anywhere" quietly meant "from
    // three specific places". Driven through the REAL card end to end (cast →
    // resolve → answer the dig pick) rather than by hand-emitting an event, so
    // the whole chain is under test: `digToHand` → `bottomLookedAtCards` →
    // `moveCardById` → the event → the graveyard trigger scan.
    it("binned by a 'put the rest into your graveyard' dig: shuffles itself back (CR 603.6)", () => {
        const wurm = makeInstance(worldspineWurm.id, {
            id: "wurm",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const keeper = makeInstance(grizzlyBears.id, {
            id: "keeper",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [keeper, wurm] }),
                makePlayer("p2"),
            ],
        });

        pushSpell(state, malevolentRumble.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the dig pick
        const head = state.pendingChoices![0];
        expect(head.destination).toBe("graveyard");
        // Keep the Bears; the Wurm is one of "the rest" and heads for the bin.
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["keeper"],
        });

        processPendingActionTriggers(state);
        drainStack(state);

        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toContain("keeper");
        // The replacement-style shuffle fired: the Wurm is back in the library,
        // not left in the graveyard.
        expect(p1.graveyard.some((c) => c.id === "wurm")).toBe(false);
        expect(p1.library.some((c) => c.id === "wurm")).toBe(true);
        // Never on the battlefield, so no Wurm tokens (CR 603.2).
        expect(p1.battlefield.filter((c) => c.isToken === true)).toHaveLength(
            1 // the Eldrazi Spawn Malevolent Rumble itself makes
        );
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
