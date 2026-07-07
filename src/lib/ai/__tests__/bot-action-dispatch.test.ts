// Class-level guard for the recurring "bot freezes on a new choice mechanic"
// bug. The vs-AI driver (`useVsAiDriver`) must route EVERY decided `BotAction`
// to a realiser: the main-thread executor (`botActionToMove` → `executeMove`),
// the Worker search, or a dedicated mutation. Historically the driver kept a
// HAND-MAINTAINED list of executor-realised kinds; a new choice mechanism
// (shock land `land-entry`, `name-card`, `random-reveal-ack`) added a BotAction
// kind that was silently missing from that list, fell through to the Worker,
// and stalled (the Worker surfaces no move while a pending choice is active).
//
// `botActionRealisation` is the compile-time-exhaustive classifier that closes
// the class: a new BotAction kind cannot compile until it is classified here,
// and this test locks the classification so a regression is caught in CI, not
// by a frozen game.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { applyPlayLand } from "@convex/gre/playLand";
import { projectPublicState } from "@convex/gameProjections";
import {
    decideBotAction,
    botActionRealisation,
    type BotAction,
} from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";

// The full BotAction union, split by how the driver must realise each kind.
// Adding a BotAction kind forces a new entry here (the switch in
// `botActionRealisation` won't compile otherwise) — keep this table in sync.
const EXECUTOR_KINDS: BotAction["kind"][] = [
    "keep",
    "mull",
    "mulligan-bottom",
    "resolution-choice",
    "may-pay",
    "land-entry",
    "name-card",
    "random-reveal-ack",
];
const WORKER_KINDS: BotAction["kind"][] = [
    "pass",
    "declare-attackers",
    "declare-blockers",
];

describe("botActionRealisation — driver dispatch classification", () => {
    it("routes every executor-realised choice action to the executor (not the Worker)", () => {
        for (const kind of EXECUTOR_KINDS) {
            expect(botActionRealisation(kind)).toBe("executor");
        }
    });

    it("routes search-driven actions to the Worker", () => {
        for (const kind of WORKER_KINDS) {
            expect(botActionRealisation(kind)).toBe("worker");
        }
    });

    it("classifies the two specials distinctly", () => {
        expect(botActionRealisation("confirm-combat-damage")).toBe(
            "confirm-damage"
        );
        expect(botActionRealisation("none")).toBe("none");
    });

    // The exact regression: the three kinds a new mechanic added over time and
    // the driver forgot. Each MUST be executor-realised or the bot freezes.
    it("land-entry, name-card and random-reveal-ack are executor-realised", () => {
        expect(botActionRealisation("land-entry")).toBe("executor");
        expect(botActionRealisation("name-card")).toBe("executor");
        expect(botActionRealisation("random-reveal-ack")).toBe("executor");
    });
});

describe("bot shock-land choice reaches the executor, not the Worker (CR 614.12)", () => {
    it("the land-entry action the driver decides is executor-realised AND translates to a Move", () => {
        const BOT = "u1-p2";
        const shock = makeInstance(getCardByName("Steam Vents").id, {
            id: "shock",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("u1-p1"),
                makePlayer(BOT, { life: 20, hand: [shock] }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        const bot = state.players.find((p) => p.id === BOT)!;
        applyPlayLand(state, bot, "shock");
        expect(state.pendingChoices?.[0]?.kind).toBe("land-entry-tapped");

        const publicState = projectPublicState(state, 1, BOT);
        const view = buildBotView(publicState, BOT);
        const action = decideBotAction(view);
        expect(action.kind).toBe("land-entry");
        // The driver's dispatch gate: this is what was broken — the action fell
        // through to the Worker and stalled.
        expect(botActionRealisation(action.kind)).toBe("executor");
        // And the executor path can actually realise it.
        expect(botActionToMove(action, publicState, BOT)).not.toBeNull();
    });
});
