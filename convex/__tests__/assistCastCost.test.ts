// Assist (CR 702.132a) through the REGISTERED `game.ts` mutations: the caster
// names another player, that player and then the caster activate mana abilities,
// and the named player pays any amount of the generic before the caster pays the
// rest. Both seats answer through their own auth, as two clients would.

import { beforeAll, describe, expect, it } from "vitest";
import {
    announceCast,
    autoTapForPayment,
    cancelCast,
    finishAssistCasterMana,
    selectAssistPlayer,
    selectTarget,
    submitNumberChoice,
    tapForPayment,
    tapUntap,
} from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getCardByName } from "../cards";
import { preloadDefinitions } from "../cards/registry";
import type { CardDefinition } from "../cards/types";
import { computeExpectedInput } from "../gre/expectedInput";
import { nextOwedPayment } from "../gre/owedPayment";
import { getLegalActions } from "../gre/rules";
import { numberChoiceRange } from "../gre/state";
import type { GameState } from "../gre/state";
import { compactState, expandState } from "../gre/serialize";
import { projectPublicState } from "../gameProjections";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
    type MutationStub,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const PLAINS = getCardByName("Plains").id;

const ASSIST_CREATURE: CardDefinition = {
    id: "test-assist-creature",
    name: "Test Assist Creature",
    rarity: "common",
    manaCost: { generic: 4, W: 1 },
    types: ["Creature"],
    power: 3,
    toughness: 3,
    staticAbilities: ["assist"],
};

const ASSIST_NO_GENERIC: CardDefinition = {
    id: "test-assist-no-generic",
    name: "Test Assist No Generic",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticAbilities: ["assist"],
};

const ASSIST_SORCERY: CardDefinition = {
    id: "test-assist-sorcery",
    name: "Test Assist Sorcery",
    rarity: "common",
    manaCost: { generic: 2, W: 1 },
    types: ["Sorcery"],
    staticAbilities: ["assist"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "destroy", target: { target: 0 } }],
};

const ASSIST_NOTES_MANA: CardDefinition = {
    ...ASSIST_CREATURE,
    id: "test-assist-notes-mana",
    name: "Test Assist Notes Mana",
    noteManaSpent: true,
};

const ASSIST_DASH: CardDefinition = {
    ...ASSIST_CREATURE,
    id: "test-assist-dash",
    name: "Test Assist Dash",
    dash: { id: "dash", description: "Dash {1}{W}", mana: { X: 1, W: 1 } },
};

beforeAll(() =>
    preloadDefinitions([
        ASSIST_DASH,
        ASSIST_CREATURE,
        ASSIST_NO_GENERIC,
        ASSIST_SORCERY,
        ASSIST_NOTES_MANA,
    ])
);

function plainsFor(owner: "p1" | "p2", count: number) {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(PLAINS, {
            id: `${owner}-plains-${i}`,
            controllerId: owner,
            ownerId: owner,
        })
    );
}

/** p1 holds priority in their main phase with one card to cast. */
function assistState(opts: {
    cardId?: string;
    casterLands?: number;
    assistantLands?: number;
    extra?: (state: GameState) => void;
}): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(opts.cardId ?? ASSIST_CREATURE.id, {
                        id: "spell",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: plainsFor("p1", opts.casterLands ?? 5),
            }),
            makePlayer("p2", {
                battlefield: [
                    ...plainsFor("p2", opts.assistantLands ?? 4),
                    makeInstance(getCardByName("Grizzly Bears").id, {
                        id: "bear",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    opts.extra?.(state);
    return state;
}

function harnessFor(state: GameState): MutationStub {
    return makeMutationCtx("p1", [gameStateSeed(state)]);
}

async function drive<A>(
    harness: MutationStub,
    seat: "p1" | "p2",
    mutation: unknown,
    args: A
): Promise<void> {
    await runMutation(
        mutation as Handler<unknown, void>,
        harness.asUser(seat),
        { gameId: GAME_ID, playerId: seat, ...args }
    );
}

const announce = (h: MutationStub) =>
    drive(h, "p1", announceCast, { cardInstanceId: "spell" });
const name = (h: MutationStub, assistPlayerId?: string) =>
    drive(h, "p1", selectAssistPlayer, { assistPlayerId });
const tapFloat = (h: MutationStub, seat: "p1" | "p2", cardInstanceId: string) =>
    drive(h, seat, tapUntap, { cardInstanceId });
const tapPay = (h: MutationStub, count: number, from = 0) =>
    drive(h, "p1", tapForPayment, {
        payments: Array.from({ length: count }, (_, i) => ({
            cardInstanceId: `p1-plains-${from + i}`,
        })),
    });
const answer = (h: MutationStub, amount: number) =>
    drive(h, "p2", submitNumberChoice, { amount });
const finishCasterMana = (h: MutationStub) =>
    drive(h, "p1", finishAssistCasterMana, {});

/** Walks a cast to the point p2 is asked how much to pay, p2 having floated
 *  `floated` mana and p1 none. */
async function toAssistantPayment(h: MutationStub, floated: number) {
    await announce(h);
    await name(h, "p2");
    for (let i = 0; i < floated; i++) await tapFloat(h, "p2", `p2-plains-${i}`);
    await answer(h, 0);
    await finishCasterMana(h);
}

const poolTotal = (state: GameState, index: number) =>
    Object.values(state.players[index].manaPool).reduce((a, b) => a + b, 0);

describe("Assist: when the caster is offered it (CR 702.132a)", () => {
    it("parks a cast whose total cost has a generic component, before any mana is spent", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        const pc = h.state().pendingCast!;
        expect(pc.assistChoice?.stage).toBe("choose-player");
        expect(pc.assistChoice?.candidateIds).toEqual(["p2"]);
        expect(h.state().stack).toHaveLength(0);
        expect(nextOwedPayment(h.state(), "p1")?.kind).toBe(
            "cast:assistChoice"
        );
    });

    it("parks even when floating mana already covers the cost: the choice comes first", async () => {
        const h = harnessFor(
            assistState({
                extra: (state) => {
                    state.players[0].manaPool.W = 5;
                },
            })
        );
        await announce(h);
        expect(h.state().stack).toHaveLength(0);
        expect(h.state().pendingCast?.assistChoice?.stage).toBe(
            "choose-player"
        );
    });

    it("offers nothing on a total cost with no generic component", async () => {
        const h = harnessFor(
            assistState({
                cardId: ASSIST_NO_GENERIC.id,
                extra: (state) => {
                    state.players[0].manaPool.W = 1;
                },
            })
        );
        await announce(h);
        expect(h.state().pendingCast).toBeUndefined();
        expect(h.state().stack).toHaveLength(1);
    });

    it("parks a TARGETED cast once its target is chosen", async () => {
        const h = harnessFor(assistState({ cardId: ASSIST_SORCERY.id }));
        await announce(h);
        await drive(h, "p1", selectTarget, {
            targetType: "permanent",
            targetId: "bear",
        });
        expect(h.state().pendingCast?.assistChoice?.stage).toBe(
            "choose-player"
        );
    });

    it("reads the total cost of an ALTERNATIVE-cost cast, whichever cost it came from", async () => {
        const h = harnessFor(
            assistState({
                cardId: ASSIST_DASH.id,
                extra: (state) => {
                    state.players[0].manaPool.W = 2;
                },
            })
        );
        await drive(h, "p1", announceCast, {
            cardInstanceId: "spell",
            alternativeCostId: "dash",
        });
        expect(h.state().pendingCast?.assistChoice?.stage).toBe(
            "choose-player"
        );
        await name(h, undefined);
        expect(h.state().stack[0]?.dashed).toBe(true);
    });

    it("naming no one leaves an ordinary cast, committing when the pool covers it", async () => {
        const h = harnessFor(
            assistState({
                extra: (state) => {
                    state.players[0].manaPool.W = 5;
                },
            })
        );
        await announce(h);
        await name(h, undefined);
        expect(h.state().pendingCast).toBeUndefined();
        expect(h.state().stack.map((s) => s.id)).toEqual(["spell"]);
        expect(h.state().pendingChoices ?? []).toHaveLength(0);
    });

    it("naming no one leaves the caster to pay it all", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await name(h, undefined);
        expect(computeExpectedInput(h.state())?.playerId).toBe("p1");
        await drive(h, "p1", autoTapForPayment, {});
        expect(h.state().stack.map((s) => s.id)).toEqual(["spell"]);
        expect(h.state().players[1].battlefield.some((c) => c.isTapped)).toBe(
            false
        );
    });

    it("a caster who starts paying without naming anyone has named no one", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await tapPay(h, 5);
        expect(h.state().stack.map((s) => s.id)).toEqual(["spell"]);
        expect(h.state().pendingChoices ?? []).toHaveLength(0);
    });

    it("refuses naming the caster or a player not in the game", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await expect(name(h, "p1")).rejects.toThrow(
            "Choose another player in the game"
        );
        await expect(name(h, "p3")).rejects.toThrow(
            "Choose another player in the game"
        );
    });
});

describe("Assist: the order of the exchange (CR 702.132a)", () => {
    it("gives the named player the first chance to activate mana abilities", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await name(h, "p2");
        const input = computeExpectedInput(h.state());
        expect(input).toMatchObject({ kind: "choice", playerId: "p2" });
        // The caster holds priority, but is not who the game is waiting for.
        await expect(tapPay(h, 1)).rejects.toThrow("Illegal action");
        await tapFloat(h, "p2", "p2-plains-0");
        expect(h.state().players[1].manaPool.W).toBe(1);
    });

    it("offers the named player no amount until the caster has had their chance", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await name(h, "p2");
        await tapFloat(h, "p2", "p2-plains-0");
        const head = h.state().pendingChoices![0];
        expect(numberChoiceRange(head, h.state().players[1])).toEqual({
            min: 0,
            max: 0,
        });
        await expect(answer(h, 1)).rejects.toThrow(
            "Choose a number between 0 and 0"
        );
    });

    it("then the caster's chance: their mana floats, nothing commits until they finish", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await name(h, "p2");
        await tapFloat(h, "p2", "p2-plains-0");
        await answer(h, 0);
        expect(h.state().pendingCast?.assistChoice?.stage).toBe("caster-mana");
        expect(computeExpectedInput(h.state())).toMatchObject({
            kind: "priority",
            playerId: "p1",
        });
        await tapPay(h, 5);
        // The whole cost is covered, and still the named player has not paid.
        expect(h.state().stack).toHaveLength(0);
        await finishCasterMana(h);
        expect(computeExpectedInput(h.state())).toMatchObject({
            kind: "choice",
            playerId: "p2",
        });
    });

    it("refuses finishing the caster's chance out of turn", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await expect(finishCasterMana(h)).rejects.toThrow(
            "Assist is not waiting for your mana"
        );
    });

    it("settles at once when the named player ends their chance with no mana to spend", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await name(h, "p2");
        await answer(h, 0);
        const assist = h.state().pendingCast?.assistChoice;
        expect(assist?.stage).toBe("settled");
        expect(h.state().pendingChoices ?? []).toHaveLength(0);
        await drive(h, "p1", autoTapForPayment, {});
        expect(h.state().stack.map((s) => s.id)).toEqual(["spell"]);
    });
});

describe("Assist: the payment (CR 702.132a / 601.2h)", () => {
    it("pays all of the generic from the named player's pool, and the caster the rest", async () => {
        const h = harnessFor(assistState({}));
        await toAssistantPayment(h, 4);
        await answer(h, 4);
        expect(h.state().pendingCast?.manaCost).toEqual({ W: 1 });
        await tapPay(h, 1);
        const after = h.state();
        expect(after.stack.map((s) => s.id)).toEqual(["spell"]);
        expect(after.pendingCast).toBeUndefined();
        expect(poolTotal(after, 1)).toBe(0);
        expect(poolTotal(after, 0)).toBe(0);
        // The assistant's mana was really spent: its sources stay tapped.
        expect(
            after.players[1].battlefield.filter((c) => c.isTapped)
        ).toHaveLength(4);
        expect(
            after.players[0].battlefield.filter((c) => c.isTapped)
        ).toHaveLength(1);
    });

    it("commits at once when the caster already floated what the payment leaves", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await name(h, "p2");
        await tapFloat(h, "p2", "p2-plains-0");
        await tapFloat(h, "p2", "p2-plains-1");
        await answer(h, 0);
        await tapPay(h, 3);
        await finishCasterMana(h);
        await answer(h, 2);
        expect(h.state().stack.map((s) => s.id)).toEqual(["spell"]);
        expect(poolTotal(h.state(), 1)).toBe(0);
        expect(poolTotal(h.state(), 0)).toBe(0);
    });

    it("accepts any amount: a partial payment leaves the rest of the generic to the caster", async () => {
        const h = harnessFor(assistState({}));
        await toAssistantPayment(h, 4);
        await answer(h, 1);
        expect(h.state().pendingCast?.manaCost).toEqual({ X: 3, W: 1 });
        // Not an amount-for-free: what they did not pay stays in their pool.
        await tapPay(h, 4);
        expect(h.state().stack.map((s) => s.id)).toEqual(["spell"]);
        expect(poolTotal(h.state(), 1)).toBe(3);
    });

    it("accepts paying nothing", async () => {
        const h = harnessFor(assistState({}));
        await toAssistantPayment(h, 2);
        await answer(h, 0);
        expect(h.state().pendingCast?.manaCost).toEqual({ X: 4, W: 1 });
        expect(poolTotal(h.state(), 1)).toBe(2);
    });

    it("caps the payment at the generic: an assistant cannot pay a coloured pip", async () => {
        const h = harnessFor(
            assistState({
                assistantLands: 6,
                extra: (state) => {
                    state.players[1].manaPool.W = 6;
                },
            })
        );
        await toAssistantPayment(h, 0);
        expect(
            numberChoiceRange(
                h.state().pendingChoices![0],
                h.state().players[1]
            )
        ).toEqual({ min: 0, max: 4 });
        await expect(answer(h, 5)).rejects.toThrow(
            "Choose a number between 0 and 4"
        );
    });

    it("caps the payment at the mana the named player has", async () => {
        const h = harnessFor(assistState({}));
        await toAssistantPayment(h, 2);
        await expect(answer(h, 3)).rejects.toThrow(
            "Choose a number between 0 and 2"
        );
    });

    it("refuses an answer from the caster", async () => {
        const h = harnessFor(assistState({}));
        await toAssistantPayment(h, 2);
        await expect(
            drive(h, "p1", submitNumberChoice, { amount: 1 })
        ).rejects.toThrow("Illegal action");
    });

    it("lets the assistant spend restricted mana the spell permits, and not other restricted mana (CR 106.6)", async () => {
        const restricted = (restriction: "creature-spell" | "artifact-spell") =>
            assistState({
                assistantLands: 0,
                extra: (state) => {
                    state.players[1].restrictedMana = [
                        { color: "W", amount: 3, restriction },
                    ];
                },
            });

        const eligible = harnessFor(restricted("creature-spell"));
        await toAssistantPayment(eligible, 0);
        await answer(eligible, 3);
        expect(eligible.state().pendingCast?.manaCost).toEqual({ X: 1, W: 1 });

        const ineligible = harnessFor(restricted("artifact-spell"));
        await announce(ineligible);
        await name(ineligible, "p2");
        await answer(ineligible, 0);
        expect(ineligible.state().pendingCast?.assistChoice?.stage).toBe(
            "settled"
        );
    });

    it("carries a rider on the assistant's mana onto the spell (CR 106.6)", async () => {
        const h = harnessFor(
            assistState({
                assistantLands: 0,
                extra: (state) => {
                    state.players[1].restrictedMana = [
                        {
                            color: "W",
                            amount: 4,
                            restriction: "creature-spell",
                            cantBeCounteredRider: true,
                        },
                    ];
                },
            })
        );
        await toAssistantPayment(h, 0);
        await answer(h, 4);
        await tapPay(h, 1);
        expect(h.state().stack[0].dynamicCantBeCountered).toBe(true);
    });

    it("counts the assistant's mana in the spell's record of mana spent to cast it", async () => {
        const h = harnessFor(
            assistState({
                cardId: ASSIST_NOTES_MANA.id,
                extra: (state) => {
                    state.players[1].manaPool.U = 3;
                },
            })
        );
        await toAssistantPayment(h, 0);
        await answer(h, 3);
        await tapPay(h, 2);
        expect(h.state().stack[0].notedManaSpent).toEqual({ U: 3, W: 2 });
    });
});

describe("Assist: cancelling the cast", () => {
    it("reverses both players' taps and spends nothing", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await name(h, "p2");
        await tapFloat(h, "p2", "p2-plains-0");
        await tapFloat(h, "p2", "p2-plains-1");
        await answer(h, 0);
        await tapPay(h, 2);
        await finishCasterMana(h);
        await answer(h, 2);
        await drive(h, "p1", cancelCast, {});
        const after = h.state();
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack).toHaveLength(0);
        expect(after.players[0].hand.map((c) => c?.id)).toEqual(["spell"]);
        for (const index of [0, 1]) {
            expect(
                after.players[index].battlefield.filter((c) => c.isTapped)
            ).toHaveLength(0);
            expect(poolTotal(after, index)).toBe(0);
        }
    });

    it("keeps an untap the assistant already took back off the rollback ledger", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await name(h, "p2");
        await tapFloat(h, "p2", "p2-plains-0");
        await tapFloat(h, "p2", "p2-plains-0");
        expect(h.state().pendingCast?.assistChoice?.assistantTappedIds).toEqual(
            []
        );
        expect(poolTotal(h.state(), 1)).toBe(0);
    });

    it("the mana window is the assistant's alone: the caster's plain tap is still refused", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await name(h, "p2");
        await expect(tapFloat(h, "p1", "p1-plains-0")).rejects.toThrow(
            "Illegal action"
        );
    });
});

describe("Assist: castability (CR 702.132a)", () => {
    const castable = (state: GameState) =>
        getLegalActions(
            state,
            state.players[0],
            state.players[0].hand[0]!
        ).includes("cast");

    it("offers a spell the caster can pay only with help", () => {
        expect(
            castable(assistState({ casterLands: 1, assistantLands: 4 }))
        ).toBe(true);
    });

    it("does not offer it when the other players' mana cannot cover the shortfall", () => {
        expect(
            castable(assistState({ casterLands: 1, assistantLands: 3 }))
        ).toBe(false);
    });

    it("never counts the other player's mana toward a coloured pip", () => {
        expect(
            castable(assistState({ casterLands: 0, assistantLands: 9 }))
        ).toBe(false);
    });
});

describe("Assist: wire format", () => {
    it("the exchange survives the projection and a serialization round trip", async () => {
        const h = harnessFor(assistState({}));
        await announce(h);
        await name(h, "p2");
        const state = h.state();
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.pendingChoices?.[0]?.assistPayment?.stage).toBe(
            "mana"
        );
        expect(projected.pendingCast?.assistChoice).toMatchObject({
            stage: "assistant-mana",
            assistantId: "p2",
            spell: { spellName: ASSIST_CREATURE.name },
        });
        const roundTripped = expandState(compactState(state));
        expect(roundTripped.pendingCast?.assistChoice).toEqual(
            state.pendingCast?.assistChoice
        );
        expect(roundTripped.pendingChoices?.[0]?.assistPayment).toEqual(
            state.pendingChoices?.[0]?.assistPayment
        );
    });
});
