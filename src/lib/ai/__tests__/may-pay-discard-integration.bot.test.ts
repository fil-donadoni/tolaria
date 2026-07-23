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
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "@convex/gre/state";
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
        confirmTargets: reject,
        tapForPayment: reject,
        activateAbility: reject,
        tapForActivationPayment: reject,
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

describe("may-pay combined sacrifice+discard cost shape (issue #1507 regression)", () => {
    it("botActionToMove propagates BOTH sacrificeIds and discardIds when the brain answers with both", () => {
        // CR 117.3a/118.4/701.16/701.9 — `MayPayCost` allows a sacrifice leg
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
                    sacrifice: { filter: {}, count: 1 },
                    discard: { count: 1 },
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
