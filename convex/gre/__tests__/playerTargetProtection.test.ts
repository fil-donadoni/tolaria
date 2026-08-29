// Player-target legality for abilities whose Oracle text names a player
// target (CR 601.2c / 603.3d), issue #2801.
//
// The reported bug: The One Ring's "you gain protection from everything until
// your next turn" did not stop an opponent's "target opponent discards a card"
// trigger. The cause was never the protection predicate — it was that the
// abilities in question declared no target at all, so they never reached the
// one branch that reads it. These tests drive the REAL announcement path
// (`raiseTriggerTargetSelection`, the same function `pendingChoiceSubmit` and
// `pendingTargetOrigin` call) rather than hand-building a targeted stack item,
// because a hand-built item is exactly what hid the bug: it sets `targets`
// itself and never asks the engine whether the target was legal.
import { describe, it, expect } from "vitest";
import { ravenousRats } from "../../cards/sets/p02/black";
import { archonOfCruelty } from "../../cards/sets/mh2/black";
import { solitaryConfinement } from "../../cards/sets/jud/white";
import { sheoldredTheApocalypse } from "../../cards/sets/dmu/black";
import { grizzlyBears } from "../../cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { raiseTriggerTargetSelection } from "../rules";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";
import { projectPublicState } from "../../gameProjections";

/** Puts a card's triggered ability on the stack the way the engine does, then
 *  runs the REAL CR 603.3d announcement sweep over it. Returns whether the
 *  sweep suspended for a controller choice; the caller inspects
 *  `state.stack` / `state.pendingTarget` for the outcome. */
function announceTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
): boolean {
    const trig: StackItem = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets: undefined,
    };
    state.stack.push(trig);
    return raiseTriggerTargetSelection(state);
}

const etbEvent = (source: CardInstanceState): StackItem["triggerEvent"] =>
    ({
        type: "PERMANENT_ENTERED",
        instanceId: source.id,
        controllerId: source.controllerId,
        types: ["Creature"],
    }) as StackItem["triggerEvent"];

/** p1 controls the named source; p2 holds two cards. */
function twoSeatBoard(
    sourceCardId: string,
    sourceInstanceId: string,
    overrides: Partial<GameState> = {}
) {
    const source = makeInstance(sourceCardId, {
        id: sourceInstanceId,
        controllerId: "p1",
        ownerId: "p1",
    });
    const h1 = makeInstance(grizzlyBears.id, {
        id: "h1",
        controllerId: "p2",
        ownerId: "p2",
        zone: "hand",
    });
    const h2 = makeInstance(grizzlyBears.id, {
        id: "h2",
        controllerId: "p2",
        ownerId: "p2",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [source] }),
            makePlayer("p2", { hand: [h1, h2] }),
        ],
        ...overrides,
    });
    return { state, source };
}

describe("targeted 'target opponent' triggers honour player protection (CR 702.16b via CR 115.4, issue #2801)", () => {
    it("auto-selects the sole legal opponent and resolves when nothing protects them", () => {
        const { state, source } = twoSeatBoard(ravenousRats.id, "rats");
        // CR 603.3d — one mandatory target, exactly one legal candidate: the
        // engine locks it without prompting.
        expect(
            announceTrigger(
                state,
                source,
                "ravenous-rats-etb",
                etbEvent(source)
            )
        ).toBe(false);
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].targets).toEqual([{ type: "player", id: "p2" }]);

        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        expect(head.playerId).toBe("p2");
    });

    it("removes the trigger from the stack when the only opponent has protection from everything", () => {
        const { state, source } = twoSeatBoard(ravenousRats.id, "rats", {
            playerProtectionFromEverything: ["p2"],
        });
        expect(
            announceTrigger(
                state,
                source,
                "ravenous-rats-etb",
                etbEvent(source)
            )
        ).toBe(false);
        // CR 603.3d — a required target with no legal choice: the ability is
        // simply removed from the stack and does nothing.
        expect(state.stack).toHaveLength(0);
        expect(state.pendingTarget).toBeUndefined();
        expect(state.pendingChoices).toBeUndefined();
        // The protected player keeps their whole hand — the reported symptom.
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["h1", "h2"]);
        expect(state.players[1].graveyard).toHaveLength(0);
    });

    it("removes the trigger from the stack when the only opponent has shroud", () => {
        // CR 702.18 via CR 115.4 — Solitary Confinement gives its controller
        // shroud through the `player-guard` static effect.
        const confinement = makeInstance(solitaryConfinement.id, {
            id: "confine",
            controllerId: "p2",
            ownerId: "p2",
        });
        const { state, source } = twoSeatBoard(ravenousRats.id, "rats");
        state.players[1].battlefield.push(confinement);

        expect(
            announceTrigger(
                state,
                source,
                "ravenous-rats-etb",
                etbEvent(source)
            )
        ).toBe(false);
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["h1", "h2"]);
    });

    it("protects the player against Archon of Cruelty's enters trigger too — the fix is the class, not the card", () => {
        const { state, source } = twoSeatBoard(archonOfCruelty.id, "archon", {
            playerProtectionFromEverything: ["p2"],
        });
        const before = state.players[0].life;
        expect(
            announceTrigger(
                state,
                source,
                "archon-of-cruelty-enters",
                etbEvent(source)
            )
        ).toBe(false);
        expect(state.stack).toHaveLength(0);
        // The whole ability is removed, so the CONTROLLER's own draw-and-gain
        // half does not happen either (CR 603.3d — the ability does nothing).
        expect(state.players[0].life).toBe(before);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["h1", "h2"]);
    });

    it("still targets a protected player's OPPONENT — protection is per-player, not global", () => {
        // p1 (the Rats' controller) is the protected one; p2 is still fair game.
        const { state, source } = twoSeatBoard(ravenousRats.id, "rats", {
            playerProtectionFromEverything: ["p1"],
        });
        expect(
            announceTrigger(
                state,
                source,
                "ravenous-rats-etb",
                etbEvent(source)
            )
        ).toBe(false);
        expect(state.stack[0].targets).toEqual([{ type: "player", id: "p2" }]);
    });

    it("survives the wire projection — the client sees the same locked target", () => {
        const { state, source } = twoSeatBoard(ravenousRats.id, "rats");
        announceTrigger(state, source, "ravenous-rats-etb", etbEvent(source));
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.stack).toHaveLength(1);
        expect(projected.stack[0].targets).toEqual([
            { type: "player", id: "p2" },
        ]);
    });
});

describe("life loss is neither damage nor targeting (CR 702.16e, issue #2801)", () => {
    it("Sheoldred still drains a player with protection from everything on their draw", () => {
        const sheoldred = makeInstance(sheoldredTheApocalypse.id, {
            id: "sheol",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sheoldred] }),
                makePlayer("p2"),
            ],
            // The One Ring is up on the DRAWING player — the reporter's exact
            // board. CR 702.16 has no life-loss clause, and "an opponent" is
            // not "target opponent", so the drain must still land.
            playerProtectionFromEverything: ["p2"],
        });
        const before = state.players[1].life;
        const trig: StackItem = {
            ...sheoldred,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "sheoldred-opponent-draw-lose-life",
            triggerSourceId: sheoldred.id,
            triggerEvent: {
                type: "CARD_DRAWN",
                playerId: "p2",
            } as StackItem["triggerEvent"],
            targets: undefined,
        };
        state.stack.push(trig);
        // No target is owed — the ability names no target, so the announcement
        // sweep leaves it alone rather than removing it.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(before - 2);
    });
});
