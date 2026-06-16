// Pure bot decision function (ADR 0001, issue #109). Worker-free — exercises
// decideBotAction directly. The pass-only bot keeps, declares nothing, passes.
import { describe, expect, it } from "vitest";
import {
    chooseResolution,
    decideBotAction,
    MULLIGAN_FLOOR,
    type BotView,
    type ChoiceCandidate,
    type OwedChoice,
} from "../brain";

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

// Regression: the active player gets priority on entering each combat sub-step,
// but the server rejects a `passPriority` until the step's turn-based action is
// done. Passing there looped on the rejection and froze the app.
describe("decideBotAction does not pass into a combat-step rejection", () => {
    it("waits (none) as the attacker while blocks are unconfirmed", () => {
        expect(
            decideBotAction(
                view({
                    phase: "DECLARE_BLOCKERS",
                    activePlayerId: BOT,
                    priorityPlayerId: BOT,
                    hasCombat: true,
                    blockersConfirmed: false,
                })
            )
        ).toEqual({ kind: "none" });
    });

    it("passes normally as the attacker once blocks are confirmed", () => {
        expect(
            decideBotAction(
                view({
                    phase: "DECLARE_BLOCKERS",
                    activePlayerId: BOT,
                    priorityPlayerId: BOT,
                    hasCombat: true,
                    blockersConfirmed: true,
                })
            )
        ).toEqual({ kind: "pass" });
    });

    it("confirms combat damage when it owes an assignment (multi-block)", () => {
        for (const phase of ["FIRST_STRIKE_DAMAGE", "COMBAT_DAMAGE"] as const) {
            expect(
                decideBotAction(
                    view({
                        phase,
                        activePlayerId: BOT,
                        priorityPlayerId: BOT,
                        hasCombat: true,
                        damageConfirmed: false,
                        botOwesDamageConfirm: true,
                    })
                )
            ).toEqual({ kind: "confirm-combat-damage" });
        }
    });

    it("waits (none) in a damage step it does not assign rather than passing", () => {
        expect(
            decideBotAction(
                view({
                    phase: "COMBAT_DAMAGE",
                    activePlayerId: BOT,
                    priorityPlayerId: BOT,
                    hasCombat: true,
                    damageConfirmed: false,
                    botOwesDamageConfirm: false,
                })
            )
        ).toEqual({ kind: "none" });
    });

    it("passes normally in a damage step with no open assignment (auto-applied)", () => {
        expect(
            decideBotAction(
                view({
                    phase: "COMBAT_DAMAGE",
                    activePlayerId: BOT,
                    priorityPlayerId: BOT,
                    hasCombat: true,
                    damageConfirmed: undefined,
                })
            )
        ).toEqual({ kind: "pass" });
    });
});

describe("chooseResolution default policy (ADR 0016, issue #162)", () => {
    function owed(overrides: Partial<OwedChoice> = {}): OwedChoice {
        return {
            kind: "search-library",
            min: 1,
            max: 1,
            candidates: [
                { id: "land", value: 8 }, // basic land — low cardValue
                { id: "spell", value: 150 }, // spell/creature — high cardValue
            ],
            ...overrides,
        };
    }

    it("search-library fetches the required count, preferring the higher value", () => {
        // min 1, candidates land-first — the value ordering must still pick the
        // higher-value spell.
        expect(chooseResolution(owed())).toEqual(["spell"]);
    });

    it("search-library fetches the single highest-value candidate", () => {
        // Distinct values: the bot digs out the bomb, not a random non-land.
        expect(
            chooseResolution(
                owed({
                    candidates: [
                        { id: "dud", value: 20 },
                        { id: "bomb", value: 400 },
                        { id: "land", value: 8 },
                    ],
                })
            )
        ).toEqual(["bomb"]);
    });

    it("search-library picks exactly `min` cards in value order", () => {
        const picks = chooseResolution(
            owed({
                min: 2,
                max: 2,
                candidates: [
                    { id: "land1", value: 8 },
                    { id: "spell1", value: 150 },
                    { id: "spell2", value: 150 },
                    { id: "land2", value: 8 },
                ],
            })
        );
        // Two highest-value come first, ties in zone order; deterministic.
        expect(picks).toEqual(["spell1", "spell2"]);
    });

    it("search-library declines legally when min is 0 (optional search)", () => {
        expect(chooseResolution(owed({ min: 0, max: 1 }))).toEqual([]);
    });

    it("throws for the dedicated-path kinds (may-pay / mulligan-bottom)", () => {
        expect(() => chooseResolution(owed({ kind: "may-pay" }))).toThrow(
            /not resolved here/
        );
        expect(() =>
            chooseResolution(owed({ kind: "mulligan-bottom" }))
        ).toThrow(/not resolved here/);
    });
});

describe("chooseResolution remaining zone-pick policies (ADR 0016, issue #165)", () => {
    const cards: ChoiceCandidate[] = [
        { id: "land1", value: 8 },
        { id: "spell1", value: 150 },
        { id: "spell2", value: 150 },
        { id: "land2", value: 8 },
    ];
    const owed = (over: Partial<OwedChoice>): OwedChoice => ({
        kind: "choose-permanents",
        min: 1,
        max: 1,
        candidates: cards,
        ...over,
    });

    it("keep-permanents / keep-hand keep the highest-value `min`", () => {
        for (const kind of ["keep-permanents", "keep-hand"] as const) {
            expect(chooseResolution(owed({ kind, min: 2, max: 2 }))).toEqual([
                "spell1",
                "spell2",
            ]);
        }
    });

    it("sacrifice-permanents / discard-hand shed the lowest-value `min`", () => {
        for (const kind of ["sacrifice-permanents", "discard-hand"] as const) {
            expect(chooseResolution(owed({ kind, min: 2, max: 2 }))).toEqual([
                "land1",
                "land2",
            ]);
        }
    });

    it("neutral picks take exactly `min` candidates in zone order", () => {
        // pick-source: count 1 → first candidate.
        expect(chooseResolution(owed({ kind: "pick-source" }))).toEqual([
            "land1",
        ]);
        // choose-permanents (Clone): count 1 → first candidate.
        expect(chooseResolution(owed({ kind: "choose-permanents" }))).toEqual([
            "land1",
        ]);
    });

    it("range kinds with min 0 resolve to a legal empty submission", () => {
        for (const kind of [
            "untap-pick",
            "partition",
            "choose-hand-card",
        ] as const) {
            expect(chooseResolution(owed({ kind, min: 0, max: 3 }))).toEqual(
                []
            );
        }
    });

    it("reveal-hand acknowledges with an empty submission (count 0)", () => {
        expect(
            chooseResolution(owed({ kind: "reveal-hand", min: 0, max: 0 }))
        ).toEqual([]);
    });

    it("reorder-library puts the best on top (scry, all peeked cards)", () => {
        // CR 401.4 scry/reorder: the highest-value cards go on top so the bot
        // draws its best next; ties keep the exposed order (ADR 0018).
        expect(
            chooseResolution(
                owed({
                    kind: "reorder-library",
                    min: 4,
                    max: 4,
                })
            )
        ).toEqual(["spell1", "spell2", "land1", "land2"]);
    });
});

describe("decideBotAction resolves an owed mid-resolution choice (ADR 0016)", () => {
    it("returns a resolution-choice (not a pass) when the bot is owed a choice", () => {
        const action = decideBotAction(
            view({
                // The engine sets priority to the chooser while a choice is
                // pending; the bot must resolve it, not pass into a no-op.
                priorityPlayerId: BOT,
                owedChoice: {
                    kind: "search-library",
                    min: 1,
                    max: 1,
                    candidates: [{ id: "fetch-me", value: 150 }],
                },
            })
        );
        expect(action).toEqual({
            kind: "resolution-choice",
            cardInstanceIds: ["fetch-me"],
        });
    });

    it("accepts an affordable may-pay and declines an unaffordable one (ADR 0016)", () => {
        const mayPay = (affordable: boolean) =>
            view({
                priorityPlayerId: BOT,
                owedChoice: {
                    kind: "may-pay",
                    min: 1,
                    max: 1,
                    candidates: [],
                    affordable,
                },
            });
        expect(decideBotAction(mayPay(true))).toEqual({
            kind: "may-pay",
            accept: true,
        });
        expect(decideBotAction(mayPay(false))).toEqual({
            kind: "may-pay",
            accept: false,
        });
    });
});
