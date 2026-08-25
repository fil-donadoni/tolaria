// Bot driver: `mayPayIsAffordable` must read `restrictedMana` (issue #2222).
// Before the fix the affordability gate consulted only the fungible
// `manaPool`, so mana specifically reserved for a cumulative-upkeep payment
// (Snowfall / Adarkar Unicorn, CR 106.6, ADR 0022/0042) was invisible to it —
// the bot declined a `may-pay` it could actually afford and sacrificed the
// permanent instead. The fix (`spendableManaPoolForRestriction`, bot-view.ts)
// mirrors the server's `spendablePoolForRestriction` / `canPayMayPayCost`
// (`convex/gre/state.ts`) exactly: same merge key (fungible pool +
// exact-restriction-match `restrictedMana`), no substitutions — so the gate
// can only become MORE accurate, never more permissive than the server.
//
// Route exercised (issue's reachability analysis, verified live — no exotic
// setup needed): Snowfall's own mana-tap trigger deposits CU-restricted {U}
// into its controller's pool whenever ANY Island they control is tapped for
// mana; the very next upkeep, Snowfall's own cumulative upkeep asks the bot
// to pay {U} — the mana it just generated for exactly this purpose.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import {
    resolveTopOfStack,
    type GameState,
    type ManaRestriction,
    type StackItem,
} from "@convex/gre/state";
import { applyMayPaySubmit } from "@convex/gre/pendingChoiceSubmit";
import { projectPublicState } from "@convex/gameProjections";
import { chooseOwedChoiceAction } from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";

const BOT = "u1-p2";
const HUMAN = "u1-p1";
const SNOWFALL = getCardByName("Snowfall").id;
const ISLAND = getCardByName("Island").id;

/** Fake mutation surface routing `submitMayPay` through the same engine
 *  primitive the real `game.ts` mutation calls. Every other mutation is
 *  unexpected in this flow and throws (mirrors the may-pay sacrifice
 *  integration test's shape, issue #940). */
function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error(
            "unexpected mutation in cumulative-upkeep may-pay flow"
        );
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

/** Seed the bot controlling Snowfall + a tapped Island, fungible mana pool
 *  EMPTY. First resolves Snowfall's own "Island tapped for mana" trigger (the
 *  bot's mundane land tap for a spell would fire this identically) to deposit
 *  the bonus {U} into the bot's `restrictedMana`, then fires Snowfall's
 *  cumulative upkeep so the ONLY thing that can pay it is that deposit.
 *  `retagRestriction` lets the negative test retag the deposit to a
 *  NON-matching restriction after it lands, so it exists but stays
 *  ineligible. */
function seedSnowfall(retagRestriction?: ManaRestriction): GameState {
    const snow = makeInstance(SNOWFALL, {
        id: "snow",
        controllerId: BOT,
        ownerId: BOT,
    });
    const island = makeInstance(ISLAND, {
        id: "island",
        controllerId: BOT,
        ownerId: BOT,
        isTapped: true,
    });
    const state = makeState({
        players: [
            makePlayer(HUMAN, { life: 20 }),
            makePlayer(BOT, { battlefield: [snow, island], life: 20 }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });

    // CR 605 mana-tap trigger — "Island tapped for mana" floats the bonus {U}
    // (ADR 0022 restricted mana, CR 106.6) to its controller, the bot.
    state.stack.push({
        ...snow,
        zone: "stack",
        castById: BOT,
        triggeredAbilityId: "snowfall-island-mana",
        triggerSourceId: "snow",
        triggerEvent: {
            type: "PERMANENT_TAPPED",
            permanentId: "island",
            controllerId: BOT,
            permanentTypes: ["Land"],
            permanentSubtypes: ["Island"],
            forMana: true,
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);

    if (retagRestriction) {
        for (const r of state.players[1].restrictedMana ?? []) {
            r.restriction = retagRestriction;
        }
    }

    // CR 702.24 — Snowfall's own cumulative upkeep, first age counter (×1
    // cost = {U}). Suspends at the may-pay pending choice.
    state.stack.push({
        ...snow,
        zone: "stack",
        castById: BOT,
        triggeredAbilityId: "snowfall-cumulative-upkeep",
        triggerSourceId: "snow",
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: BOT,
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
    return state;
}

describe("mayPayIsAffordable reads restrictedMana (issue #2222, CR 106.6/702.24)", () => {
    it("Snowfall route: bot's CU-restricted Island mana pays its own cumulative upkeep", async () => {
        const state = seedSnowfall();
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        expect(head?.manaRestriction).toBe("cumulative-upkeep");
        // Sanity: the fungible pool is empty — ONLY the restricted deposit can
        // pay. If this ever drifts the test would pass for the wrong reason.
        expect(state.players[1].manaPool.U ?? 0).toBe(0);
        expect(state.players[1].restrictedMana).toEqual([
            expect.objectContaining({
                color: "U",
                amount: 1,
                restriction: "cumulative-upkeep",
            }),
        ]);

        // Projection check (issue #2222) — `restrictedMana` must survive
        // `projectPublicState` for the viewer's OWN entry, or the bot's slim
        // wire view can never see it regardless of the gate fix.
        const projected = projectPublicState(state, 1, BOT);
        expect(projected.players[1].restrictedMana).toEqual(
            state.players[1].restrictedMana
        );

        const view = buildBotView(projected, BOT);
        const action = chooseOwedChoiceAction(view.owedChoice!);
        expect(action.kind).toBe("may-pay");
        if (action.kind !== "may-pay") throw new Error("expected may-pay");
        // THE assertion: the gate reports affordable and the driver accepts —
        // this is the line that goes red without the restrictedMana merge.
        expect(action.accept).toBe(true);

        const move = botActionToMove(action, projected, BOT);
        expect(move).not.toBeNull();
        await executeMove(move!, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        // No freeze, and Snowfall SURVIVES — the CU mana paid the upkeep
        // instead of the enchantment being sacrificed.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[1].battlefield.some((c) => c.id === "snow")).toBe(
            true
        );
        expect(state.players[1].graveyard.some((c) => c.id === "snow")).toBe(
            false
        );
        // The restricted deposit was actually spent (CR 106.6 settlement).
        expect(state.players[1].restrictedMana ?? []).toHaveLength(0);
    });

    it("a NON-matching restricted deposit never over-claims affordability (no over-accept)", () => {
        // Same {U} deposit, but tagged for a DIFFERENT restriction — must NOT
        // count toward Snowfall's cumulative-upkeep leg.
        const state = seedSnowfall("artifact-ability");
        expect(state.players[1].manaPool.U ?? 0).toBe(0);
        expect(state.players[1].restrictedMana?.[0]?.restriction).toBe(
            "artifact-ability"
        );

        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        const action = chooseOwedChoiceAction(view.owedChoice!);
        expect(action.kind).toBe("may-pay");
        if (action.kind !== "may-pay") throw new Error("expected may-pay");
        // The gate must stay conservative: a mismatched restriction is not
        // spendable here, so the bot must decline (never submit a payment
        // the server would reject).
        expect(action.accept).toBe(false);
    });
});
