// Integration: a THRESHOLD-mode may-pay sacrifice cost (CR 118 / 701.21,
// Phyrexian Dreadnought) across the GRE → game.ts → driver boundary (issue
// #977). The self-ETB punisher offers "sacrifice it unless you sacrifice any
// number of creatures with total power 12 or greater" — a variable-size victim
// choice whose sacrifice leg is `count: { minTotalPower: 12 }`. The bot/solo
// driver must supply a legal, threshold-reaching pick (or decline) so a vs-AI /
// solo game never stalls on the choice.
//
// The fixed-count analog lives in `may-pay-sacrifice-integration.test.ts`
// (issue #940); this file is its summed-power sibling. Two branches are
// exercised through the SAME `submitMayPay` mutation surface a human's Pay
// button drives:
//   - PAY: enough OTHER creature power exists → the bot greedily sacrifices the
//     highest-power subset reaching 12 and the Dreadnought survives.
//   - SHORTFALL: the other creatures can't reach 12 → the bot declines and the
//     "sacrifice it unless …" clause sacrifices the Dreadnought itself.
//
// CR 118 subtlety (regression guard): the engine lists the Dreadnought among
// its own legal victims (the official ruling lets you pointlessly sacrifice it),
// but a rational bot must NEVER pick it — sacrificing the source to pay a cost
// that keeps the source is self-defeating. The driver excludes the ability
// source from the threshold pool (`mayPaySourceInstanceId`), so the PAY branch
// keeps the Dreadnought and the SHORTFALL branch declines rather than paying by
// self-destruction.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
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
const DREADNOUGHT = getCardByName("Phyrexian Dreadnought").id;
// Vanilla creatures with DISTINCT printed powers so the greedy's
// highest-power-first subset selection is observable (7 + 6 = 13 ≥ 12 leaves
// the two 2/2s behind). Printed power == effective power for these bodies, so
// the bot's PRINTED-power proxy agrees with the server's EFFECTIVE-power gate.
const LADY_ORCA = getCardByName("Lady Orca").id; // 7/7
const CRAW_WURM = getCardByName("Craw Wurm").id; // 6/6
const PEARLED_UNICORN = getCardByName("Pearled Unicorn").id; // 2/2

/** Fake mutation surface routing `submitMayPay` (with its threshold sacrifice
 *  pick) through the SAME engine primitive the real `game.ts` mutation calls.
 *  Every other mutation is unexpected in this flow and throws. */
function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error("unexpected mutation in may-pay threshold flow");
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
        submitMayPay: async ({ playerId, accept, sacrificeIds }) => {
            applyMayPaySubmit(state, { playerId, accept, sacrificeIds });
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

/** Put Phyrexian Dreadnought's self-ETB trigger on the stack and resolve it,
 *  suspending at the threshold may-pay. Mirrors the engine enqueuing the ETB
 *  (CR 603.6a). The stack item id is intentionally distinct from the source
 *  instance id so the source-exclusion is proven to key off `triggerSourceId`,
 *  not an id coincidence. */
function fireDreadnoughtEtb(
    state: GameState,
    dreadnought: CardInstanceState
): void {
    state.stack.push({
        ...dreadnought,
        id: "dreadnought-etb-stack-item",
        zone: "stack",
        castById: dreadnought.controllerId,
        triggeredAbilityId: "phyrexian-dreadnought-etb-sacrifice",
        triggerSourceId: dreadnought.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: dreadnought.id,
            controllerId: BOT,
            types: ["Artifact", "Creature"],
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

function creature(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, { id, controllerId: BOT, ownerId: BOT });
}

/** Seed a suspended Dreadnought threshold may-pay owed to the BOT, with the
 *  given fodder creatures alongside the Dreadnought on the bot's battlefield. */
function seedThresholdChoice(fodder: CardInstanceState[]): {
    state: GameState;
    dreadnought: CardInstanceState;
} {
    const dreadnought = creature(DREADNOUGHT, "dreadnought");
    const state = makeState({
        players: [
            makePlayer(HUMAN, { life: 20 }),
            makePlayer(BOT, {
                battlefield: [dreadnought, ...fodder],
                life: 20,
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    fireDreadnoughtEtb(state, dreadnought);
    return { state, dreadnought };
}

describe("may-pay threshold sacrifice — bot driver (issue #977, CR 118 / 701.21)", () => {
    it("surfaces the threshold pick to the bot without offering the source as a victim", () => {
        const { state } = seedThresholdChoice([
            creature(LADY_ORCA, "orca"),
            creature(CRAW_WURM, "craw"),
            creature(PEARLED_UNICORN, "unicorn-a"),
            creature(PEARLED_UNICORN, "unicorn-b"),
        ]);
        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        expect(view.owedChoice?.kind).toBe("may-pay");
        expect(view.owedChoice?.sacrificeThreshold).toBe(12);
        // The Dreadnought itself is excluded from the pool the bot reasons over
        // (CR 118 self-sacrifice guard); only the fodder creatures remain.
        expect(view.owedChoice?.candidates.map((c) => c.id).sort()).toEqual([
            "craw",
            "orca",
            "unicorn-a",
            "unicorn-b",
        ]);
    });

    it("PAY: greedily sacrifices the highest-power subset reaching 12 and keeps the Dreadnought", async () => {
        const { state } = seedThresholdChoice([
            creature(LADY_ORCA, "orca"), // 7
            creature(CRAW_WURM, "craw"), // 6
            creature(PEARLED_UNICORN, "unicorn-a"), // 2
            creature(PEARLED_UNICORN, "unicorn-b"), // 2
        ]);
        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        const action = chooseOwedChoiceAction(view.owedChoice!);

        expect(action.kind).toBe("may-pay");
        if (action.kind !== "may-pay") throw new Error("expected may-pay");
        expect(action.accept).toBe(true);
        // Greedy highest-power-first: 7 + 6 = 13 ≥ 12 with the fewest bodies,
        // leaving the two 2/2s untouched. The Dreadnought is never picked.
        expect(action.sacrificeIds?.sort()).toEqual(["craw", "orca"]);

        const move = botActionToMove(action, projected, BOT);
        expect(move).not.toBeNull();
        await executeMove(move!, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        // No freeze; the exact victims left and the Dreadnought survived (paid).
        expect(state.pendingChoices).toBeUndefined();
        const bot = state.players[1];
        expect(bot.battlefield.map((c) => c.id).sort()).toEqual([
            "dreadnought",
            "unicorn-a",
            "unicorn-b",
        ]);
        expect(bot.graveyard.map((c) => c.id).sort()).toEqual(["craw", "orca"]);
    });

    it("SHORTFALL: the other creatures can't reach 12, so the bot declines and the Dreadnought is sacrificed", async () => {
        const { state } = seedThresholdChoice([
            creature(PEARLED_UNICORN, "unicorn-a"), // 2
            creature(PEARLED_UNICORN, "unicorn-b"), // 2 — total 4 < 12
        ]);
        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        // Unaffordable once the source is excluded from the threshold pool.
        expect(view.owedChoice?.affordable).toBe(false);
        const action = chooseOwedChoiceAction(view.owedChoice!);

        expect(action.kind).toBe("may-pay");
        if (action.kind !== "may-pay") throw new Error("expected may-pay");
        expect(action.accept).toBe(false);

        const move = botActionToMove(action, projected, BOT);
        expect(move).not.toBeNull();
        await executeMove(move!, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        // No freeze; the "sacrifice it unless …" clause took the Dreadnought
        // (CR 118) and the two 2/2s the bot refused to over-pay survive.
        expect(state.pendingChoices).toBeUndefined();
        const bot = state.players[1];
        expect(bot.battlefield.map((c) => c.id).sort()).toEqual([
            "unicorn-a",
            "unicorn-b",
        ]);
        expect(bot.graveyard.map((c) => c.id)).toContain("dreadnought");
    });
});
