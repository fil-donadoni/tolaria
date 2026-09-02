// Per-card behavior tests for green cards in `convex/cards/sets/exo/green.ts`
// (Exodus, split by colour per ADR 0043). Fixtures from
// `convex/cards/__tests__/setup.ts`.

import { describe, it, expect } from "vitest";
import { oathOfDruids } from "../green";
import { grizzlyBears, forest } from "../../lea";
import type { GameState, StackItem } from "../../../../gre/state";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

// Oath of Druids — "At the beginning of each player's upkeep, that player
// chooses target player who controls more creatures than they do and is their
// opponent. The first player may reveal cards from the top of their library
// until they reveal a creature card. If the first player does, that player
// puts that card onto the battlefield and all other cards revealed this way
// into their graveyard." (issue #2707.)
//
// Two general pieces are under test through this card: the comparative
// player-target predicate `playerControlsMoreThan` (CR 601.2c, announcement
// gate + the CR 608.2b resolution re-check) and the `revealUntilMatch` Op
// (CR 701.20a). The Op's own branches live in the interpreter suite; what
// only THIS file can prove is that the trigger's announcement, its scoped
// player and its body agree with each other.
describe("Oath of Druids (CR 603.6a each-player upkeep + CR 603.3d targeting + CR 701.20a reveal-until)", () => {
    const libraryOf = (owner: string, entries: [string, string][]) =>
        entries.map(([id, defId]) =>
            makeInstance(defId, {
                id,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    const creaturesFor = (owner: string, n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `${owner}-bear-${i}`,
                controllerId: owner,
                ownerId: owner,
            })
        );

    /** Builds the board: Oath under p1's control, `p1Creatures` / `p2Creatures`
     *  bears, and the named libraries. `activePlayerId` is whose upkeep it is. */
    function board(opts: {
        activePlayerId: string;
        p1Creatures?: number;
        p2Creatures?: number;
        p1Library?: [string, string][];
        p2Library?: [string, string][];
    }): { state: GameState; oath: ReturnType<typeof makeInstance> } {
        const oath = makeInstance(oathOfDruids.id, {
            id: "oath",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: opts.activePlayerId,
            priorityPlayerId: opts.activePlayerId,
            phase: "UPKEEP",
            players: [
                makePlayer("p1", {
                    battlefield: [
                        oath,
                        ...creaturesFor("p1", opts.p1Creatures ?? 0),
                    ],
                    library: libraryOf("p1", opts.p1Library ?? []),
                }),
                makePlayer("p2", {
                    battlefield: creaturesFor("p2", opts.p2Creatures ?? 0),
                    library: libraryOf("p2", opts.p2Library ?? []),
                }),
            ],
        });
        return { state, oath };
    }

    /** Pushes Oath's upkeep trigger onto the stack as if it had fired on
     *  `activePlayerId`'s upkeep, with the target slot deliberately UNSET so
     *  `raiseTriggerTargetSelection` runs the real CR 603.3d announcement. */
    function announceUpkeepTrigger(
        state: GameState,
        oath: ReturnType<typeof makeInstance>,
        activePlayerId: string
    ): StackItem {
        const item: StackItem = {
            ...oath,
            zone: "stack",
            castById: oath.controllerId,
            triggeredAbilityId: "oath-of-druids-upkeep",
            triggerSourceId: oath.id,
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId,
            },
            targets: undefined,
        };
        state.stack.push(item);
        raiseTriggerTargetSelection(state);
        return item;
    }

    it("CR 603.3d — no legal target (the opponent does NOT control more creatures): the trigger is removed from the stack", () => {
        // p1's upkeep; p2 has FEWER creatures, so there is nobody who
        // "controls more creatures than they do and is their opponent".
        const { state, oath } = board({
            activePlayerId: "p1",
            p1Creatures: 2,
            p2Creatures: 1,
        });
        announceUpkeepTrigger(state, oath, "p1");
        expect(state.stack).toHaveLength(0);
        expect(state.pendingTarget).toBeUndefined();
    });

    it("CR 603.3d — a TIE is not 'more': the trigger is still removed", () => {
        const { state, oath } = board({
            activePlayerId: "p1",
            p1Creatures: 1,
            p2Creatures: 1,
        });
        announceUpkeepTrigger(state, oath, "p1");
        expect(state.stack).toHaveLength(0);
    });

    it("a legal target auto-selects (the sole candidate) — no PendingTarget is raised", () => {
        const { state, oath } = board({
            activePlayerId: "p1",
            p1Creatures: 0,
            p2Creatures: 2,
        });
        const item = announceUpkeepTrigger(state, oath, "p1");
        expect(state.stack).toHaveLength(1);
        expect(state.pendingTarget).toBeUndefined();
        expect(item.targets).toEqual([{ type: "player", id: "p2" }]);
    });

    it("resolves: the upkeep player reveals until a creature card, puts it onto the battlefield and the rest into their graveyard", () => {
        const { state, oath } = board({
            activePlayerId: "p1",
            p1Creatures: 0,
            p2Creatures: 2,
            p1Library: [
                ["land-1", forest.id],
                ["land-2", forest.id],
                ["fatty", grizzlyBears.id],
                ["below", grizzlyBears.id],
            ],
        });
        announceUpkeepTrigger(state, oath, "p1");
        resolveTopOfStack(state);
        // "may" — the upkeep player is offered the decision and nothing has
        // moved yet.
        expect((state.pendingChoices ?? []).length).toBeGreaterThan(0);
        expect(state.players[0].library).toHaveLength(4);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "fatty"
        );
        const graveyard = state.players[0].graveyard.map((c) => c.id);
        expect(graveyard).toContain("land-1");
        expect(graveyard).toContain("land-2");
        // The card BELOW the creature was never revealed.
        expect(state.players[0].library.map((c) => c.id)).toEqual(["below"]);
    });

    it("the 'may' is real — declining leaves the library untouched", () => {
        const { state, oath } = board({
            activePlayerId: "p1",
            p1Creatures: 0,
            p2Creatures: 2,
            p1Library: [
                ["land-1", forest.id],
                ["fatty", grizzlyBears.id],
            ],
        });
        announceUpkeepTrigger(state, oath, "p1");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "fatty"
        );
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "land-1",
            "fatty",
        ]);
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("is symmetric — on the OPPONENT's upkeep it is the opponent who digs, off THEIR library", () => {
        // p2's upkeep. p1 (Oath's controller) holds the bigger board, so p1 is
        // the legal target and p2 is "the first player" who reveals. Nothing
        // here reads the enchantment's controller.
        const { state, oath } = board({
            activePlayerId: "p2",
            p1Creatures: 3,
            p2Creatures: 0,
            p1Library: [["mine", grizzlyBears.id]],
            p2Library: [
                ["their-land", forest.id],
                ["their-fatty", grizzlyBears.id],
            ],
        });
        const item = announceUpkeepTrigger(state, oath, "p2");
        expect(item.targets).toEqual([{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.players[1].battlefield.map((c) => c.id)).toContain(
            "their-fatty"
        );
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "their-land"
        );
        // p1's own library is untouched — the dig is the SCOPED player's.
        expect(state.players[0].library.map((c) => c.id)).toEqual(["mine"]);
    });

    it("CR 608.2b — the count is part of the targeting requirement: an opponent who loses creatures in response fizzles the trigger", () => {
        // The printed ruling: "the ability doesn't resolve if it's no longer
        // true at that time".
        const { state, oath } = board({
            activePlayerId: "p1",
            p1Creatures: 0,
            p2Creatures: 2,
            p1Library: [["fatty", grizzlyBears.id]],
        });
        announceUpkeepTrigger(state, oath, "p1");
        // …p2's creatures leave in response.
        state.players[1].battlefield = [];
        resolveTopOfStack(state);
        // No may-pay was ever offered and nothing moved: the trigger fizzled.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["fatty"]);
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "fatty"
        );
    });

    it("no creature card left in the library: the whole library is revealed and milled (why the clause is a 'may')", () => {
        const { state, oath } = board({
            activePlayerId: "p1",
            p1Creatures: 0,
            p2Creatures: 1,
            p1Library: [
                ["land-1", forest.id],
                ["land-2", forest.id],
            ],
        });
        announceUpkeepTrigger(state, oath, "p1");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].library).toHaveLength(0);
        const graveyard = state.players[0].graveyard.map((c) => c.id);
        expect(graveyard).toContain("land-1");
        expect(graveyard).toContain("land-2");
    });

    it("WIRE FORMAT — the revealed cards and the arriving creature are visible to BOTH seats in the projection (CR 701.20a)", () => {
        const { state, oath } = board({
            activePlayerId: "p1",
            p1Creatures: 0,
            p2Creatures: 2,
            p1Library: [
                ["land-1", forest.id],
                ["fatty", grizzlyBears.id],
            ],
        });
        announceUpkeepTrigger(state, oath, "p1");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        for (const viewer of ["p1", "p2"] as const) {
            const view = projectPublicState(state, 1, viewer);
            const arrived = view.players[0].battlefield.find(
                (c) => c.id === "fatty"
            );
            expect(
                arrived,
                `battlefield creature, viewer ${viewer}`
            ).toBeDefined();
            expect(arrived!.card.id).toBe(grizzlyBears.id);
            const milled = view.players[0].graveyard.find(
                (c) => c.id === "land-1"
            );
            expect(milled, `revealed land, viewer ${viewer}`).toBeDefined();
            expect(milled!.card.id).toBe(forest.id);
        }
    });
});
