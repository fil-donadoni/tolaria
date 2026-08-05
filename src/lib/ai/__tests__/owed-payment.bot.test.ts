// ADR 0091 / issue #1209 — the vs-AI bot answers EVERY payment park.
//
// A payment park is a cost pick suspended inside the announcement window
// (CR 601.2 / 602.2). It lives outside `pendingChoices[]`, so no candidate
// generator sees it and no Worker search can answer it; `enumerateMoves` returns
// [] while an announcement is parked. Before this seam the bot announced the
// cast/activation, submitted nothing, and hung on a move it generated itself —
// a class fixed nine times one park at a time (#161, #163, #164, #1336, #1338,
// #1446, #1506, #1507, #1659).
//
// Everything here is driven through the REAL wire boundary
// (`projectPublicState` → `buildBotView` → `decideBotAction` →
// `submitOwedPayment`), never a hand-built view: a hand-built view masks exactly
// the dropped-field bug these tests exist to catch.
//
// Every scenario deliberately offers MORE THAN ONE distinct legal candidate. A
// forced or fungible pick auto-resolves server-side, and the test would then
// pass with the fix reverted.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { PARK_KINDS } from "@convex/gre/owedPayment";
import type { OwedPaymentSubmission } from "@convex/gre/paymentPicks";
import type {
    CardInstanceState,
    GameState,
    PendingActivation,
    PendingCast,
} from "@convex/gre/state";
import {
    PARK_ANSWER_ROUTE,
    botActionRealisation,
    decideBotAction,
    type BotAction,
} from "../brain";
import { buildBotView } from "../bot-view";
import {
    submitOwedPayment,
    type OwedPaymentMutations,
} from "../pay-owed-payment";

const BOT = "u1-p2";
const HUMAN = "u1-p1";

const SURVIVAL = getCardByName("Survival of the Fittest");
const STROSSUS = getCardByName("Devouring Strossus");
const HAND_OF_JUSTICE = getCardByName("Hand of Justice");
const METAMORPHOSIS = getCardByName("Metamorphosis");
const SOUL_EXCHANGE = getCardByName("Soul Exchange");
const FORCE_OF_WILL = getCardByName("Force of Will");

const BEAR = getCardByName("Grizzly Bears").id; // {1}{G} 2/2
const WURM = getCardByName("Craw Wurm").id; // {4}{G}{G} 6/4
const LIONS = getCardByName("Savannah Lions").id; // {W} 2/1, white
const CRUSADER = getCardByName("Benalish Hero").id; // {W} 1/1, white
const UNSUMMON = getCardByName("Unsummon").id; // {U} Instant — blue
const COUNTERSPELL = getCardByName("Counterspell").id; // {U}{U} Instant — blue

/** Records every mutation the driver would fire, in order. */
function recorder() {
    const calls: { mutation: string; args: Record<string, unknown> }[] = [];
    const wrap =
        (mutation: string) =>
        async (args: Record<string, unknown>): Promise<unknown> => {
            const rest = { ...args };
            delete rest.gameId;
            delete rest.playerId;
            calls.push({ mutation, args: rest });
            return undefined;
        };
    const mutations = {
        selectSacrifice: wrap("selectSacrifice"),
        selectAdditionalCost: wrap("selectAdditionalCost"),
        selectConvokeCreatures: wrap("selectConvokeCreatures"),
        selectCastExileCost: wrap("selectCastExileCost"),
        selectCastAlternativeHandCost: wrap("selectCastAlternativeHandCost"),
        selectActivationCost: wrap("selectActivationCost"),
        selectActivationExileCost: wrap("selectActivationExileCost"),
        selectActivationDiscardCost: wrap("selectActivationDiscardCost"),
        resolveManaSpendChoice: wrap("resolveManaSpendChoice"),
    } as unknown as OwedPaymentMutations;
    return { calls, mutations };
}

/** The action the bot takes on `state`, decided through the real wire
 *  projection and view reducer (never a hand-built `BotView`). */
function botActionOn(state: GameState): BotAction {
    const projected = projectPublicState(state, 1, BOT);
    return decideBotAction(buildBotView(projected, BOT));
}

/** Decide + realise: the mutation sequence the driver would fire. */
async function realise(state: GameState) {
    const action = botActionOn(state);
    expect(action.kind).toBe("pay-owed-payment");
    if (action.kind !== "pay-owed-payment") throw new Error("unreachable");
    expect(botActionRealisation(action.kind)).toBe("owed-payment");
    const { calls, mutations } = recorder();
    await submitOwedPayment(
        action.submission,
        { gameId: "g" as never, playerId: BOT },
        mutations
    );
    return { action, calls };
}

function baseState(
    botOverrides: Parameters<typeof makePlayer>[1],
    pending: {
        pendingCast?: PendingCast;
        pendingActivation?: PendingActivation;
    }
): GameState {
    return makeState({
        players: [makePlayer(HUMAN), makePlayer(BOT, botOverrides)],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        ...pending,
    });
}

function inst(cardId: string, id: string, zone = "battlefield") {
    return makeInstance(cardId, {
        id,
        controllerId: BOT,
        ownerId: BOT,
        zone: zone as CardInstanceState["zone"],
    });
}

// ────────────────────────────────────────────────────────────────────────────
// The guard: EVERY park is answerable, none silently unrouted
// ────────────────────────────────────────────────────────────────────────────

describe("payment-park answer census (ADR 0091, issue #1209)", () => {
    it("routes every ParkKind to a dedicated or generic bot answer", () => {
        for (const kind of PARK_KINDS) {
            expect(PARK_ANSWER_ROUTE[kind]).toMatch(/^(dedicated|generic)$/);
        }
        expect(Object.keys(PARK_ANSWER_ROUTE).sort()).toEqual(
            [...PARK_KINDS].sort()
        );
    });

    it("dispatches every submission shape to a real mutation", async () => {
        // One submission per member of the union. `submitOwedPayment`'s switch
        // is `assertNever`-closed, so a new member with no branch cannot
        // compile; this asserts each existing branch reaches a distinct
        // mutation and preserves its arguments.
        const submissions: OwedPaymentSubmission[] = [
            { mutation: "selectSacrifice", cardInstanceIdEach: ["a", "b"] },
            { mutation: "selectAdditionalCost", cardInstanceId: "a" },
            { mutation: "selectConvokeCreatures", creatureInstanceIds: ["a"] },
            { mutation: "selectCastExileCost", cardInstanceIds: ["a"] },
            {
                mutation: "selectCastAlternativeHandCost",
                cardInstanceIds: ["a"],
            },
            {
                mutation: "selectActivationCost",
                cardInstanceIdEach: ["a", "b"],
            },
            {
                mutation: "selectActivationExileCost",
                graveyardOwnerId: HUMAN,
                cardInstanceIds: ["a"],
            },
            { mutation: "selectActivationDiscardCost", cardInstanceIds: ["a"] },
            { mutation: "resolveManaSpendChoice", spendOrder: ["R"] },
        ];
        for (const submission of submissions) {
            const { calls, mutations } = recorder();
            await submitOwedPayment(
                submission,
                { gameId: "g" as never, playerId: BOT },
                mutations
            );
            expect(calls.length).toBeGreaterThan(0);
            for (const call of calls) {
                expect(call.mutation).toBe(submission.mutation);
            }
        }
    });

    it("fires one call per id for the per-pick shapes (CR 701.16 / 118.8)", async () => {
        const { calls, mutations } = recorder();
        await submitOwedPayment(
            {
                mutation: "selectSacrifice",
                cardInstanceIdEach: ["a", "b", "c"],
            },
            { gameId: "g" as never, playerId: BOT },
            mutations
        );
        expect(calls.map((c) => c.args.cardInstanceId)).toEqual([
            "a",
            "b",
            "c",
        ]);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Regression scenarios — one per stalling park
// ────────────────────────────────────────────────────────────────────────────

describe("activation parks the bot used to stall on (CR 602.1 / 118)", () => {
    it("Survival of the Fittest — answers the discard park (CR 118.3)", async () => {
        // TWO distinct creature cards in hand: a real choice, so the server
        // does NOT auto-resolve it and the park genuinely blocks commit.
        const leg = SURVIVAL.activatedAbilities![0].cost.discardFilter!;
        const state = baseState(
            {
                hand: [
                    inst(BEAR, "h-bear", "hand"),
                    inst(WURM, "h-wurm", "hand"),
                ],
                battlefield: [inst(SURVIVAL.id, "survival")],
            },
            {
                pendingActivation: {
                    playerId: BOT,
                    cardInstanceId: "survival",
                    abilityId: SURVIVAL.activatedAbilities![0].id,
                    manaCost: {},
                    tappedLandIds: [],
                    tapSource: false,
                    sacrificeSource: false,
                    discardFilterChoice: {
                        filter: leg.filter,
                        count: leg.count,
                    },
                },
            }
        );
        const { action, calls } = await realise(state);
        expect(action.park).toBe("activation:discardFilterChoice");
        // Cheapest matching creature: Grizzly Bears (mv 2) over Craw Wurm (6).
        expect(calls).toEqual([
            {
                mutation: "selectActivationDiscardCost",
                args: { cardInstanceIds: ["h-bear"] },
            },
        ]);
    });

    it("Devouring Strossus — answers the filtered-sacrifice park (CR 701.16)", async () => {
        const state = baseState(
            {
                battlefield: [
                    inst(STROSSUS.id, "strossus"),
                    inst(BEAR, "bear"),
                    inst(WURM, "wurm"),
                ],
            },
            {
                pendingActivation: {
                    playerId: BOT,
                    cardInstanceId: "strossus",
                    abilityId: STROSSUS.activatedAbilities![0].id,
                    manaCost: {},
                    tappedLandIds: [],
                    tapSource: false,
                    sacrificeSource: false,
                    sacrificeSelection: {
                        playerId: BOT,
                        reason: "Devouring Strossus",
                        requirements: [
                            {
                                filter: STROSSUS.activatedAbilities![0].cost
                                    .sacrificeFilter!,
                                count: 1,
                                snapshot: true,
                            },
                        ],
                        picked: [],
                    },
                },
            }
        );
        const { action, calls } = await realise(state);
        expect(action.park).toBe("activation:sacrificeSelection");
        expect(calls).toEqual([
            { mutation: "selectSacrifice", args: { cardInstanceId: "bear" } },
        ]);
    });

    it("Hand of Justice — answers the tap-other park, one call per body (CR 118.8)", async () => {
        // FOUR white creatures for a three-body cost: more candidates than the
        // cost needs, so the pick is a real choice.
        const leg = HAND_OF_JUSTICE.activatedAbilities![0].cost.tapOtherFilter!;
        const state = baseState(
            {
                battlefield: [
                    inst(HAND_OF_JUSTICE.id, "hoj"),
                    inst(LIONS, "w1"),
                    inst(LIONS, "w2"),
                    inst(CRUSADER, "w3"),
                    inst(CRUSADER, "w4"),
                ],
            },
            {
                pendingActivation: {
                    playerId: BOT,
                    cardInstanceId: "hoj",
                    abilityId: HAND_OF_JUSTICE.activatedAbilities![0].id,
                    manaCost: {},
                    tappedLandIds: [],
                    tapSource: true,
                    sacrificeSource: false,
                    tapOtherChoice: {
                        filter: leg.filter,
                        count: leg.count,
                        pickedIds: [],
                    },
                },
            }
        );
        const { action, calls } = await realise(state);
        expect(action.park).toBe("activation:tapOtherChoice");
        expect(calls).toHaveLength(3);
        expect(calls.every((c) => c.mutation === "selectActivationCost")).toBe(
            true
        );
        // Never the source itself (CR 118.8 — "other" permanents).
        expect(calls.map((c) => c.args.cardInstanceId)).not.toContain("hoj");
    });

    it("submits only the picks still MISSING on a partly-paid tap-other cost", async () => {
        const leg = HAND_OF_JUSTICE.activatedAbilities![0].cost.tapOtherFilter!;
        const already = inst(LIONS, "w1");
        already.isTapped = true;
        const state = baseState(
            {
                battlefield: [
                    inst(HAND_OF_JUSTICE.id, "hoj"),
                    already,
                    inst(LIONS, "w2"),
                    inst(CRUSADER, "w3"),
                    inst(CRUSADER, "w4"),
                ],
            },
            {
                pendingActivation: {
                    playerId: BOT,
                    cardInstanceId: "hoj",
                    abilityId: HAND_OF_JUSTICE.activatedAbilities![0].id,
                    manaCost: {},
                    tappedLandIds: [],
                    tapSource: true,
                    sacrificeSource: false,
                    tapOtherChoice: {
                        filter: leg.filter,
                        count: leg.count,
                        pickedIds: ["w1"],
                    },
                },
            }
        );
        const { calls } = await realise(state);
        // One already recorded → exactly two more, and never a re-submission of
        // the recorded pick (the server rejects that).
        expect(calls).toHaveLength(2);
        expect(calls.map((c) => c.args.cardInstanceId)).not.toContain("w1");
    });

    it("Night Soil shape — answers the graveyard-exile park from ONE graveyard (CR 118.5)", async () => {
        const state = makeState({
            players: [
                makePlayer(HUMAN, {
                    graveyard: [
                        makeInstance(BEAR, {
                            id: "hg1",
                            controllerId: HUMAN,
                            ownerId: HUMAN,
                            zone: "graveyard",
                        }),
                        makeInstance(WURM, {
                            id: "hg2",
                            controllerId: HUMAN,
                            ownerId: HUMAN,
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer(BOT, {
                    graveyard: [inst(BEAR, "bg1", "graveyard")],
                    battlefield: [inst(BEAR, "src")],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            pendingActivation: {
                playerId: BOT,
                cardInstanceId: "src",
                abilityId: "a1",
                manaCost: {},
                tappedLandIds: [],
                tapSource: false,
                sacrificeSource: false,
                exileFromGraveyardChoice: { count: 2, cardType: "Creature" },
            },
        });
        const { action, calls } = await realise(state);
        expect(action.park).toBe("activation:exileFromGraveyardChoice");
        expect(calls).toHaveLength(1);
        // The whole cost comes from ONE graveyard, and the opponent's is
        // preferred (their graveyard is a resource the bot wants gone).
        expect(calls[0].mutation).toBe("selectActivationExileCost");
        expect(calls[0].args.graveyardOwnerId).toBe(HUMAN);
        expect(calls[0].args.cardInstanceIds).toEqual(["hg1", "hg2"]);
    });
});

describe("cast parks the bot used to stall on (CR 601.2f / 117.9 / 118.9)", () => {
    it("Metamorphosis — answers the cast-side sacrifice park (CR 601.2f)", async () => {
        const state = baseState(
            {
                hand: [inst(METAMORPHOSIS.id, "meta", "hand")],
                battlefield: [inst(BEAR, "bear"), inst(WURM, "wurm")],
            },
            {
                pendingCast: {
                    playerId: BOT,
                    cardInstanceId: "meta",
                    manaCost: {},
                    tappedLandIds: [],
                    sacrificeSelection: {
                        playerId: BOT,
                        reason: "Metamorphosis",
                        requirements: [
                            {
                                filter: METAMORPHOSIS.additionalCosts!
                                    .sacrificeFilter!,
                                count: 1,
                                snapshot: true,
                            },
                        ],
                        picked: [],
                    },
                },
            }
        );
        const { action, calls } = await realise(state);
        expect(action.park).toBe("cast:sacrificeSelection");
        expect(calls).toEqual([
            { mutation: "selectSacrifice", args: { cardInstanceId: "bear" } },
        ]);
    });

    it("Soul Exchange — answers the exile additional-cost park (CR 117.9)", async () => {
        const state = baseState(
            {
                hand: [inst(SOUL_EXCHANGE.id, "soul", "hand")],
                battlefield: [inst(BEAR, "bear"), inst(WURM, "wurm")],
            },
            {
                pendingCast: {
                    playerId: BOT,
                    cardInstanceId: "soul",
                    manaCost: {},
                    tappedLandIds: [],
                    additionalCost: {
                        kind: "exile",
                        filter: SOUL_EXCHANGE.additionalCosts!.exileFilter!,
                    },
                },
            }
        );
        const { action, calls } = await realise(state);
        expect(action.park).toBe("cast:additionalCost");
        expect(calls).toEqual([
            {
                mutation: "selectAdditionalCost",
                args: { cardInstanceId: "bear" },
            },
        ]);
    });

    it("Force of Will — answers the alternative-cost HAND leg (CR 118.9)", async () => {
        // UNIT-LEVEL ONLY, by design (issue #1209 AC): no `Move` reaches this
        // park today — `moves.ts` has zero `additionalCosts` references, so the
        // enumerator never emits an alt-cost / kicker-paid cast. The branch
        // ships because the census forces its classification; it becomes
        // reachable end to end when #2081 / #2135 land the enumerator variants.
        const state = baseState(
            {
                hand: [
                    inst(FORCE_OF_WILL.id, "fow", "hand"),
                    // TWO distinct blue cards: a real choice, so the server
                    // does not auto-fill the picker.
                    inst(COUNTERSPELL, "cs", "hand"),
                    inst(UNSUMMON, "uns", "hand"),
                    inst(BEAR, "bear", "hand"),
                ],
            },
            {
                pendingCast: {
                    playerId: BOT,
                    cardInstanceId: "fow",
                    manaCost: {},
                    tappedLandIds: [],
                    alternativeCostHandChoice: {
                        action: "exile",
                        excludeInstanceId: "fow",
                        requirements: [{ filter: { color: "U" }, count: 1 }],
                    },
                },
            }
        );
        const { action, calls } = await realise(state);
        expect(action.park).toBe("cast:alternativeCostHandChoice");
        expect(calls).toHaveLength(1);
        expect(calls[0].mutation).toBe("selectCastAlternativeHandCost");
        // Never the spell itself (CR 601.2b).
        expect(calls[0].args.cardInstanceIds).not.toContain("fow");
        // Cheapest blue card first: Unsummon (mv 1) over Counterspell (mv 2).
        expect(calls[0].args.cardInstanceIds).toEqual(["uns"]);
    });
});

describe("park ordering and the parks that keep their tuned answer", () => {
    it("answers the FIRST park in gate order when two are owed", async () => {
        const state = baseState(
            {
                hand: [inst(METAMORPHOSIS.id, "meta", "hand")],
                battlefield: [inst(BEAR, "bear"), inst(WURM, "wurm")],
            },
            {
                pendingCast: {
                    playerId: BOT,
                    cardInstanceId: "meta",
                    manaCost: {},
                    tappedLandIds: [],
                    sacrificeSelection: {
                        playerId: BOT,
                        reason: "Metamorphosis",
                        requirements: [
                            { filter: { types: "Creature" }, count: 1 },
                        ],
                        picked: [],
                    },
                    // A mana-spend park is ALSO set: it must wait, because the
                    // gate only reaches it once every pick park is answered.
                    manaSpendChoice: { generic: 1, candidateColors: ["G"] },
                },
            }
        );
        const { action } = await realise(state);
        expect(action.park).toBe("cast:sacrificeSelection");
    });

    it("leaves the mana-spend park to its tuned branch (#1446)", () => {
        const state = baseState(
            { hand: [inst(BEAR, "h-bear", "hand")] },
            {
                pendingCast: {
                    playerId: BOT,
                    cardInstanceId: "spell",
                    manaCost: {},
                    tappedLandIds: [],
                    manaSpendChoice: {
                        generic: 1,
                        candidateColors: ["G", "R"],
                    },
                },
            }
        );
        const action = botActionOn(state);
        expect(action.kind).toBe("resolve-mana-spend");
        expect(PARK_ANSWER_ROUTE["cast:manaSpendChoice"]).toBe("dedicated");
    });

    it("takes no park action when the bot owes nothing", () => {
        const state = baseState({ hand: [inst(BEAR, "h-bear", "hand")] }, {});
        const action = botActionOn(state);
        expect(action.kind).not.toBe("pay-owed-payment");
    });
});
