// Per-card tests for mh2/green.ts.
//
// Endurance's ETB uses the `choose-player` requestChoice kind (CR 115.1a — a
// trigger-time "up to one target player") plus the `putGraveyardOnBottomOfLibrary`
// primitive. Both are new engine surface introduced with this card (#1207), so
// per `.claude/rules/gre-development.md` it earns a hand-written test at the GRE
// resolution path, the real submit path, and the wire projection.
import { describe, it, expect } from "vitest";
import { endurance } from "../green";
import { swamp, forest, grizzlyBears } from "../../lea";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";

// Put Endurance on p1's battlefield, fire its ETB, and resolve the trigger so a
// `choose-player` choice is owed to p1. `p2`'s graveyard holds `gyCount` cards
// and library holds `libCount` cards; returns the state + the owed choice.
function setupEndurance(opts: { gyCount: number; libCount: number }): {
    state: GameState;
} {
    const end = makeInstance(endurance.id, {
        id: "end1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const p2Graveyard = Array.from({ length: opts.gyCount }, (_, i) =>
        makeInstance(i % 2 === 0 ? swamp.id : grizzlyBears.id, {
            id: `p2-gy-${i}`,
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        })
    );
    const p2Library = Array.from({ length: opts.libCount }, (_, i) =>
        makeInstance(forest.id, {
            id: `p2-lib-${i}`,
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [end] }),
            makePlayer("p2", { graveyard: p2Graveyard, library: p2Library }),
        ],
    });
    const triggers = collectTriggers(state, [
        {
            type: "PERMANENT_ENTERED",
            instanceId: "end1",
            controllerId: "p1",
            cardId: endurance.id,
            types: ["Creature"],
        },
    ]);
    // Isolate the ETB from the (dormant, non-evoked) evoke-sacrifice trigger.
    const etb = triggers.find((t) => t.triggeredAbilityId === "endurance-etb");
    expect(etb).toBeDefined();
    state.stack.push(etb!);
    expect(resolveTopOfStack(state)).toBeNull();
    return { state };
}

describe("Endurance (CR 115.1a trigger-time player target; #1207)", () => {
    it("pins the definition: flash + reach, evoke a green card, 3/4", () => {
        expect(endurance.power).toBe(3);
        expect(endurance.toughness).toBe(4);
        expect(endurance.staticAbilities).toEqual(["flash", "reach"]);
        expect(endurance.evoke?.handCost).toEqual({
            action: "exile",
            requirements: [{ filter: { color: "G" }, count: 1 }],
        });
    });

    it("owes a `choose-player` choice to the controller, every player a candidate", () => {
        const { state } = setupEndurance({ gyCount: 3, libCount: 2 });
        const head = state.pendingChoices?.[0];
        expect(head).toBeDefined();
        expect(head!.kind).toBe("choose-player");
        expect(head!.playerId).toBe("p1");
        expect(head!.candidatePlayerIds).toEqual(["p1", "p2"]);
        // "Up to one" — a zero pick is legal.
        expect(head!.count).toEqual({ min: 0, max: 1 });
    });

    it("chosen player's graveyard goes to the BOTTOM of their library; top order preserved", () => {
        const { state } = setupEndurance({ gyCount: 3, libCount: 2 });
        const head = state.pendingChoices![0];
        const gyIds = state.players[1].graveyard.map((c) => c.id);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p2"],
        });
        const p2 = state.players[1];
        expect(p2.graveyard).toEqual([]);
        expect(p2.library).toHaveLength(5);
        // The pre-existing top two library cards keep their positions.
        expect(p2.library.slice(0, 2).map((c) => c.id)).toEqual([
            "p2-lib-0",
            "p2-lib-1",
        ]);
        // The three graveyard cards now occupy the bottom (as a set — the order
        // among them is a seeded shuffle).
        expect(new Set(p2.library.slice(2).map((c) => c.id))).toEqual(
            new Set(gyIds)
        );
        expect(state.pendingChoices ?? []).toEqual([]);
    });

    it("choosing no player (empty submission) is a no-op", () => {
        const { state } = setupEndurance({ gyCount: 3, libCount: 2 });
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        expect(state.players[1].graveyard).toHaveLength(3);
        expect(state.players[1].library).toHaveLength(2);
        expect(state.pendingChoices ?? []).toEqual([]);
    });

    it("the controller may target their OWN graveyard", () => {
        // p1 (Endurance's controller) with a graveyard of its own.
        const end = makeInstance(endurance.id, {
            id: "end1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const gy = [
            makeInstance(swamp.id, {
                id: "p1-gy-0",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [end], graveyard: gy }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "end1",
                controllerId: "p1",
                cardId: endurance.id,
                types: ["Creature"],
            },
        ]);
        const etb = triggers.find(
            (t) => t.triggeredAbilityId === "endurance-etb"
        )!;
        state.stack.push(etb);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p1"],
        });
        expect(state.players[0].graveyard).toEqual([]);
        expect(state.players[0].library.map((c) => c.id)).toContain("p1-gy-0");
    });

    it("rejects an illegal player id", () => {
        const { state } = setupEndurance({ gyCount: 1, libCount: 1 });
        const head = state.pendingChoices![0];
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["not-a-player"],
            })
        ).toThrow(/legal player/);
    });

    it("wire format — the bottomed graveyard survives the public projection", () => {
        const { state } = setupEndurance({ gyCount: 3, libCount: 2 });
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p2"],
        });
        // Project for p1 viewing (p2 is the opponent). The opponent's library is
        // slimmed to a count and the graveyard is public — both must reflect the
        // move.
        const projected = projectPublicState(state, 1, "p1");
        const p2 = projected.players[1];
        expect(p2.graveyard).toHaveLength(0);
        expect(p2.library.count).toBe(5);
    });
});
