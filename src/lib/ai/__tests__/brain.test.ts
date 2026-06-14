// Pure bot decision function (ADR 0001, issue #109). Worker-free — exercises
// decideBotAction directly. The pass-only bot keeps, declares nothing, passes.
import { describe, expect, it } from "vitest";
import type { Move } from "@convex/gre";
import { decideBotAction, selectMove, type BotView } from "../brain";

const BOT = "u1-p2";
const HUMAN = "u1-p1";

function view(overrides: Partial<BotView>): BotView {
    return {
        botId: BOT,
        phase: "PRECOMBAT_MAIN",
        priorityPlayerId: HUMAN,
        activePlayerId: HUMAN,
        hasCombat: false,
        attackersConfirmed: false,
        blockersConfirmed: false,
        ...overrides,
    };
}

describe("decideBotAction (pass-only bot, issue #109)", () => {
    it("passes when the bot holds priority", () => {
        expect(decideBotAction(view({ priorityPlayerId: BOT }))).toEqual({
            kind: "pass",
        });
    });

    it("does nothing when the human holds priority", () => {
        expect(decideBotAction(view({ priorityPlayerId: HUMAN }))).toEqual({
            kind: "none",
        });
    });

    it("keeps its opening hand when it is the bot's mulligan declaration", () => {
        expect(
            decideBotAction(
                view({ phase: "MULLIGAN", mulliganDeclaringId: BOT })
            )
        ).toEqual({ kind: "keep" });
    });

    it("does not act on the human's mulligan declaration", () => {
        expect(
            decideBotAction(
                view({ phase: "MULLIGAN", mulliganDeclaringId: HUMAN })
            )
        ).toEqual({ kind: "none" });
    });

    it("does not act while bottoming after a mulligan", () => {
        expect(
            decideBotAction(
                view({
                    phase: "MULLIGAN",
                    mulliganDeclaringId: BOT,
                    mulliganBottoming: true,
                })
            )
        ).toEqual({ kind: "none" });
    });

    it("declares (no) attackers when active in DECLARE_ATTACKERS, unconfirmed", () => {
        expect(
            decideBotAction(
                view({
                    phase: "DECLARE_ATTACKERS",
                    activePlayerId: BOT,
                    priorityPlayerId: BOT,
                    hasCombat: true,
                    attackersConfirmed: false,
                })
            )
        ).toEqual({ kind: "declare-attackers" });
    });

    it("passes (not declare) once attackers are already confirmed", () => {
        expect(
            decideBotAction(
                view({
                    phase: "DECLARE_ATTACKERS",
                    activePlayerId: BOT,
                    priorityPlayerId: BOT,
                    hasCombat: true,
                    attackersConfirmed: true,
                })
            )
        ).toEqual({ kind: "pass" });
    });

    it("declares (no) blockers when defending in DECLARE_BLOCKERS, unconfirmed", () => {
        expect(
            decideBotAction(
                view({
                    phase: "DECLARE_BLOCKERS",
                    activePlayerId: HUMAN,
                    priorityPlayerId: HUMAN,
                    hasCombat: true,
                    blockersConfirmed: false,
                })
            )
        ).toEqual({ kind: "declare-blockers" });
    });

    it("does not declare blockers when the bot is the attacker", () => {
        expect(
            decideBotAction(
                view({
                    phase: "DECLARE_BLOCKERS",
                    activePlayerId: BOT,
                    priorityPlayerId: HUMAN,
                    hasCombat: true,
                    blockersConfirmed: false,
                })
            )
        ).toEqual({ kind: "none" });
    });

    it("never acts once the game is over", () => {
        expect(
            decideBotAction(view({ priorityPlayerId: BOT, gameOver: true }))
        ).toEqual({ kind: "none" });
    });
});

describe("selectMove (random-legal pick, issue #110)", () => {
    const moves: Move[] = [
        { kind: "pass" },
        { kind: "play-land", cardInstanceId: "a" },
        { kind: "play-land", cardInstanceId: "b" },
    ];

    it("returns null for an empty move set", () => {
        expect(selectMove([], 0.5)).toBeNull();
    });

    it("maps rand in [0,1) uniformly across the set", () => {
        expect(selectMove(moves, 0)).toEqual(moves[0]);
        expect(selectMove(moves, 0.5)).toEqual(moves[1]);
        expect(selectMove(moves, 0.99)).toEqual(moves[2]);
    });

    it("clamps rand === 1 to the last move (never out of bounds)", () => {
        expect(selectMove(moves, 1)).toEqual(moves[2]);
    });
});
