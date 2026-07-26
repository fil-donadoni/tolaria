// CR 601.2g (issue #1446, parent PRD #1442) — the bot's resolution of the
// parked generic-mana spend choice #1444 shipped (`manaSpendChoice` on
// `pendingCast`/`pendingActivation`, resolved via `resolveManaSpendChoice`).
// Without this the bot would sit stalled: the parked cast/activation blocks
// `passPriority` and the choice lives OUTSIDE `pendingChoices[]`, so no prior
// bot code ever saw it (the same "new waiting state the driver doesn't know
// about" class the attack-tax park closed for CR 508.1c/1g).
//
// Deterministic single-scenario test (not self-play, per project convention):
// builds a real `GameState` with the choice parked, projects it through
// `projectPublicState` (the real wire boundary), and drives
// `buildBotView` → `decideBotAction` — proving (a) the bot picks a spend order
// and the action is realisable (no stall), and (b) the flexibility heuristic
// spends the candidate color LEAST useful to the bot's other remaining hand
// spells first, preserving the color(s) it still needs.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { validateManaSpendOrder, type PendingCast } from "@convex/gre/state";
import { decideBotAction, botActionRealisation } from "../brain";
import { buildBotView } from "../bot-view";

const BOT = "u1-p2";
const HUMAN = "u1-p1";

const ORNITHOPTER = getCardByName("Ornithopter").id; // the parked spell itself
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id; // {1}{G} — needs G
const UNSUMMON = getCardByName("Unsummon").id; // {U} — needs U

/** A pool `{U:1,G:1}` with a spell owing `{1}` generic parked as the bot's OWN
 *  cast — the exact ambiguous shape `convex/__tests__/manaSpendChoice.test.ts`
 *  exercises server-side (2 colors present, 1 generic owed, both leftover
 *  shapes reachable). `otherHandCardId` is the second hand card (excluded from
 *  the parked cast itself) whose color need drives the flexibility heuristic. */
function parkedCastState(otherHandCardId: string) {
    const cast = makeInstance(ORNITHOPTER, {
        id: "cast",
        controllerId: BOT,
        ownerId: BOT,
        zone: "hand",
    });
    const other = makeInstance(otherHandCardId, {
        id: "other",
        controllerId: BOT,
        ownerId: BOT,
        zone: "hand",
    });
    const pendingCast: PendingCast = {
        playerId: BOT,
        cardInstanceId: "cast",
        manaCost: { X: 1 },
        tappedLandIds: [],
        // The parked choice itself (CR 601.2g) — hand-set directly since the
        // parking logic (genericSpendAmbiguity → tryAutoCommitPendingCast) is
        // already covered by #1444's own integration test; this test is about
        // the BOT'S read + decision over an already-parked choice.
        manaSpendChoice: { generic: 1, candidateColors: ["U", "G"] },
    };
    const bot = makePlayer(BOT, {
        hand: [cast, other],
        manaPool: { W: 0, U: 1, B: 0, R: 0, G: 1, C: 0 },
    });
    const state = makeState({
        players: [bot, makePlayer(HUMAN)],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        pendingCast,
    });
    return state;
}

describe("bot resolves the parked generic-mana spend choice (CR 601.2g, issue #1446)", () => {
    it("picks a spend order and the action is realisable (no stall)", () => {
        const state = parkedCastState(GRIZZLY_BEARS);
        const publicState = projectPublicState(state, 1, BOT);
        const view = buildBotView(publicState, BOT);
        expect(view.manaSpendChoice).toBeDefined();

        const action = decideBotAction(view);
        expect(action.kind).toBe("resolve-mana-spend");
        expect(botActionRealisation(action.kind)).toBe("mana-spend");

        // Legal against the parked choice + current pool — the exact gate
        // `resolveManaSpendChoice` runs server-side (CR 601.2g). A legal order
        // here means the parked cast resumes through the SAME finalize path
        // #1444 already proves completes the cast — no stall.
        if (action.kind === "resolve-mana-spend") {
            expect(() =>
                validateManaSpendOrder(
                    view.manaSpendChoice!,
                    action.spendOrder,
                    { U: 1, G: 1 }
                )
            ).not.toThrow();
            expect(action.spendOrder).toHaveLength(1);
        }
    });

    it("spends the color LEAST useful to remaining hand spells (preserve flexibility)", () => {
        // Grizzly Bears in hand needs G; Unsummon does not need U in this
        // branch's hand — U is the disposable color, so the order spends U.
        const stateNeedsGreen = parkedCastState(GRIZZLY_BEARS);
        const viewNeedsGreen = buildBotView(
            projectPublicState(stateNeedsGreen, 1, BOT),
            BOT
        );
        const actionNeedsGreen = decideBotAction(viewNeedsGreen);
        expect(actionNeedsGreen).toEqual({
            kind: "resolve-mana-spend",
            spendOrder: ["U"],
        });

        // Flip which color the OTHER hand card needs (Unsummon needs U, not
        // G) — the heuristic must flip the spend order too, proving it reads
        // the hand's real color requirements rather than a fixed preference.
        const stateNeedsBlue = parkedCastState(UNSUMMON);
        const viewNeedsBlue = buildBotView(
            projectPublicState(stateNeedsBlue, 1, BOT),
            BOT
        );
        const actionNeedsBlue = decideBotAction(viewNeedsBlue);
        expect(actionNeedsBlue).toEqual({
            kind: "resolve-mana-spend",
            spendOrder: ["G"],
        });
    });

    it("is absent when no mana-spend choice is parked for the bot", () => {
        const state = makeState({
            players: [makePlayer(BOT), makePlayer(HUMAN)],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.manaSpendChoice).toBeUndefined();
    });
});
