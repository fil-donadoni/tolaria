// Integration: an activated ability whose cost is paid by NAMING CARDS, across
// the GRE → game.ts → executor boundary (CR 602.1 / 118.3).
//
// Survival of the Fittest ("{G}, Discard a creature card: …") is the reference
// shape. The server always DEFERS that leg: `activateAbility` parks a
// `pendingActivation` carrying an unanswered `discardFilterChoice` and
// `tryAutoCommitPendingActivation` refuses to commit until the activator names
// the card. The bot's executor named nothing — it only ever called
// `activateAbility` + `tapForActivationPayment` — so the activation could never
// commit, the abandoned payment rolled back when the bot next gave up priority
// (`rollbackPendingActivation` untaps the lands), and the identical position
// then re-produced the identical move: the bot tapped a land, untapped it, and
// looped forever without ever activating.
//
// The picks now travel ON the move (`Move.costPicks`), so this test drives the
// REAL server functions the mutations call — `activateAbilityOnState` and
// `selectActivationDiscardCostOnState` — through `executeMove`, and asserts the
// activation actually commits.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { getCardByName } from "@convex/cards";
import { enumerateMoves } from "@convex/gre/moves";
import { planActivationCostPicks } from "@convex/gre/activationCostPicks";
import type { GameState } from "@convex/gre/state";
import {
    activateAbilityOnState,
    selectActivationDiscardCostOnState,
    selectSacrificeOnState,
} from "@convex/game";
import { executeMove, type MoveMutations } from "../executor";

const BOT = "u1-p1";
const HUMAN = "u1-p2";

const SURVIVAL = getCardByName("Survival of the Fittest").id;
const BEARS = getCardByName("Grizzly Bears").id;
const WURM = getCardByName("Craw Wurm").id;

/** A Survival of the Fittest board: the enchantment in play, {G} already in
 *  pool (so the move needs no tap plan and the flow is exactly announce →
 *  name the discard → commit), and two DIFFERENT creatures in hand. */
function survivalState(): GameState {
    return makeState({
        players: [
            makePlayer(BOT, {
                battlefield: [
                    makeInstance(SURVIVAL, {
                        id: "survival",
                        controllerId: BOT,
                        ownerId: BOT,
                    }),
                ],
                hand: [
                    makeInstance(BEARS, {
                        id: "bears",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                    makeInstance(WURM, {
                        id: "wurm",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                ],
                library: [
                    makeInstance(BEARS, {
                        id: "lib-bears",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "library",
                    }),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
            }),
            makePlayer(HUMAN),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
}

/** Mutation surface routing every call the `activate-ability` branch makes
 *  through the SAME pure engine function the real Convex mutation calls. Any
 *  other mutation is unexpected in this flow and throws. */
function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error("unexpected mutation in activation-cost flow");
    };
    return {
        playCard: reject,
        summonCompanion: reject,
        turnPermanentFaceUp: reject,
        announceCast: reject,
        selectTarget: reject,
        selectTargets: reject,
        confirmTargets: reject,
        tapForPayment: reject,
        activateAbility: async ({
            playerId,
            cardInstanceId,
            abilityId,
            chosenX,
            chosenModeId,
        }) => {
            activateAbilityOnState(state, {
                playerId,
                cardInstanceId,
                abilityId,
                ...(chosenX !== undefined ? { chosenX } : {}),
                ...(chosenModeId !== undefined ? { chosenModeId } : {}),
            });
        },
        activateManaAbility: reject,
        tapForActivationPayment: reject,
        selectSacrifice: async ({ playerId, cardInstanceId }) => {
            selectSacrificeOnState(state, { playerId, cardInstanceId });
        },
        selectActivationCost: reject,
        selectActivationExileCost: reject,
        selectActivationDiscardCost: async ({ playerId, cardInstanceIds }) => {
            selectActivationDiscardCostOnState(state, {
                playerId,
                cardInstanceIds,
            });
        },
        toggleAttacker: reject,
        confirmAttackers: reject,
        selectBlocker: reject,
        assignBlockerTarget: reject,
        confirmBlockers: reject,
        confirmDamage: reject,
        declareMulligan: reject,
        submitResolutionChoice: reject,
        submitMayPay: reject,
        submitLandEntryChoice: reject,
        submitDrawReplacementPay: reject,
        submitMadnessDecline: reject,
        submitReboundDecline: reject,
        submitNameCard: reject,
        submitRandomRevealAck: reject,
        passPriority: reject,
    };
}

describe("activation cost picks (CR 602.1 / 118.3)", () => {
    it("enumerates one variant per DISTINCT discard candidate, each carrying its own pick", () => {
        const state = survivalState();
        const activations = enumerateMoves(state, BOT).filter(
            (m) => m.kind === "activate-ability"
        );

        // Two different creatures in hand = two genuinely different decisions
        // (which creature the tutor engine eats), so both are searched.
        expect(activations).toHaveLength(2);
        const picked = activations.map((m) =>
            m.kind === "activate-ability" ? m.costPicks?.discardIds : undefined
        );
        expect(picked).toEqual([["bears"], ["wurm"]]);
    });

    it("executes end to end: the ability commits and the named card is discarded", async () => {
        const state = survivalState();
        const move = enumerateMoves(state, BOT).find(
            (m) => m.kind === "activate-ability"
        )!;
        expect(move).toBeDefined();

        await executeMove(move, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        const bot = state.players.find((p) => p.id === BOT)!;
        // The payment committed: nothing is left parked, so nothing can be
        // rolled back — this is the tap/untap loop's exit condition.
        expect(state.pendingActivation).toBeUndefined();
        // The ability is on the stack (CR 602.2a).
        expect(state.stack).toHaveLength(1);
        // The named creature paid the cost (CR 118.3), the other stayed.
        expect(bot.graveyard.map((c) => c.id)).toEqual(["bears"]);
        expect(bot.hand.map((c) => c.id)).toEqual(["wurm"]);
        // The mana left the pool (CR 601.2h).
        expect(bot.manaPool.G).toBe(0);
    });

    it("the loop is closed: the bot no longer re-produces the same move on an unchanged position", async () => {
        const state = survivalState();
        const before = enumerateMoves(state, BOT).find(
            (m) => m.kind === "activate-ability"
        )!;

        await executeMove(before, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        // Before the fix the activation rolled back and this position was
        // byte-identical to the starting one, so the (seeded, deterministic)
        // search re-chose the same move forever. The state has now advanced:
        // the ability is on the stack and the cost is spent.
        expect(state.stack).toHaveLength(1);
        const again = enumerateMoves(state, BOT).filter(
            (m) => m.kind === "activate-ability"
        );
        // {G} is spent, so the ability is no longer affordable — the bot has
        // moved on rather than re-announcing the same activation.
        expect(again).toHaveLength(0);
    });
});

// The SACRIFICE leg (CR 701.21 / 118.5) is the same bug on the widest surface —
// 44 stack-using abilities in the catalogue carry a `sacrificeFilter`. It only
// defers when the board is NOT fungible (`autoResolveFungible` collapses an
// indistinguishable victim set inline), which is why it survived: with one
// creature out, or two identical ones, the bot was fine.
describe("activation sacrifice cost (CR 701.21 / 118.5)", () => {
    const ANGEL = getCardByName("Fallen Angel").id;

    /** Fallen Angel ("Sacrifice a creature: Fallen Angel gets +2/+0") with two
     *  DIFFERENT creatures alongside it — a real victim choice, so the server
     *  defers instead of auto-resolving. */
    function angelState(): GameState {
        return makeState({
            players: [
                makePlayer(BOT, {
                    battlefield: [
                        makeInstance(ANGEL, {
                            id: "angel",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                        makeInstance(BEARS, {
                            id: "bears",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                        makeInstance(WURM, {
                            id: "wurm",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                }),
                makePlayer(HUMAN),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
    }

    it("enumerates one variant per DISTINCT victim, each naming its own", () => {
        const state = angelState();
        const activations = enumerateMoves(state, BOT).filter(
            (m) => m.kind === "activate-ability"
        );
        // Three legal victims (the Angel may eat itself, CR 701.21a).
        const picked = activations.map((m) =>
            m.kind === "activate-ability"
                ? m.costPicks?.sacrificeIds
                : undefined
        );
        expect(picked).toEqual([["bears"], ["angel"], ["wurm"]]);
    });

    it("executes end to end: the named victim is sacrificed and the ability commits", async () => {
        const state = angelState();
        const move = enumerateMoves(state, BOT).find(
            (m) => m.kind === "activate-ability"
        )!;

        await executeMove(move, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        const bot = state.players.find((p) => p.id === BOT)!;
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(bot.graveyard.map((c) => c.id)).toEqual(["bears"]);
        expect(bot.battlefield.map((c) => c.id).sort()).toEqual([
            "angel",
            "wurm",
        ]);
    });
});

// Issue #1209 — a `tapOtherFilter` cost carrying a COLOURS filter (Hand of
// Justice, "Tap three untapped white creatures you control", CR 118.8) was
// invisible to the pick planner: its candidate scan matched the raw
// `CardInstanceState`, which carries no `colors` field, so the filter matched
// nothing, `planActivationCostPicks` returned null, and `enumerateMoves` treated
// the activation as illegal even with the board full of white creatures. The
// server's own scan (`tapOtherCandidates`, `game.ts`) has always read the
// EFFECTIVE colours through the layer system, so the two disagreed — the
// activation was legal to announce and impossible to plan. Dead for the bot
// rather than stalling, which is why no stall test caught it.
describe("tap-other cost with a colours filter (CR 118.8 / 105.2)", () => {
    const HAND_OF_JUSTICE = getCardByName("Hand of Justice");
    const LIONS = getCardByName("Savannah Lions").id; // {W} 2/1 — white

    /** Hand of Justice with FOUR untapped white creatures alongside it (one
     *  more than the cost needs) and a creature on the other side to target. */
    function handOfJusticeState(): GameState {
        return makeState({
            players: [
                makePlayer(BOT, {
                    battlefield: [
                        makeInstance(HAND_OF_JUSTICE.id, {
                            id: "hoj",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                        ...["w1", "w2", "w3", "w4"].map((id) =>
                            makeInstance(LIONS, {
                                id,
                                controllerId: BOT,
                                ownerId: BOT,
                            })
                        ),
                    ],
                }),
                makePlayer(HUMAN, {
                    battlefield: [
                        makeInstance(BEARS, {
                            id: "bear",
                            controllerId: HUMAN,
                            ownerId: HUMAN,
                        }),
                    ],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
    }

    it("plans the picks for Hand of Justice's white-creature cost", () => {
        const state = handOfJusticeState();
        const source = state.players[0].battlefield.find(
            (c) => c.id === "hoj"
        )!;
        const picks = planActivationCostPicks(
            state,
            state.players[0],
            source,
            HAND_OF_JUSTICE.activatedAbilities![0]
        );
        expect(picks).not.toBeNull();
        expect(picks?.tapOtherIds).toHaveLength(3);
        // Never the source itself (CR 118.8 — "OTHER" permanents).
        expect(picks?.tapOtherIds).not.toContain("hoj");
    });

    // The planner passing is NOT enough: `enumerateMoves` runs its OWN
    // tap-other payability pre-check before it ever calls the planner, and that
    // check had the same raw-instance bug. With it, the bot saw ZERO legal
    // activations for Hand of Justice on a board full of white creatures — the
    // planner's fix was dead code on the real path (issue #1209 review F2).
    it("enumerateMoves emits the activation end to end, carrying the tap picks", () => {
        const state = handOfJusticeState();
        const activations = enumerateMoves(state, BOT).filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.abilityId.startsWith("hand-of-justice")
        );
        expect(activations.length).toBeGreaterThan(0);
        for (const m of activations) {
            const picks =
                m.kind === "activate-ability"
                    ? m.costPicks?.tapOtherIds
                    : undefined;
            expect(picks).toHaveLength(3);
            expect(picks).not.toContain("hoj");
        }
    });
});

// The SAME raw-instance class on the SACRIFICE leg. `enumerateMoves`'s
// `sacrificeFilter` payability pre-check matched the raw `CardInstanceState`
// too, so every colour-filtered sacrifice cost in the catalogue — Thelonite
// Monk ("Sacrifice a green creature"), Homarid Spawning Bed ("a blue
// creature"), Freyalise Supplicant ("a red or white creature") — was invisible
// to the bot even with legal victims on the battlefield (issue #1209 review F2).
describe("sacrifice cost with a colours filter (CR 118.5 / 105.2)", () => {
    const MONK = getCardByName("Thelonite Monk"); // {T}, Sac a green creature
    const FOREST = getCardByName("Forest").id;

    function thelonoiteState(): GameState {
        return makeState({
            players: [
                makePlayer(BOT, {
                    battlefield: [
                        makeInstance(MONK.id, {
                            id: "monk",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                        // Two DIFFERENT green creatures, so the victim choice is
                        // real and the server defers instead of auto-resolving.
                        makeInstance(BEARS, {
                            id: "bears",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                        makeInstance(WURM, {
                            id: "wurm",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                        // A land for the ability's target requirement.
                        makeInstance(FOREST, {
                            id: "forest",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                }),
                makePlayer(HUMAN),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
    }

    it("enumerateMoves emits the activation, carrying a green victim", () => {
        const state = thelonoiteState();
        const activations = enumerateMoves(state, BOT).filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.abilityId.startsWith("thelonite-monk")
        );
        expect(activations.length).toBeGreaterThan(0);
        const picked = activations.flatMap((m) =>
            m.kind === "activate-ability"
                ? (m.costPicks?.sacrificeIds ?? [])
                : []
        );
        // Every victim is green (CR 105.2) — Grizzly Bears, Craw Wurm, or the
        // Monk itself. Never the Forest (a land, not a creature).
        expect(picked.length).toBeGreaterThan(0);
        expect(picked).not.toContain("forest");
    });
});
