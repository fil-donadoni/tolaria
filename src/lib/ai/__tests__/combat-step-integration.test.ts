// Integration: the bot never passes priority into a combat-step rejection
// across the GRE → projection → driver-gate boundary.
//
// Regression for the freeze where the bot, holding priority on entering a combat
// sub-step (CR 508–510 give the active player priority there), kept calling
// `passPriority` while the server rejected it ("Must declare blockers…" /
// "Must assign combat damage…"), looping forever. The gate must instead WAIT
// (attacker, blocks pending) or CONFIRM (damage assigner). This drives the same
// pure `projectPublicState` + `buildBotView` + `decideBotAction` the live driver
// uses, against a state that has crossed the real wire projection — so the
// combat flags the gate reads cannot be silently stripped on the way to the
// client ("passes in isolation, freezes together").

import { describe, expect, it } from "vitest";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { decideBotAction } from "../brain";
import { buildBotView } from "../bot-view";

const HUMAN = "u1-p1";
const BOT = "u1-p2";

describe("bot combat-step gate survives the wire projection", () => {
    it("confirms damage as the multi-block assigner instead of passing", () => {
        // Bot is the active attacker in COMBAT_DAMAGE; a multi-block attacker
        // needs manual assignment, so the engine opened the step
        // (`damageConfirmed === false`) and named the bot its assigner.
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            players: [makePlayer(HUMAN), makePlayer(BOT)],
            combat: {
                attackerIds: ["a1"],
                confirmed: true,
                blockerAssignments: { b1: ["a1"], b2: ["a1"] },
                blockersConfirmed: true,
                damageAssignments: { a1: { b1: 1, b2: 1 } },
                damageConfirmed: false,
                damageAssignerIds: { a1: BOT },
                damageAssignmentConfirmedBy: [],
            },
        });

        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.damageConfirmed).toBe(false);
        expect(view.botOwesDamageConfirm).toBe(true);
        expect(decideBotAction(view)).toEqual({
            kind: "confirm-combat-damage",
        });
    });

    it("does not re-confirm damage it has already confirmed (waits)", () => {
        // Banding can split assignment between players; once the bot confirmed
        // its portion it must wait for the other assigner, not loop confirming.
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            players: [makePlayer(HUMAN), makePlayer(BOT)],
            combat: {
                attackerIds: ["a1"],
                confirmed: true,
                blockerAssignments: { b1: ["a1"] },
                blockersConfirmed: true,
                damageConfirmed: false,
                damageAssignerIds: { a1: BOT, b1: HUMAN },
                damageAssignmentConfirmedBy: [BOT],
            },
        });

        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.botOwesDamageConfirm).toBe(false);
        expect(decideBotAction(view)).toEqual({ kind: "none" });
    });

    it("waits as the attacker while the defender's blocks are unconfirmed", () => {
        // On entering DECLARE_BLOCKERS the attacker (bot) holds priority, but a
        // pass is rejected until blocks are confirmed — the human blocks first.
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            players: [makePlayer(HUMAN), makePlayer(BOT)],
            combat: {
                attackerIds: ["a1"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });

        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.blockersConfirmed).toBe(false);
        expect(decideBotAction(view)).toEqual({ kind: "none" });
    });
});
