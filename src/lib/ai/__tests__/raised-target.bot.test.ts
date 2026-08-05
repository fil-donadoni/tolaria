// issue #2283 — the vs-AI bot answers an ENGINE-RAISED target selection.
//
// A raised pending target (CR 603.3d targeted trigger, CR 114.6 retarget,
// CR 707.10b copy retarget) freezes priority on its owner exactly like a
// `PendingChoice`, but nothing on the bot side could see it: `enumerateMoves`
// surfaced no move for ANY live `pendingTarget`, `BotAction` had no member for
// one the bot did not announce, and no bot-side code read
// `PendingTarget.kind === "trigger"` at all. The result was a permanent hang —
// the bot never submitted, never passed, and the human could not advance
// either. Reported on Flickerwisp, Badgermole Cub and Azure Beastbinder.
//
// Everything here runs through the REAL wire boundary
// (`projectPublicState` → `buildBotView` → `decideBotAction` → `executeMove`),
// never a hand-built view: a hand-built view masks exactly the dropped-field
// bug this class of test exists to catch.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { refreshExpectedInput } from "@convex/gre/expectedInput";
import { applyRaisedTargetFinalization } from "@convex/gre/pendingTargetOrigin";
import type { GameState, StackItem } from "@convex/gre/state";
import {
    botActionRealisation,
    chooseOwedTargetAction,
    decideBotAction,
} from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";
import { buildBladeState } from "@convex/gre/ai/blade/runner";
import { runHeadlessGame } from "../selfplay/playGame";

const BOT = "u1-p2";
const HUMAN = "u1-p1";
const BEAR = getCardByName("Grizzly Bears").id;
const WURM = getCardByName("Craw Wurm").id;

/** A board where the BOT controls a triggered ability on the stack that owes a
 *  real target choice: two legal creatures, so the engine's single-legal-target
 *  auto-select (CR 603.3d) never fires — which is exactly why this class stayed
 *  invisible until a card offered a genuine choice. */
function seedRaisedTriggerTarget(): {
    state: GameState;
    trigger: StackItem;
    ids: { bear: string; wurm: string };
} {
    const source = makeInstance(BEAR, {
        id: "src",
        controllerId: BOT,
        ownerId: BOT,
        types: ["Enchantment"],
    });
    const bear = makeInstance(BEAR, {
        id: "bear",
        controllerId: HUMAN,
        ownerId: HUMAN,
    });
    const wurm = makeInstance(WURM, {
        id: "wurm",
        controllerId: HUMAN,
        ownerId: HUMAN,
    });
    const state = makeState({
        players: [
            makePlayer(HUMAN, { battlefield: [bear, wurm] }),
            makePlayer(BOT, { battlefield: [source] }),
        ],
        activePlayerId: HUMAN,
        priorityPlayerId: HUMAN,
    });
    const trigger: StackItem = {
        ...makeInstance(BEAR, { id: "trig", controllerId: BOT, ownerId: BOT }),
        castById: BOT,
        targets: [],
        isTriggeredAbility: true,
        sourceInstanceId: source.id,
    } as StackItem;
    state.stack.push(trigger);
    state.pendingTarget = {
        playerId: BOT,
        cardInstanceId: trigger.id,
        kind: "trigger",
        targetType: "Creature",
        count: 1,
        selected: [],
    };
    // CR 603.3d — the engine hands priority to the trigger's controller while
    // the selection is live (`raiseTriggerTargetSelection`, rules.ts).
    state.priorityPlayerId = BOT;
    refreshExpectedInput(state);
    return { state, trigger, ids: { bear: bear.id, wurm: wurm.id } };
}

/** Fake mutation surface routing `selectTargets` / `confirmTargets` through the
 *  SAME engine primitives the real mutations use. Every other mutation is
 *  unexpected here and throws — a bot reaching for another one would be a real
 *  regression, not a detail. */
function engineMutations(state: GameState, calls: string[]): MoveMutations {
    const reject = () => {
        throw new Error("unexpected mutation in the raised-target flow");
    };
    const surface: Record<string, unknown> = {
        playCard: reject,
        summonCompanion: reject,
        announceCast: reject,
        selectTarget: reject,
        selectTargets: async ({
            targets,
        }: {
            targets: { targetId: string }[];
        }) => {
            calls.push(`selectTargets(${targets.map((t) => t.targetId)})`);
            const pt = state.pendingTarget!;
            pt.selected = [
                ...pt.selected,
                ...targets.map((t) => ({
                    type: "permanent" as const,
                    id: t.targetId,
                })),
            ];
            // Fixed-N auto-finalizes on the last pick, exactly like
            // `applyOneTargetSelection`.
            if (pt.selected.length >= (pt.count as number)) {
                applyRaisedTargetFinalization(state, pt);
            }
        },
        confirmTargets: async () => {
            calls.push("confirmTargets");
            applyRaisedTargetFinalization(state, state.pendingTarget!);
        },
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
        submitMayPay: reject,
        submitMadnessDecline: reject,
        submitReboundDecline: reject,
        submitDrawReplacementPay: reject,
        submitLandEntryChoice: reject,
        submitNameCard: reject,
        submitRandomRevealAck: reject,
        passPriority: reject,
    };
    return surface as unknown as MoveMutations;
}

describe("bot answers an engine-raised target selection (issue #2283)", () => {
    it("the owed selection survives the wire projection and reaches the gate", () => {
        const { state, ids } = seedRaisedTriggerTarget();
        const view = buildBotView(projectPublicState(state, 2, BOT), BOT);
        expect(view.owedTarget?.kind).toBe("trigger");
        // The minimal-legal fallback is precomputed and names a REAL legal
        // target — the projection strips `card.card` to `{ id }`, so a target
        // enumerator reading a fat field would come back empty here.
        expect(view.owedTarget?.submission).not.toBeNull();
        expect([ids.bear, ids.wurm]).toContain(
            view.owedTarget!.submission!.targets[0].id
        );
        expect(view.owedTarget!.submission!.confirmTargets).toBe(false);
    });

    it("REGRESSION: the gate decides an action instead of idling", () => {
        const { state } = seedRaisedTriggerTarget();
        const view = buildBotView(projectPublicState(state, 2, BOT), BOT);
        const action = decideBotAction(view);
        // Before the fix this was `{ kind: "pass" }` → the Worker → no move →
        // nothing; the bot sat on the frozen priority forever.
        expect(action.kind).toBe("search-target");
        expect(botActionRealisation(action.kind)).toBe("worker");
    });

    it("a selection owed to the HUMAN never makes the bot act", () => {
        const { state } = seedRaisedTriggerTarget();
        state.pendingTarget!.playerId = HUMAN;
        state.priorityPlayerId = HUMAN;
        refreshExpectedInput(state);
        const view = buildBotView(projectPublicState(state, 2, BOT), BOT);
        expect(view.owedTarget).toBeUndefined();
        expect(decideBotAction(view).kind).toBe("none");
    });

    it("the bot's OWN half-built cast target stays an atomic executor continuation", () => {
        const { state } = seedRaisedTriggerTarget();
        // Same shape, announced origin: the executor is mid-`cast-spell` and
        // already holds the whole target tuple. Surfacing an action here is the
        // permissive-direction misclassification that would break every
        // existing bot cast.
        state.pendingTarget!.kind = "cast";
        refreshExpectedInput(state);
        const view = buildBotView(projectPublicState(state, 2, BOT), BOT);
        expect(view.owedTarget).toBeUndefined();
        expect(decideBotAction(view).kind).toBe("pass");
    });

    it("the minimal-legal fallback realises through the executor and unfreezes the game", async () => {
        const { state, trigger, ids } = seedRaisedTriggerTarget();
        const projected = projectPublicState(state, 2, BOT);
        const view = buildBotView(projected, BOT);

        // The driver's safety net when the search yields no move.
        const fallback = chooseOwedTargetAction(view.owedTarget!);
        expect(fallback.kind).toBe("submit-target");
        expect(botActionRealisation(fallback.kind)).toBe("executor");

        const move = botActionToMove(fallback, projected, BOT);
        expect(move?.kind).toBe("submit-target");

        const calls: string[] = [];
        await executeMove(move!, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state, calls),
        });

        // A fixed-N selection is ONE batched `selectTargets` and no confirm.
        expect(calls.length).toBe(1);
        expect(calls[0]).toMatch(/^selectTargets\(/);
        expect(state.pendingTarget).toBeUndefined();
        expect(trigger.targets?.length).toBe(1);
        expect([ids.bear, ids.wurm]).toContain(trigger.targets![0].id);
    });

    it("an 'up to N' decline realises as confirm-only (selectTargets rejects an empty array)", async () => {
        const { state, trigger } = seedRaisedTriggerTarget();
        state.pendingTarget!.count = { min: 0, max: 1 };
        refreshExpectedInput(state);
        const projected = projectPublicState(state, 2, BOT);
        const view = buildBotView(projected, BOT);
        const submission = view.owedTarget!.submission!;
        // The enumerator lists the decline first (size 0 before size 1).
        expect(submission.targets).toEqual([]);
        expect(submission.confirmTargets).toBe(true);

        const move = botActionToMove(
            chooseOwedTargetAction(view.owedTarget!),
            projected,
            BOT
        )!;
        const calls: string[] = [];
        await executeMove(move, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state, calls),
        });
        expect(calls).toEqual(["confirmTargets"]);
        expect(state.pendingTarget).toBeUndefined();
        expect(trigger.targets).toEqual([]);
    });
});

describe("headless self-play no longer aborts on a trigger-target window (#2283)", () => {
    it("plays a real Flickerwisp ETB trigger position to a natural end", () => {
        // Built through the production scenario builder + the REAL engine path
        // that raises the selection (`emitPermanentEntered` →
        // `processPendingActionTriggers` → `raiseTriggerTargetSelection`), so
        // the position is the one a live game reaches.
        const state = buildBladeState({
            label: "selfplay-raised-target",
            spec: {
                cards: [
                    {
                        name: "Flickerwisp",
                        owner: "me",
                        zone: "battlefield",
                        summoningSick: false,
                    },
                    {
                        name: "Hill Giant",
                        owner: "opp",
                        zone: "battlefield",
                        summoningSick: false,
                    },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 3,
                landCount: 2,
                libraryCount: 12,
            },
            setup: [{ kind: "etb-trigger", card: "Flickerwisp" }],
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [{ kind: "submit-target" }] },
        });
        expect(state.pendingTarget?.kind).toBe("trigger");

        const [a, b] = state.players.map((p) => p.id);
        const result = runHeadlessGame(
            state,
            { id: a, budget: { iterations: 8 } },
            { id: b, budget: { iterations: 8 } },
            0x51ce
        );
        // The two harness guards this issue is about. Before the fix
        // `decidingPlayer` returned null with no pending choice, which is the
        // loop's "the engine failed to settle" branch — an immediate abort on
        // ply 0.
        expect(result.reason).not.toBe("resolution-error");
        expect(result.reason).not.toBe("stall");
        expect(result.plies).toBeGreaterThan(0);
    });
});
