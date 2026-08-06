// Bot integration for Annihilator N's forced sacrifice (CR 702.86a, issue
// #2295).
//
// Two things this proves, neither of which the GRE tests can:
//
//  1. NEVER-FREEZE (ADR 0047). The annihilator trigger parks a
//     `sacrifice-permanents` Pending Choice on the DEFENDING player. When that
//     is the bot, it must answer — and answer through the real path, not a
//     hand-driven `chooseResolution` call: projection → `buildBotView`'s owed
//     choice → `botActionToMove` → `executeMove` → `applyPendingChoiceSubmit`.
//     The choice carries NO filter (CR 702.86a is "N permanents", any type), a
//     shape no shipped card produces, so the bot's battlefield candidate scan
//     has to offer the WHOLE board rather than a type-narrowed slice.
//
//  2. NOT NEUTRAL. A forced multi-permanent sacrifice that the bot answers by
//     shrugging (first-N in zone order) would drain its best permanents as
//     readily as its worst. The assertion is that it keeps the most valuable
//     permanent and sheds the cheap ones — i.e. the `worstFirst` ordering in
//     `chooseResolution` is actually reached with populated candidate values.

import { describe, expect, it } from "vitest";
import { getCardByName, preloadDefinitions } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import type { CardDefinition, GameEvent } from "@convex/cards/types";
import { resolveTopOfStack, type GameState } from "@convex/gre/state";
import { collectTriggers, placeTriggersOnStack } from "@convex/gre/triggers";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { projectPublicState } from "@convex/gameProjections";
import { chooseOwedChoiceAction } from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";

const HUMAN = "u1-p1";
const BOT = "u1-p2";

const ANNIHILATOR_CARD_ID = "synthetic-annihilator-bot";
const FOREST = getCardByName("Forest").id;
const MOUNTAIN = getCardByName("Mountain").id;
const BEARS = getCardByName("Grizzly Bears").id;
const SHIVAN_DRAGON = getCardByName("Shivan Dragon").id;

preloadDefinitions([
    {
        id: ANNIHILATOR_CARD_ID,
        name: "Synthetic Annihilator",
        rarity: "mythic",
        manaCost: { X: 15 },
        types: ["Creature"],
        subtypes: ["Eldrazi"],
        power: 15,
        toughness: 15,
        staticAbilities: ["annihilator 3"],
    } as CardDefinition,
]);

/** Routes `submitResolutionChoice` through the SAME engine primitive the real
 *  `game.ts` mutation calls; every other mutation is unexpected here. */
function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error(
            "unexpected mutation in the annihilator sacrifice flow"
        );
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
        submitResolutionChoice: async (args) => {
            applyPendingChoiceSubmit(state, args);
        },
        submitMayPay: reject,
        submitMadnessDecline: reject,
        submitReboundDecline: reject,
        submitDrawReplacementPay: reject,
        submitLandEntryChoice: reject,
        submitNameCard: reject,
        submitRandomRevealAck: reject,
        passPriority: reject,
    };
}

/** HUMAN attacks with an `annihilator 3` creature; BOT is the defending player
 *  and its board is a deliberate value spread (two lands, a 2/2, a 5/5 flier).
 *  Returns the state suspended on the bot's sacrifice choice. */
function stateOwingBotAnnihilatorSacrifice(): GameState {
    const attacker = makeInstance(ANNIHILATOR_CARD_ID, {
        id: "atk",
        controllerId: HUMAN,
        ownerId: HUMAN,
        isSummoningSick: false,
    });
    // Order matters, and it is chosen adversarially: the MOST valuable
    // permanent sits FIRST in battlefield (= candidate) order, so a neutral
    // "take the first `min` candidates" policy would sacrifice the Dragon.
    // With the Dragon last, `worstFirst` and a neutral slice happen to agree
    // and the test would pass with the valuation disabled — a vacuous
    // assertion (`.claude/rules/gre-development.md` § Proof-of-failure,
    // shape 2).
    const botBoard = [
        [SHIVAN_DRAGON, "bot-dragon"],
        [FOREST, "bot-forest"],
        [MOUNTAIN, "bot-mountain"],
        [BEARS, "bot-bears"],
    ].map(([cardId, id]) =>
        makeInstance(cardId, {
            id,
            controllerId: BOT,
            ownerId: BOT,
            isSummoningSick: false,
        })
    );
    const state = makeState({
        activePlayerId: HUMAN,
        priorityPlayerId: HUMAN,
        phase: "DECLARE_ATTACKERS",
        players: [
            makePlayer(HUMAN, { battlefield: [attacker] }),
            makePlayer(BOT, { battlefield: botBoard }),
        ],
        combat: {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    const event: GameEvent = {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: HUMAN,
        attackerIds: ["atk"],
    };
    placeTriggersOnStack(state, collectTriggers(state, [event]));
    expect(state.stack).toHaveLength(1);
    expect(resolveTopOfStack(state)).toBeNull(); // suspended on the choice
    return state;
}

describe("bot answers Annihilator N's forced sacrifice (CR 702.86a, issue #2295)", () => {
    it("the owed choice reaches the bot's view with the WHOLE board as candidates", () => {
        const state = stateOwingBotAnnihilatorSacrifice();
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.owedChoice).toMatchObject({
            kind: "sacrifice-permanents",
            min: 3,
            max: 3,
        });
        // No filter on the choice → every permanent type is a candidate, not
        // just creatures (CR 702.86a).
        expect(view.owedChoice!.candidates.map((c) => c.id).sort()).toEqual([
            "bot-bears",
            "bot-dragon",
            "bot-forest",
            "bot-mountain",
        ]);
    });

    it("answers it through the real path — no freeze — and keeps its best permanent", async () => {
        const state = stateOwingBotAnnihilatorSacrifice();
        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        const action = chooseOwedChoiceAction(view.owedChoice!);
        expect(action.kind).toBe("resolution-choice");
        const move = botActionToMove(action, projected, BOT)!;
        expect(move).toBeTruthy();

        await executeMove(move, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        // The queue drained and the trigger finished resolving (ADR 0047's
        // never-freeze invariant: an owed choice the bot cannot answer would
        // leave both of these set).
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(0);

        // Exactly three sacrificed, and the survivor is the highest-value
        // permanent — a neutral "first three in zone order" policy would have
        // shed the Dragon along with the lands.
        const bot = state.players.find((p) => p.id === BOT)!;
        expect(bot.graveyard).toHaveLength(3);
        expect(bot.battlefield.map((c) => c.id)).toEqual(["bot-dragon"]);
    });
});
