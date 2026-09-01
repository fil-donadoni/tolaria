// ELD — per-card behavior tests for red cards in
// `convex/cards/sets/eld/red.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { robberOfTheRich } from "../red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import { resolveTopOfStack } from "../../../../gre/state";
import { getLegalActions } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState, StackItem } from "../../../../gre/state";

const CHEAP_CARD_ID = "b0faa7f2-b547-42c4-a810-839da50dadfe"; // Black Lotus stub

function attackEvent(attackerId: string): StackItem["triggerEvent"] {
    return {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: "p1",
        attackerIds: [attackerId],
    };
}

function pushAttackTrigger(
    state: GameState,
    robber: ReturnType<typeof makeInstance>
) {
    state.stack.push({
        ...robber,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "robber-of-the-rich-attack",
        triggerSourceId: robber.id,
        triggerEvent: attackEvent(robber.id),
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Robber of the Rich (CR 508.1 attack trigger + CR 601.3 cast-from-exile)", () => {
    it("exiles the defending player's top library card face down, castable by the attacker, when they have more cards in hand (CR 603.4)", () => {
        const robber = makeInstance(robberOfTheRich.id, {
            id: "robber",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const top = makeInstance(CHEAP_CARD_ID, {
            id: "top",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [robber], hand: [] }),
                makePlayer("p2", {
                    library: [top],
                    hand: [
                        makeInstance(CHEAP_CARD_ID, {
                            id: "p2hand1",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
            combat: {
                attackerIds: ["robber"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        pushAttackTrigger(state, robber);
        expect(state.players[1].library).toHaveLength(0);
        const exiled = state.players[1].exile.find((c) => c.id === "top")!;
        expect(exiled).toBeDefined();
        expect(exiled.castableFromExileBy).toBe("p1");
        // Face down: hidden to the defender, known to the attacking controller.
        expect(exiled.knownTo).toEqual(["p1"]);
    });

    it("does nothing when the defending player does not have more cards in hand (CR 603.4 intervening condition)", () => {
        const robber = makeInstance(robberOfTheRich.id, {
            id: "robber",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const top = makeInstance(CHEAP_CARD_ID, {
            id: "top",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [robber], hand: [] }),
                makePlayer("p2", { library: [top], hand: [] }),
            ],
            combat: {
                attackerIds: ["robber"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        pushAttackTrigger(state, robber);
        expect(state.players[1].library).toHaveLength(1);
        expect(state.players[1].exile).toHaveLength(0);
    });

    it("wire format: the exiled card is castable-from-exile for both viewers", () => {
        const robber = makeInstance(robberOfTheRich.id, {
            id: "robber",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const top = makeInstance(CHEAP_CARD_ID, {
            id: "top",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [robber], hand: [] }),
                makePlayer("p2", {
                    library: [top],
                    hand: [
                        makeInstance(CHEAP_CARD_ID, {
                            id: "p2hand1",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
            combat: {
                attackerIds: ["robber"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        pushAttackTrigger(state, robber);
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[1].exile.find(
                (c) => c.id === "top"
            )!;
            expect(slim.castableFromExileBy).toBe("p1");
        }
    });

    // CR 305.9 / 116.2a (issue #1689) — Robber's oracle says "you may CAST
    // that card" (not "play"): a LAND exiled this way must expose NO action
    // at all for either viewer — same bug class as Ragavan (mh2/red.ts).
    it("grants NO play/cast action when the defending player's exiled top card is a LAND (CR 305.9 regression)", () => {
        const robber = makeInstance(robberOfTheRich.id, {
            id: "robber",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const mountain = getCardByName("Mountain");
        const topLand = makeInstance(mountain.id, {
            id: "top-land",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [robber], hand: [] }),
                makePlayer("p2", {
                    library: [topLand],
                    hand: [
                        makeInstance(CHEAP_CARD_ID, {
                            id: "p2hand1",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
            combat: {
                attackerIds: ["robber"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        pushAttackTrigger(state, robber);
        const exiled = state.players[1].exile.find((c) => c.id === "top-land")!;
        expect(exiled).toBeDefined();
        expect(exiled.types).toContain("Land");
        // The cast permission is still granted, but never land-inclusive.
        expect(exiled.castableFromExileBy).toBe("p1");
        expect(exiled.castableFromExileIncludesLand).toBeUndefined();

        const p1 = state.players[0];
        const p2 = state.players[1];
        const actions = getLegalActions(state, p2, exiled, false, p1.id);
        expect(actions).not.toContain("play");
        expect(actions).not.toContain("cast");

        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[1].exile.find(
                (c) => c.id === "top-land"
            )!;
            expect(slim.legalActions ?? []).toEqual([]);
        }
    });
});
