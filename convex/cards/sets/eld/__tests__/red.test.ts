// ELD — per-card behavior tests for red cards in
// `convex/cards/sets/eld/red.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    emitBecameTargetEvents,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { applyCastModeCharacteristics } from "../../../../gre/castMode";
import { NO_BOARD_LAYER_VIEW } from "../../../../gre/layers";
import { getLegalActions } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState, StackItem } from "../../../../gre/state";
import { getDefinition } from "../../../index";

const robberOfTheRich = getDefinition("0ecbe097-ba51-42e5-957c-382eb66c08f0");

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
        const mountain = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56");
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

// ─────────────────────────────────────────────────────────────────────────────
// Bonecrusher Giant // Stomp (issue #3303, ADR 0120 slice 2). Two mechanisms,
// both new to this card:
//
//   - the "becomes the target of A SPELL" trigger — the shipped `BECAME_TARGET`
//     event (CR 603.2b) narrowed by `sourceKind`, which no card had narrowed
//     before, plus the `$event.sourceController` field row this slice censuses
//     (EVENT_FIELD_REGISTRY, ADR 0049) so the ping can name "that spell's
//     controller";
//   - Stomp, the Adventure half, whose first line is the new game-scoped
//     `suppressDamagePrevention` Op (CR 615.12). The Op's own coverage is in
//     `gre/effects/__tests__/interpreter.test.ts` and
//     `gre/__tests__/damagePreventionLock.test.ts`; what is asserted here is
//     that the CARD wires the two Ops together in the printed order, so the
//     lock covers Stomp's own damage.
// ─────────────────────────────────────────────────────────────────────────────

const bonecrusherGiant = getDefinition("ff984a4c-1818-4f8f-a9d7-fce57e77937d");
// ADR 0046 — every subject resolves through the registry seam, never through a
// set module's own export (`card-test-seam-boundary.test.ts`).
const lightningBolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");

function giantBoard(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(bonecrusherGiant.id, {
                        id: "giant",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

describe("Bonecrusher Giant — 'becomes the target of a spell' (CR 603.2b)", () => {
    it("pings that spell's controller for 2 when a SPELL targets it", () => {
        const state = giantBoard();
        const removal = pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "giant" },
        ]);
        emitBecameTargetEvents(
            state,
            removal.targets,
            "p2",
            removal.id,
            "spell"
        );
        processPendingActionTriggers(state);
        // The trigger is ON TOP of the removal spell — assert that, not just
        // the eventual life total, so the test can tell the ping apart from any
        // other reason p2 might lose life.
        expect(state.stack).toHaveLength(2);
        expect(state.stack[state.stack.length - 1].triggeredAbilityId).toBe(
            "bonecrusher-giant-targeted-ping"
        );
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
    });

    it("does NOT fire for an ABILITY that targets it — the Oracle says 'a spell'", () => {
        const state = giantBoard();
        emitBecameTargetEvents(
            state,
            [{ type: "permanent", id: "giant" }],
            "p2",
            "some-ability-item",
            "activated-ability"
        );
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].life).toBe(20);
    });

    it("does NOT fire when the spell targets something else", () => {
        const state = giantBoard();
        emitBecameTargetEvents(
            state,
            [{ type: "player", id: "p1" }],
            "p2",
            "some-spell-item",
            "spell"
        );
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].life).toBe(20);
    });

    it("pings its OWN controller when they target it themselves (the card is symmetric)", () => {
        const state = giantBoard();
        emitBecameTargetEvents(
            state,
            [{ type: "permanent", id: "giant" }],
            "p1",
            "own-spell-item",
            "spell"
        );
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(18);
    });
});

describe("Stomp — 'Damage can't be prevented this turn' (CR 615.12 / 715.3)", () => {
    /** p2's creature behind a 100-point prevention shield; p1 resolves Stomp at
     *  it as the Adventure half of the card in hand. */
    function stompBoard(): GameState {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(bonecrusherGiant.id, {
                            id: "card",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(bonecrusherGiant.id, {
                            id: "victim",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        state.targetPreventionShields = [
            {
                targetType: "permanent",
                targetId: "victim",
                remaining: 100,
                duration: { phase: "end-of-turn" },
            },
        ];
        return state;
    }

    /** Puts the card on the stack as its Adventure half, targeting `targetId`,
     *  through the same commit path every real cast site uses. */
    function pushStomp(state: GameState, targetId: string): StackItem {
        const card = state.players[0].hand.splice(0, 1)[0];
        const item: StackItem = {
            ...card,
            zone: "stack",
            castById: "p1",
            targets: [{ type: "permanent", id: targetId }],
        };
        applyCastModeCharacteristics(
            NO_BOARD_LAYER_VIEW,
            item,
            `adventure:${bonecrusherGiant.id}`
        );
        state.stack.push(item);
        return item;
    }

    it("deals its 2 damage THROUGH a prevention shield, and leaves the shield unspent", () => {
        const state = stompBoard();
        pushStomp(state, "victim");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")!
                .damageMarked
        ).toBe(2);
        // CR 615.12's last sentence — the shield was never reduced.
        expect(state.targetPreventionShields?.[0]?.remaining).toBe(100);
    });

    it("the lock outlives the resolution: later damage the same turn is unpreventable too", () => {
        const state = stompBoard();
        // A second shield, on the PLAYER, for a burn spell cast after Stomp has
        // already resolved: the lock is a turn effect on the game, not a rider
        // on Stomp's own damage event.
        state.targetPreventionShields!.push({
            targetType: "player",
            targetId: "p2",
            remaining: 100,
            duration: { phase: "end-of-turn" },
        });
        pushStomp(state, "victim");
        resolveTopOfStack(state);
        expect(state.damageUnpreventableThisTurn).toBe(true);
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });

    it("the same shield DOES prevent an unaccompanied Bolt (the contrast case)", () => {
        const state = stompBoard();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")!
                .damageMarked
        ).toBeUndefined();
    });
});
