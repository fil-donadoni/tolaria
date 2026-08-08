// Theros Beyond Death (THB) — colorless behavior tests (ADR 0043 colour split).
import { describe, it, expect } from "vitest";
import { soulGuideLantern } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";

const FOREST = getCardByName("Forest").id;

function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
    } as StackItem);
    resolveTopOfStack(state);
}

/** Puts the ETB trigger on the stack WITHOUT resolving it — the caller drives
 *  the CR 603.3d target selection (raiseTriggerTargetSelection →
 *  finalizeTargetSelection) before resolving. `triggerSourceId` mirrors
 *  `buildTriggerItem` so the engine can resolve the ability's requirement. */
function pushTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
    } as StackItem);
}

function gyCard(id: string, owner: string): CardInstanceState {
    return makeInstance(FOREST, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "graveyard",
    });
}

describe("Soul-Guide Lantern (graveyard hate + sac-draw, CR 406 / 605)", () => {
    it("declares an ETB exile trigger and two sacrifice abilities", () => {
        expect(getCardByName("Soul-Guide Lantern")).toBe(soulGuideLantern);
        expect(soulGuideLantern.manaCost).toEqual({ X: 1 });
        expect(soulGuideLantern.triggeredAbilities).toHaveLength(1);
        const draw = soulGuideLantern.activatedAbilities!.find(
            (a) => a.id === "soul-guide-lantern-draw"
        )!;
        expect(draw.cost).toMatchObject({
            mana: { X: 1 },
            tap: true,
            sacrifice: true,
        });
    });

    it("ETB exiles the CR 603.3d target chosen from an opponent's graveyard", () => {
        const lantern = makeInstance(soulGuideLantern.id, {
            id: "lantern",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Two legal graveyard cards across both bins → a REAL choice is owed
        // (a sole legal target would auto-select without raising a picker).
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lantern],
                    graveyard: [gyCard("myGy", "p1")],
                }),
                makePlayer("p2", { graveyard: [gyCard("gy1", "p2")] }),
            ],
        });
        pushTrigger(state, lantern, "soul-guide-lantern-etb-exile", {
            type: "PERMANENT_ENTERED",
            instanceId: "lantern",
            controllerId: "p1",
            types: ["Artifact"],
        } as StackItem["triggerEvent"]);

        // CR 603.3d — the target is chosen when the trigger goes on the stack.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [
            { type: "graveyard-card", id: "gy1", playerId: "p2" },
        ];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );

        resolveTopOfStack(state);
        expect(state.players[1].graveyard.length).toBe(0);
        expect(state.players[1].exile.map((c) => c.id)).toContain("gy1");
    });

    it("the {T},Sac mass ability exiles each opponent's whole graveyard", () => {
        const lantern = makeInstance(soulGuideLantern.id, {
            id: "lantern2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lantern] }),
                makePlayer("p2", {
                    graveyard: [gyCard("a", "p2"), gyCard("b", "p2")],
                }),
            ],
        });
        resolveActivated(state, lantern, "soul-guide-lantern-mass-exile");
        expect(state.players[1].graveyard.length).toBe(0);
        expect(state.players[1].exile.length).toBe(2);
    });

    it("the {1},{T},Sac ability draws a card", () => {
        const lantern = makeInstance(soulGuideLantern.id, {
            id: "lantern3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lantern],
                    library: [
                        makeInstance(FOREST, {
                            id: "lib0",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, lantern, "soul-guide-lantern-draw");
        expect(state.players[0].hand.length).toBe(1);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(1);
    });
});
