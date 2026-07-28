// Integration: Leovold, Emissary of Trest's "whenever you or a permanent you
// control becomes the target of a spell or ability an opponent controls, you may
// draw a card" (CR 603.2b, issue #1265) driven through the REAL cast choke point
// (`emitSpellCastEvent`) and drained by the bot / solo driver without stalling.
//
// The per-card GRE test (`cn2/__tests__/multicolor.test.ts`) emits BECAME_TARGET
// directly; this test crosses the full GRE → game.ts → driver boundary the
// project's mandatory-e2e rule requires: an OPPONENT casts a real spell that
// locks a target onto its stack item (the `emitSpellCastEvent` target-declaration
// choke that fires `emitBecameTargetEvents`), Leovold's may-draw surfaces to the
// bot through `buildBotView`, and the bot accepts + drains it through the SAME
// `submitMayPay` mutation surface a human's Pay button drives. It also asserts
// the opponent-only filter: the controller's OWN targeting spell does not fire.

import { describe, expect, it } from "vitest";
import { getCardByName, registerTokenDefinition } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import {
    emitSpellCastEvent,
    processPendingActionTriggers,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "@convex/gre/state";
import { applyMayPaySubmit } from "@convex/gre/pendingChoiceSubmit";
import { projectPublicState } from "@convex/gameProjections";
import type { EffectOp } from "@convex/cards/types";
import { chooseOwedChoiceAction } from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";

const BOT = "u1-p2";
const HUMAN = "u1-p1";
const LEOVOLD = getCardByName("Leovold, Emissary of Trest").id;
const BEARS = getCardByName("Balduvian Bears").id;

/** A trivial opponent spell used only as a real cast that locks a permanent
 *  target — enough to exercise `emitSpellCastEvent`'s target-declaration choke.
 *  Registered under a test id so the catalogue sweep never sees it; the spell is
 *  never resolved (Leovold's trigger sits above it), so the effect body is
 *  immaterial. */
function registerTargetedSpell(id: string): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { U: 1 },
        types: ["Instant"],
        targetRequirement: { type: "any", count: 1 },
        effects: [{ op: "draw", player: "controller", count: 1 } as EffectOp],
    });
    return id;
}

/** Cast a real spell controlled by `caster` targeting the permanent `targetId`
 *  through the production cast choke (`emitSpellCastEvent`), then flush triggers
 *  and resolve the top of the stack (Leovold's became-target trigger, if any). */
function castTargetingLeovold(
    state: GameState,
    spellId: string,
    caster: string,
    targetId: string
): void {
    const item: StackItem = {
        ...makeInstance(spellId, {
            controllerId: caster,
            ownerId: caster,
            zone: "stack",
        }),
        castById: caster,
        targets: [{ type: "permanent", id: targetId }],
    };
    state.stack.push(item);
    // CR 601.2i / 603.2b — the cast makes the spell a public object and locks
    // its targets, firing BECAME_TARGET for the targeted permanent's controller.
    emitSpellCastEvent(state, item);
    // Leovold's trigger goes ON the stack (above the spell). Resolving the top
    // runs its Effect Script and suspends on the optional "Draw a card?" may-pay.
    processPendingActionTriggers(state);
    resolveTopOfStack(state);
}

/** Seed: the BOT controls Leovold; the HUMAN casts a real spell targeting it. */
function seedBotLeovoldTargetedByHuman(): GameState {
    const spellId = registerTargetedSpell("test-leovold-bt-human-cast");
    const leo = makeInstance(LEOVOLD, {
        id: "leo",
        controllerId: BOT,
        ownerId: BOT,
        zone: "battlefield",
    });
    const top = makeInstance(BEARS, {
        id: "bot-top",
        ownerId: BOT,
        zone: "library",
    });
    const state = makeState({
        players: [
            makePlayer(HUMAN, { life: 20 }),
            makePlayer(BOT, {
                battlefield: [leo],
                library: [top],
                life: 20,
            }),
        ],
        activePlayerId: HUMAN,
        priorityPlayerId: HUMAN,
    });
    castTargetingLeovold(state, spellId, HUMAN, "leo");
    return state;
}

/** Fake mutation surface routing `submitMayPay` through the SAME engine
 *  primitive `game.ts` calls. Every other mutation is unexpected here and throws
 *  (a bot that reached for another mutation would be a real regression). */
function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error("unexpected mutation in Leovold may-draw flow");
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

describe("Leovold became-target may-draw — real cast + bot driver (CR 603.2b, issue #1265)", () => {
    it("surfaces the may-draw to the bot after a REAL opponent cast targets Leovold", () => {
        const state = seedBotLeovoldTargetedByHuman();
        // The optional draw suspended as a may-pay owed by Leovold's controller.
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(state.pendingChoices?.[0]?.playerId).toBe(BOT);

        // It survives projection and reaches the bot view as an affordable
        // (cost-free) may-pay — the drop-a-reducer bug class this test guards.
        const projected = projectPublicState(state, 2, BOT);
        const view = buildBotView(projected, BOT);
        expect(view.owedChoice?.kind).toBe("may-pay");
        expect(view.owedChoice?.affordable).toBe(true);
    });

    it("the bot accepts and drains the choice without stalling (draws a card)", async () => {
        const state = seedBotLeovoldTargetedByHuman();
        const projected = projectPublicState(state, 2, BOT);
        const view = buildBotView(projected, BOT);

        const action = chooseOwedChoiceAction(view.owedChoice!);
        expect(action.kind).toBe("may-pay");
        if (action.kind !== "may-pay") throw new Error("expected may-pay");
        expect(action.accept).toBe(true);

        const move = botActionToMove(action, projected, BOT);
        expect(move).not.toBeNull();
        await executeMove(move!, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        // No freeze: the choice drained and the bot drew its top card.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[1].hand.map((c) => c.id)).toContain("bot-top");
    });

    it("declining the may-draw draws nothing (both branches legal)", () => {
        const state = seedBotLeovoldTargetedByHuman();
        applyMayPaySubmit(state, { playerId: BOT, accept: false });
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("the controller's OWN spell targeting their own Leovold does NOT trigger (opponent-only filter)", () => {
        const spellId = registerTargetedSpell("test-leovold-bt-own-cast");
        const leo = makeInstance(LEOVOLD, {
            id: "leo",
            controllerId: BOT,
            ownerId: BOT,
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer(HUMAN, { life: 20 }),
                makePlayer(BOT, {
                    battlefield: [leo],
                    library: [
                        makeInstance(BEARS, {
                            id: "bot-top",
                            ownerId: BOT,
                            zone: "library",
                        }),
                    ],
                    life: 20,
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        // BOT casts its OWN spell at its OWN Leovold — same-controller source,
        // so the "an opponent controls" filter rejects it: no trigger, nothing
        // for the driver to drain, no stall.
        castTargetingLeovold(state, spellId, BOT, "leo");
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "leovold-target-draw"
            )
        ).toBe(false);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});
