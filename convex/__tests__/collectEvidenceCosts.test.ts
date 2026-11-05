// Collect evidence (CR 701.59) on its two non-alternative surfaces, issue #7723.
//
// ACTIVATION COST — "{T}, Collect evidence 3: Tap target creature you don't
// control" (Forensic Researcher): `activateAbilityOnState` parks the picker,
// `selectActivationExileCostOnState` validates the threshold, the commit exiles.
//
// CR 701.59c OPTIONAL ADDITIONAL COST — "As an additional cost to cast this
// spell, you may collect evidence 6" + "If evidence was collected, …" (Crimestopper
// Sprite), through the REAL `announceCast` handler: the announcement parks the
// cast's picker, the pick commits it, the record reaches the entering permanent
// and the linked sentence reads it (CR 607).

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getCardByName, withTemporaryDefinition } from "../cards";
import type { CardDefinition } from "../cards/types";
import {
    activateAbilityOnState,
    announceCast,
    finalizeTargetSelection,
    recordCastExileCostPick,
    selectActivationExileCostOnState,
} from "../game";
import { tryAutoCommitPendingCast } from "../gre/activation";
import { withPaidCollectEvidenceExile } from "../gre/kicker";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../gre/state";
import { projectPublicState } from "../gameProjections";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";
import type { Id } from "../_generated/dataModel";

const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

function inGraveyard(name: string, id: string): CardInstanceState {
    return makeInstance(getCardByName(name).id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });
}

/** Hill Giant 4 + Grizzly Bears 2 = 6; `short` leaves the Bears alone (2). */
function fodder(short = false): CardInstanceState[] {
    return short
        ? [inGraveyard("Grizzly Bears", "ev-bears")]
        : [
              inGraveyard("Hill Giant", "ev-giant"),
              inGraveyard("Grizzly Bears", "ev-bears"),
          ];
}

describe("Collect evidence as an activation cost (CR 701.59a/b)", () => {
    const researcher = () => getCardByName("Forensic Researcher");
    const abilityId = () => researcher().activatedAbilities![1]!.id;

    function board(short = false): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(researcher().id, {
                            id: "src",
                            controllerId: "p1",
                            ownerId: "p1",
                            isSummoningSick: false,
                        }),
                    ],
                    graveyard: fodder(short),
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(getCardByName("Grizzly Bears").id, {
                            id: "opp-bears",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    }

    function activate(state: GameState): void {
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: abilityId(),
        });
        const pending = state.pendingTarget!;
        pending.selected = [{ type: "permanent", id: "opp-bears" }];
        finalizeTargetSelection(state, pending, "p1");
    }

    /** The untargeted path's own gate (`activateAbilityOnState`). */
    function untargetedVariant(): CardDefinition {
        return {
            ...researcher(),
            activatedAbilities: [
                {
                    id: "evidence-pump",
                    oracleText:
                        "Collect evidence 3: This creature gets +3/+3 until end of turn.",
                    cost: {
                        exileFromGraveyard: {
                            count: 1,
                            owner: "you",
                            minTotalManaValue: 3,
                        },
                    },
                    useStack: true,
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$source" },
                            power: 3,
                            toughness: 3,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        };
    }

    it("parks the threshold picker, and it survives the projection", () => {
        const state = board();
        activate(state);
        expect(state.pendingActivation?.exileFromGraveyardChoice).toMatchObject(
            {
                minTotalManaValue: 3,
                owner: "you",
            }
        );
        // Nothing moves before the pick, so a cancel leaves the graveyard alone.
        expect(getPlayer(state, "p1").graveyard).toHaveLength(2);
        const wire = projectPublicState(state, 1, "p1").pendingActivation;
        expect(wire?.exileFromGraveyardChoice?.minTotalManaValue).toBe(3);
    });

    it("refuses a selection under the threshold and leaves the cost unpaid", () => {
        const state = board();
        activate(state);
        expect(() =>
            selectActivationExileCostOnState(state, {
                playerId: "p1",
                graveyardOwnerId: "p1",
                cardInstanceIds: ["ev-bears"],
            })
        ).toThrow(/total mana value of 3/);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(2);
        expect(state.stack).toHaveLength(0);
    });

    it("takes any number of cards reaching the threshold, over-payment included, and exiles them at the commit", () => {
        const state = board();
        activate(state);
        selectActivationExileCostOnState(state, {
            playerId: "p1",
            graveyardOwnerId: "p1",
            cardInstanceIds: ["ev-giant", "ev-bears"],
        });
        const me = getPlayer(state, "p1");
        expect(me.graveyard).toHaveLength(0);
        expect(me.exile.map((c) => c.id).sort()).toEqual([
            "ev-bears",
            "ev-giant",
        ]);
        expect(state.stack).toHaveLength(1);
    });

    it("can't choose to collect evidence below the threshold, targeted or not (CR 701.59b)", () => {
        const targeted = board(true);
        expect(() => activate(targeted)).toThrow(/collect evidence/);
        expect(targeted.pendingActivation).toBeUndefined();

        withTemporaryDefinition(untargetedVariant(), () => {
            const state = board(true);
            expect(() =>
                activateAbilityOnState(state, {
                    playerId: "p1",
                    cardInstanceId: "src",
                    abilityId: "evidence-pump",
                })
            ).toThrow(/collect evidence/);
            expect(state.pendingActivation).toBeUndefined();
        });
    });

    it("never takes the cards from an opponent's graveyard (CR 701.59a)", () => {
        const state = board();
        getPlayer(state, "p2").graveyard.push({
            ...inGraveyard("Hill Giant", "opp-giant"),
            controllerId: "p2",
            ownerId: "p2",
        });
        activate(state);
        expect(() =>
            selectActivationExileCostOnState(state, {
                playerId: "p1",
                graveyardOwnerId: "p2",
                cardInstanceIds: ["opp-giant"],
            })
        ).toThrow(/your own graveyard/);
    });
});

describe("Collect evidence as an optional additional cost (CR 701.59c)", () => {
    const sprite = () => getCardByName("Crimestopper Sprite");

    function board(short = false): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(sprite().id, {
                            id: "sprite",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    graveyard: fodder(short),
                    manaPool: { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    }

    async function announce(
        state: GameState,
        args: Record<string, unknown> = {}
    ) {
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation(
            announceCast as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            { ...BASE, cardInstanceId: "sprite", ...args }
        );
        return harness;
    }

    const PAID = { kickerPayments: { "collect-evidence": 1 } };

    it("is refused below the threshold (CR 701.59b), and unpaid the spell casts as printed", async () => {
        await expect(announce(board(true), PAID)).rejects.toThrow();
        const harness = await announce(board(true));
        const state = harness.state();
        expect(state.stack).toHaveLength(1);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
        expect(state.stack[0]!.unkickedCostPayments).toBeUndefined();
    });

    it("parks the cast on the threshold picker, unpicked, and its pick pays at the commit", async () => {
        const harness = await announce(board(), PAID);
        const state = harness.state();
        expect(state.stack).toHaveLength(0);
        const choice = state.pendingCast?.exileFromGraveyardChoice;
        expect(choice?.minTotalManaValue).toBe(6);
        expect(choice?.pickedCardIds).toBeUndefined();
        const wire = projectPublicState(state, 1, "p1").pendingCast;
        expect(wire?.exileFromGraveyardChoice?.minTotalManaValue).toBe(6);

        // Under the threshold is refused; nothing has moved.
        expect(() =>
            recordCastExileCostPick(state, "p1", ["ev-bears"])
        ).toThrow(/total mana value/);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(2);

        recordCastExileCostPick(state, "p1", ["ev-giant", "ev-bears"]);
        tryAutoCommitPendingCast(state, "p1");
        expect(state.stack).toHaveLength(1);
        expect(getPlayer(state, "p1").exile).toHaveLength(2);
    });

    it("refuses a second exile cost on the cast's one picker slot, never charging one for free", () => {
        const state = board();
        const existing = { count: 1, excludeInstanceId: "sprite" };
        expect(() =>
            withPaidCollectEvidenceExile(
                getPlayer(state, "p1"),
                sprite(),
                { "collect-evidence": 1 },
                "sprite",
                existing
            )
        ).toThrow(/cannot be paid together/);
    });

    it("records the payment where the linked ability reads it, and it is NOT a kick (CR 702.33d)", async () => {
        const harness = await announce(board(), PAID);
        const state = harness.state();
        recordCastExileCostPick(state, "p1", ["ev-giant", "ev-bears"]);
        tryAutoCommitPendingCast(state, "p1");
        const item = state.stack[0] as StackItem;
        expect(item.unkickedCostPayments).toEqual({ "collect-evidence": 1 });
        expect(item.kickerPayments).toBeUndefined();
    });

    /** The sentence's whole path: cast, resolve the creature, resolve its ETB
     *  trigger against a real creature, and read the stun counter. */
    async function stunCountersOnTarget(paid: boolean): Promise<number> {
        const state = board();
        getPlayer(state, "p2").battlefield.push(
            makeInstance(getCardByName("Grizzly Bears").id, {
                id: "opp-bears",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const harness = await announce(state, paid ? PAID : {});
        const live = harness.state();
        if (paid) {
            recordCastExileCostPick(live, "p1", ["ev-giant", "ev-bears"]);
            tryAutoCommitPendingCast(live, "p1");
        }
        resolveTopOfStack(live); // the creature — its ETB trigger announces
        const pending = live.pendingTarget!;
        pending.selected = [{ type: "permanent", id: "opp-bears" }];
        finalizeTargetSelection(live, pending, "p1");
        resolveTopOfStack(live); // the trigger
        const bears = getPlayer(live, "p2").battlefield.find(
            (c) => c.id === "opp-bears"
        )!;
        expect(bears.isTapped).toBe(true);
        return (
            (bears.counters as Record<string, number> | undefined)?.stun ?? 0
        );
    }

    it("the linked sentence fires only when evidence was collected (CR 607)", async () => {
        expect(await stunCountersOnTarget(true)).toBe(1);
        expect(await stunCountersOnTarget(false)).toBe(0);
    });
});
