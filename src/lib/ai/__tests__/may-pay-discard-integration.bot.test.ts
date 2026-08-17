// Integration: a may-pay DISCARD cost with a REAL card choice across the
// GRE → game.ts → driver boundary (issue #1507, mirrors #940's sacrifice
// integration test). CR 701.9 / 118.3 — the payer chooses which hand card to
// discard. `botActionToMove` (bot-view.ts) previously spread only
// `sacrificeIds` onto the returned Move, silently dropping `discardIds` —
// `submitMayPay` then threw ("select cards to discard"), the driver caught it,
// reset its signature, and re-answered the SAME state forever (bot freeze).
//
// Formidable Speaker's ETB ("you may discard a card. If you do, search your
// library for a creature card…") with TWO hand cards exercises the pick path:
// the may-pay choice lights up the hand, the brain surfaces the discard
// count + candidates, and the executor must thread a chosen card id through
// the SAME `submitMayPay` mutation surface a human's Pay button drives.

import { describe, expect, it } from "vitest";
import { formidableSpeaker } from "@convex/cards/sets/ecl/green";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import {
    mayPayHandSelectionLegal,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "@convex/gre/state";
import type { MayPayCost } from "@convex/cards/types";
import { applyMayPaySubmit } from "@convex/gre/pendingChoiceSubmit";
import { projectPublicState } from "@convex/gameProjections";
import { chooseOwedChoiceAction } from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";

const BOT = "u1-p2";
const HUMAN = "u1-p1";
// Ancestral Recall (LEA) — a plain Instant, reused as a generic non-creature
// hand-filler card (mirrors ecl/__tests__/green.test.ts).
const ANCESTRAL_RECALL_ID = "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b";
// Grizzly Bears (LEA) — a plain vanilla Creature, reused as the searched-for
// library creature.
const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";
// Forest (LEA) — a basic Land, the bot's cheapest-valued hand card.
const FOREST_ID = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";

/** Fake mutation surface routing `submitMayPay` (with its discard pick)
 *  through the SAME engine primitive the real `game.ts` mutation calls. Every
 *  other mutation is unexpected in this flow and throws. */
function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error("unexpected mutation in may-pay discard flow");
    };
    return {
        playCard: reject,
        summonCompanion: reject,
        announceCast: reject,
        selectTarget: reject,
        selectTargets: reject,
        confirmTargets: reject,
        tapForPayment: reject,
        activateAbility: reject,
        tapForActivationPayment: reject,
        selectSacrifice: reject,
        selectActivationCost: reject,
        selectActivationExileCost: reject,
        selectActivationDiscardCost: reject,
        toggleAttacker: reject,
        confirmAttackers: reject,
        selectBlocker: reject,
        assignBlockerTarget: reject,
        confirmBlockers: reject,
        confirmDamage: reject,
        declareMulligan: reject,
        submitResolutionChoice: reject,
        submitMayPay: async ({
            playerId,
            accept,
            sacrificeIds,
            discardIds,
        }) => {
            applyMayPaySubmit(state, {
                playerId,
                accept,
                sacrificeIds,
                discardIds,
            });
        },
        submitMadnessDecline: reject,
        submitReboundDecline: reject,
        submitDrawReplacementPay: reject,
        submitLandEntryChoice: reject,
        submitNameCard: reject,
        submitRandomRevealAck: reject,
        passPriority: reject,
    };
}

/** Fires Formidable Speaker's self-ETB trigger via the stack, suspending at
 *  the `mayPay` discard offer (mirrors `fireFormidableSpeakerEtb`,
 *  ecl/__tests__/green.test.ts). */
function fireSpeakerEtb(state: GameState, speaker: CardInstanceState): void {
    state.stack.push({
        ...speaker,
        zone: "stack",
        castById: speaker.controllerId,
        triggeredAbilityId: "formidable-speaker-etb",
        triggerSourceId: speaker.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: speaker.id,
            controllerId: speaker.controllerId,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Seed a suspended Formidable Speaker ETB may-pay with TWO discardable hand
 *  cards the BOT controls — a real choice is owed (CR 701.9 / 118.3). */
function seedTwoHandCards(): GameState {
    const speaker = makeInstance(formidableSpeaker.id, {
        id: "speaker",
        controllerId: BOT,
        ownerId: BOT,
    });
    const cardA = makeInstance(ANCESTRAL_RECALL_ID, {
        id: "card-a",
        controllerId: BOT,
        ownerId: BOT,
        zone: "hand",
    });
    const cardB = makeInstance(ANCESTRAL_RECALL_ID, {
        id: "card-b",
        controllerId: BOT,
        ownerId: BOT,
        zone: "hand",
    });
    const libraryCreature = makeInstance(GRIZZLY_BEARS_ID, {
        id: "lib-bear",
        ownerId: BOT,
        zone: "library",
    });
    const state = makeState({
        players: [
            makePlayer(HUMAN, { life: 20 }),
            makePlayer(BOT, {
                battlefield: [speaker],
                hand: [cardA, cardB],
                library: [libraryCreature],
                life: 20,
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    fireSpeakerEtb(state, speaker);
    return state;
}

describe("may-pay discard choice — bot driver (issue #1507, CR 701.9 / 118.3)", () => {
    it("surfaces the discard pick to the bot: count + both candidates", () => {
        const state = seedTwoHandCards();
        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        expect(view.owedChoice?.kind).toBe("may-pay");
        expect(view.owedChoice?.discardCount).toBe(1);
        expect(view.owedChoice?.candidates.map((c) => c.id).sort()).toEqual([
            "card-a",
            "card-b",
        ]);
    });

    it("supplies a legal discard pick and resolves without stalling (no freeze loop)", async () => {
        const state = seedTwoHandCards();
        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        const action = chooseOwedChoiceAction(view.owedChoice!);
        // The action carries a single legal discard pick alongside accept.
        expect(action.kind).toBe("may-pay");
        if (action.kind !== "may-pay") throw new Error("expected may-pay");
        expect(action.accept).toBe(true);
        expect(action.discardIds).toHaveLength(1);
        expect(["card-a", "card-b"]).toContain(action.discardIds![0]);

        const move = botActionToMove(action, projected, BOT);
        expect(move).not.toBeNull();
        // The bug: `botActionToMove` used to drop `discardIds` from the Move.
        if (move!.kind !== "may-pay") throw new Error("expected may-pay move");
        expect(move!.discardIds).toEqual(action.discardIds);

        await executeMove(move!, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        // No freeze: the discard was applied (exactly one card left the
        // bot's hand) and play advanced to the follow-on search choice
        // instead of throwing / re-suspending on the same may-pay.
        expect(state.players[1].hand).toHaveLength(1);
        expect(state.pendingChoices?.[0]?.kind).toBe("search-library");
    });
});

// PR #1963 review round 2 — the client Brain was a SECOND, unfixed consumer of
// the may-pay hand leg: `mayPayIsAffordable` keyed off the SUMMED count
// (`hand.length >= total`) and the policy sliced `discardCount` cards off the
// candidate union. Both are wrong for a FILTERED multi-requirement leg, which
// ADR 0079 / #1933 made representable — the first reports a false AFFORDABLE
// (the server's pay path then throws), the second submits a pick the server's
// `mayPayHandSelectionLegal` boundary rejects, whereupon the driver resets its
// signature and re-answers the same state forever (bot freeze). The vs-AI Brain
// runs client-side against these same engine modules (ADR 0074), so this is a
// live path, not dead code.
describe("may-pay FILTERED hand leg — client Brain (CR 701.9 / 118.9, PR #1963)", () => {
    /** "Discard a creature card and another card" (Foil's shape). The creature
     *  requirement is the one a top-N slice of the candidate union misses: the
     *  bot ranks worst-FIRST, and its two cheapest cards are precisely the ones
     *  that do NOT satisfy it. Also unpayable from a creature-less hand,
     *  however many cards that hand holds. */
    const DISCARD_A_CREATURE_AND_ANOTHER: MayPayCost = {
        hand: {
            action: "discard",
            requirements: [
                { filter: { type: "Creature" }, count: 1 },
                { filter: {}, count: 1 },
            ],
        },
    };

    function seedFilteredLeg(
        cost: MayPayCost,
        hand: CardInstanceState[]
    ): GameState {
        const state = makeState({
            players: [
                makePlayer(HUMAN, { life: 20 }),
                makePlayer(BOT, { hand, life: 20 }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        state.pendingChoices = [
            {
                stackItemId: "stack-1",
                step: 0,
                choiceId: BOT,
                playerId: BOT,
                kind: "may-pay",
                count: 1,
                prompt: "Pay the cost?",
                cost,
                zone: "hand",
                candidateIds: hand.map((c) => c.id),
            },
        ];
        return state;
    }

    const handCard = (defId: string, id: string) =>
        makeInstance(defId, {
            id,
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });

    it("supplies a pick the SERVER's submit boundary accepts (no freeze)", () => {
        const state = seedFilteredLeg(DISCARD_A_CREATURE_AND_ANOTHER, [
            // Worst-first ranks the land cheapest, then the spell, then the
            // creature — so the two cheapest cards cover NEITHER requirement's
            // creature clause.
            handCard(FOREST_ID, "forest"),
            handCard(ANCESTRAL_RECALL_ID, "recall"),
            handCard(GRIZZLY_BEARS_ID, "bear"),
        ]);
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.owedChoice?.affordable).toBe(true);

        const action = chooseOwedChoiceAction(view.owedChoice!);
        if (action.kind !== "may-pay") throw new Error("expected may-pay");
        expect(action.accept).toBe(true);
        // The old `worstFirst(candidates).slice(0, discardCount)` returned
        // [forest, recall] here — count-correct, creature requirement
        // uncovered, rejected by the server. The assignment authority spends
        // the bear on the creature requirement and keeps worst-first for the
        // rest.
        expect(action.discardIds).toBeDefined();
        expect(action.discardIds).toHaveLength(2);
        expect(action.discardIds).toContain("bear");
        expect(
            mayPayHandSelectionLegal(
                state,
                BOT,
                DISCARD_A_CREATURE_AND_ANOTHER,
                action.discardIds!
            )
        ).toBe(true);
    });

    it("declines a leg the hand cannot cover, however many cards it holds", () => {
        const state = seedFilteredLeg(DISCARD_A_CREATURE_AND_ANOTHER, [
            handCard(ANCESTRAL_RECALL_ID, "recall-a"),
            handCard(ANCESTRAL_RECALL_ID, "recall-b"),
            handCard(ANCESTRAL_RECALL_ID, "recall-c"),
        ]);
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        // Three cards for a two-card leg — the summed-count check this replaced
        // said AFFORDABLE, the bot accepted, and the server threw.
        expect(view.owedChoice?.affordable).toBe(false);

        const action = chooseOwedChoiceAction(view.owedChoice!);
        if (action.kind !== "may-pay") throw new Error("expected may-pay");
        expect(action.accept).toBe(false);
        expect(action.discardIds).toBeUndefined();
    });
});

describe("may-pay combined sacrifice+discard cost shape (issue #1507 regression)", () => {
    it("botActionToMove propagates BOTH sacrificeIds and discardIds when the brain answers with both", () => {
        // CR 117.3a/118.4/701.21/701.9 — `MayPayCost` allows a sacrifice leg
        // AND a discard leg on the SAME cost (types.ts: "All present legs
        // must be paid together"). Only one leg's PendingChoice ever surfaces
        // a real pick at a time today (state.ts: mutually-exclusive `zone`),
        // but a future card or a bot answer carrying both must not regress
        // to dropping either field — assert the translator is symmetric.
        const state = makeState({
            players: [
                makePlayer(HUMAN, { life: 20 }),
                makePlayer(BOT, { life: 20 }),
            ],
        });
        state.pendingChoices = [
            {
                stackItemId: "stack-1",
                step: 0,
                choiceId: BOT,
                playerId: BOT,
                kind: "may-pay",
                count: 1,
                prompt: "Pay the cost?",
                cost: {
                    permanent: {
                        action: "sacrifice",
                        filter: {},
                        count: 1,
                    },
                    hand: {
                        action: "discard",
                        requirements: [{ filter: {}, count: 1 }],
                    },
                },
            },
        ];
        const projected = projectPublicState(state, 1, BOT);

        const move = botActionToMove(
            {
                kind: "may-pay",
                accept: true,
                sacrificeIds: ["victim"],
                discardIds: ["card-a"],
            },
            projected,
            BOT
        );

        expect(move).not.toBeNull();
        if (move!.kind !== "may-pay") throw new Error("expected may-pay move");
        expect(move!.sacrificeIds).toEqual(["victim"]);
        expect(move!.discardIds).toEqual(["card-a"]);
    });
});
