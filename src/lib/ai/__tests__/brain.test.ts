// Pure bot decision function (ADR 0001, issue #109). Worker-free — exercises
// decideBotAction directly. The pass-only bot keeps, declares nothing, passes.
import { describe, expect, it } from "vitest";
import { decideBotAction, MULLIGAN_FLOOR, type BotView } from "../brain";

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

    it("keeps a reasonable opening hand (>=1 land and >=1 spell)", () => {
        expect(
            decideBotAction(
                view({
                    phase: "MULLIGAN",
                    mulliganDeclaringId: BOT,
                    mulligansTaken: 0,
                    mulliganHand: [
                        { id: "l1", isLand: true },
                        { id: "l2", isLand: true },
                        { id: "s1", isLand: false },
                        { id: "s2", isLand: false },
                    ],
                })
            )
        ).toEqual({ kind: "keep" });
    });

    it("mulligans a hand with zero lands", () => {
        expect(
            decideBotAction(
                view({
                    phase: "MULLIGAN",
                    mulliganDeclaringId: BOT,
                    mulligansTaken: 0,
                    mulliganHand: Array.from({ length: 7 }, (_, i) => ({
                        id: `s${i}`,
                        isLand: false,
                    })),
                })
            )
        ).toEqual({ kind: "mull" });
    });

    it("mulligans an all-lands hand (no spells)", () => {
        expect(
            decideBotAction(
                view({
                    phase: "MULLIGAN",
                    mulliganDeclaringId: BOT,
                    mulligansTaken: 0,
                    mulliganHand: Array.from({ length: 7 }, (_, i) => ({
                        id: `l${i}`,
                        isLand: true,
                    })),
                })
            )
        ).toEqual({ kind: "mull" });
    });

    it("keeps regardless of hand once the mulligan floor is reached (CR 103.5)", () => {
        expect(
            decideBotAction(
                view({
                    phase: "MULLIGAN",
                    mulliganDeclaringId: BOT,
                    mulligansTaken: MULLIGAN_FLOOR,
                    // Unkeepable (0 lands) — but the floor forces a keep.
                    mulliganHand: Array.from({ length: 7 }, (_, i) => ({
                        id: `s${i}`,
                        isLand: false,
                    })),
                })
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

    it("does not act while ANOTHER player is bottoming", () => {
        expect(
            decideBotAction(
                view({
                    phase: "MULLIGAN",
                    mulliganDeclaringId: "",
                    mulliganBottoming: true,
                })
            )
        ).toEqual({ kind: "none" });
    });

    it("submits a bottom-N order when it is the bot's bottoming choice", () => {
        const action = decideBotAction(
            view({
                phase: "MULLIGAN",
                mulliganDeclaringId: "",
                mulliganBottoming: true,
                mulliganBottomCount: 2,
                mulliganHand: [
                    { id: "l1", isLand: true },
                    { id: "l2", isLand: true },
                    { id: "l3", isLand: true },
                    { id: "s1", isLand: false },
                    { id: "s2", isLand: false },
                    { id: "s3", isLand: false },
                    { id: "s4", isLand: false },
                ],
            })
        );
        expect(action.kind).toBe("mulligan-bottom");
        if (action.kind !== "mulligan-bottom") throw new Error("unreachable");
        // Bottoms exactly N cards, all from the hand, no duplicates.
        expect(action.cardInstanceIds).toHaveLength(2);
        expect(new Set(action.cardInstanceIds).size).toBe(2);
        // Sheds excess lands first (3 lands, keep target ~2 → bottom l3).
        expect(action.cardInstanceIds).toContain("l3");
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
