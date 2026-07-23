// Pure bot decision function (ADR 0001, issue #109). Worker-free — exercises
// decideBotAction directly. The pass-only bot keeps, declares nothing, passes.
import { describe, expect, it } from "vitest";
import {
    chooseResolution,
    decideBotAction,
    LAND_LIGHT_LANDS_IN_PLAY,
    MULLIGAN_FLOOR,
    type BotView,
    type ChoiceCandidate,
    type ManaSituation,
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

// CR 508.1c/1g — the parked per-attacker mana attack tax (Propaganda / Collective
// Restraint). The bot declared a taxed attack and must resolve the parked tax via
// a direct pay/cancel BEFORE any other combat step — re-declaring would be
// rejected by the gate, freezing the bot (the recurring class the exhaustive
// dispatch guard closes).
describe("decideBotAction resolves the parked attack mana tax (#1053/#1066)", () => {
    it("pays the tax (auto-tap) when it is affordable", () => {
        expect(
            decideBotAction(
                view({
                    phase: "DECLARE_ATTACKERS",
                    activePlayerId: BOT,
                    priorityPlayerId: BOT,
                    hasCombat: true,
                    attackManaTaxOwed: true,
                    attackManaTaxAffordable: true,
                })
            )
        ).toEqual({ kind: "pay-attack-tax" });
    });

    it("cancels the whole declaration when the tax is unaffordable", () => {
        expect(
            decideBotAction(
                view({
                    phase: "DECLARE_ATTACKERS",
                    activePlayerId: BOT,
                    priorityPlayerId: BOT,
                    hasCombat: true,
                    attackManaTaxOwed: true,
                    attackManaTaxAffordable: false,
                })
            )
        ).toEqual({ kind: "cancel-attack-tax" });
    });

    it("resolves the tax BEFORE re-declaring attackers (no gate-rejection loop)", () => {
        // combat is unconfirmed and the bot is the active attacker, so the naive
        // path would return declare-attackers again — the tax branch must win.
        const action = decideBotAction(
            view({
                phase: "DECLARE_ATTACKERS",
                activePlayerId: BOT,
                priorityPlayerId: BOT,
                hasCombat: true,
                attackersConfirmed: false,
                attackManaTaxOwed: true,
                attackManaTaxAffordable: true,
            })
        );
        expect(action.kind).not.toBe("declare-attackers");
        expect(action).toEqual({ kind: "pay-attack-tax" });
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

    it("sacrifice-permanents sheds the lowest-value `min`", () => {
        expect(
            chooseResolution(
                owed({ kind: "sacrifice-permanents", min: 2, max: 2 })
            )
        ).toEqual(["land1", "land2"]);
    });

    it("discard-hand without a mana situation falls back to lowest-value `min`", () => {
        // No `manaSituation` (it always accompanies a real discard-hand choice
        // from buildBotView; the policy stays total over its input).
        expect(
            chooseResolution(owed({ kind: "discard-hand", min: 2, max: 2 }))
        ).toEqual(["land1", "land2"]);
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
        for (const kind of ["partition", "choose-hand-card"] as const) {
            expect(chooseResolution(owed({ kind, min: 0, max: 3 }))).toEqual(
                []
            );
        }
    });

    it("legend-keep keeps the highest-value duplicate (CR 704.5j, #378)", () => {
        // Two same-name legends — the bot keeps the better-valued copy (e.g. the
        // one carrying a buff) and lets the engine bin the other.
        expect(
            chooseResolution({
                kind: "legend-keep",
                min: 1,
                max: 1,
                candidates: [
                    { id: "dup-weak", value: 40 },
                    { id: "dup-strong", value: 200 },
                ],
            })
        ).toEqual(["dup-strong"]);
    });

    describe("untap-pick (CR 502.1, Winter Orb / Smoke — issue #325)", () => {
        // The floor is 0, but untapping is pure upside: the bot must untap up to
        // the cap best-first, NEVER submit an empty selection while an eligible
        // permanent is tapped.
        const untap = (
            candidates: ChoiceCandidate[],
            min: number,
            max: number
        ): OwedChoice => ({ kind: "untap-pick", min, max, candidates });

        it("Winter Orb (land cap 1): untaps exactly one — the best land, not zero", () => {
            // min 0, max 1, ≥1 tapped eligible land → pick the highest-value land.
            expect(
                chooseResolution(
                    untap(
                        [
                            { id: "forest", value: 8 },
                            { id: "mox", value: 40 }, // higher-value eligible land
                        ],
                        0,
                        1
                    )
                )
            ).toEqual(["mox"]);
        });

        it("cap exceeds eligible count: untaps all eligible permanents", () => {
            // max 3 but only 2 eligible → untap both (within [min, max]).
            expect(
                chooseResolution(
                    untap(
                        [
                            { id: "c1", value: 10 },
                            { id: "c2", value: 20 },
                        ],
                        0,
                        3
                    )
                )
            ).toEqual(["c2", "c1"]);
        });

        it("Smoke-style creature cap: untaps up to the cap, best-first", () => {
            // creature cap 2 with 3 tapped creatures → pick the two best.
            expect(
                chooseResolution(
                    untap(
                        [
                            { id: "weenie", value: 30 },
                            { id: "dragon", value: 400 },
                            { id: "bears", value: 90 },
                        ],
                        0,
                        2
                    )
                )
            ).toEqual(["dragon", "bears"]);
        });

        it("no eligible candidates: legal empty submission (never throws)", () => {
            expect(chooseResolution(untap([], 0, 1))).toEqual([]);
        });
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

    it("choose-damage-target pings the lowest-value target (Cuombajj Witches)", () => {
        // CR 115.4 — the bot is the opponent choosing where 1 damage lands.
        // Minimal-legal default (ADR 0016): worst-first, so it picks a low-value
        // target (a land-value player marker or a small creature) over a bomb.
        expect(
            chooseResolution(
                owed({
                    kind: "choose-damage-target",
                    candidates: [
                        { id: "bomb", value: 400 },
                        { id: "p1", value: 0 }, // a player target (neutral)
                        { id: "spell1", value: 150 },
                    ],
                })
            )
        ).toEqual(["p1"]);
    });
});

describe("chooseResolution discard heuristic (issue #242, mana-aware)", () => {
    // A land ranks LOWEST by raw card value (value 8); an expensive/uncastable
    // spell ranks high. The pre-#242 worst-first policy therefore shed the land
    // — the exact bug this heuristic fixes.
    const LAND_VALUE = 8;
    const land = (id: string): ChoiceCandidate => ({
        id,
        value: LAND_VALUE,
        isLand: true,
        manaValue: 0,
        colors: [],
    });
    const spell = (
        id: string,
        manaValue: number,
        colors: ChoiceCandidate["colors"] = [],
        value = 150
    ): ChoiceCandidate => ({ id, value, isLand: false, manaValue, colors });

    const discard = (
        candidates: ChoiceCandidate[],
        manaSituation: ManaSituation,
        min = 1
    ): OwedChoice => ({
        kind: "discard-hand",
        min,
        max: min,
        candidates,
        manaSituation,
    });

    it("reported case: 1 land in hand + 1 land in play → discards the spell, keeps the land", () => {
        // The bot is land-light (1 land in play), so the land is the
        // constraining resource. It must shed the (uncastable) spell instead.
        const picks = chooseResolution(
            discard([land("plains"), spell("serra", 5, ["W"])], {
                landsInPlay: 1,
                landsInHand: 1,
                producibleColors: [], // a single untapped Plains still develops mana
            })
        );
        expect(picks).toEqual(["serra"]);
    });

    it("ranks by castability: uncastable spell shed before a castable one of equal cost", () => {
        // Both cost 3; only the off-color one is uncastable given the bot
        // produces only R. Castability dominates raw mana value.
        const picks = chooseResolution(
            discard(
                [spell("castable", 3, ["R"]), spell("uncastable", 3, ["U"])],
                { landsInPlay: 2, landsInHand: 0, producibleColors: ["R"] }
            )
        );
        expect(picks).toEqual(["uncastable"]);
    });

    it("ranks by mana value: among castable spells the most expensive is shed first", () => {
        const picks = chooseResolution(
            discard([spell("cheap", 1, ["R"]), spell("pricey", 6, ["R"])], {
                landsInPlay: 3,
                landsInHand: 0,
                producibleColors: ["R"],
            })
        );
        expect(picks).toEqual(["pricey"]);
    });

    it("keeps the land while land-light even against a cheap castable spell", () => {
        // Land must never be auto-discarded while developing mana.
        const picks = chooseResolution(
            discard([land("mountain"), spell("bolt", 1, ["R"])], {
                landsInPlay: LAND_LIGHT_LANDS_IN_PLAY,
                landsInHand: 1,
                producibleColors: ["R"],
            })
        );
        expect(picks).toEqual(["bolt"]);
    });

    it("land-flooded counter-case: sheds the surplus land", () => {
        // Mana-developed (lands in play above the land-light band) AND two lands
        // in hand → an extra land is a fair pitch, kept ahead of a usable spell.
        const picks = chooseResolution(
            discard(
                [land("extra1"), land("extra2"), spell("usable", 2, ["R"])],
                {
                    landsInPlay: LAND_LIGHT_LANDS_IN_PLAY + 2,
                    landsInHand: 2,
                    producibleColors: ["R"],
                }
            )
        );
        expect(picks).toEqual(["extra1"]);
    });

    it("mana-developed but a lone land in hand is still kept over a spell", () => {
        // Above the land-light band but only one land in hand: a single land is
        // not surplus, so a usable spell is shed first.
        const picks = chooseResolution(
            discard([land("only-land"), spell("usable", 2, ["R"])], {
                landsInPlay: LAND_LIGHT_LANDS_IN_PLAY + 2,
                landsInHand: 1,
                producibleColors: ["R"],
            })
        );
        expect(picks).toEqual(["usable"]);
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

    it("pays an affordable shock land and declines an unaffordable one (CR 614.12, ADR 0051)", () => {
        const landEntry = (affordable: boolean) =>
            view({
                priorityPlayerId: BOT,
                owedChoice: {
                    kind: "land-entry-tapped",
                    min: 1,
                    max: 1,
                    candidates: [],
                    affordable,
                },
            });
        expect(decideBotAction(landEntry(true))).toEqual({
            kind: "land-entry",
            accept: true,
        });
        expect(decideBotAction(landEntry(false))).toEqual({
            kind: "land-entry",
            accept: false,
        });
    });

    it("acknowledges an engine-drawn random-reveal (coin flip, #301)", () => {
        const action = decideBotAction(
            view({
                priorityPlayerId: BOT,
                owedChoice: {
                    kind: "random-reveal",
                    min: 1,
                    max: 1,
                    candidates: [],
                },
            })
        );
        // No decision — the bot just acks to resume (like the human auto-ack).
        expect(action).toEqual({ kind: "random-reveal-ack" });
    });

    it("orders a simultaneous-trigger batch it controls (CR 603.3b, ADR 0058)", () => {
        const action = decideBotAction(
            view({
                priorityPlayerId: BOT,
                owedChoice: {
                    kind: "trigger-order",
                    min: 2,
                    max: 2,
                    candidates: [
                        { id: "t1", value: 0 },
                        { id: "t2", value: 0 },
                    ],
                },
            })
        );
        // Self-ordering own triggers is tactically immaterial (ADR 0058): the
        // bot emits the full slice in collection order — a legal permutation
        // routed through the generic resolution-choice path.
        expect(action).toEqual({
            kind: "resolution-choice",
            cardInstanceIds: ["t1", "t2"],
        });
    });
});

// A CATEGORIZED look-distribute (Atraxa, Grand Unifier — issue #1364) carries
// a constraint the count bounds cannot express: at most one card per category,
// and a card qualifying for several categories may be kept for only ONE of
// them. `max` is the maximum MATCHING, so the ordinary `slice(0, max)` greedy
// would submit three creatures for a max of three — the server rejects it and
// a rejected submission freezes the bot (the recurring "bot stalls on a new
// choice mechanic" class). These pin the categorized branch.
describe("chooseResolution: categorized look-distribute (Atraxa, issue #1364)", () => {
    const owedCategorized = (
        overrides: Partial<OwedChoice> = {}
    ): OwedChoice => ({
        kind: "look-distribute",
        min: 0,
        max: 3,
        candidates: [
            { id: "bomb", value: 200 }, // creature
            { id: "bear", value: 120 }, // creature
            { id: "bolt", value: 90 }, // instant
            { id: "swamp", value: 8 }, // land
        ],
        categories: [
            { label: "Creature", cardIds: ["bomb", "bear"] },
            { label: "Instant", cardIds: ["bolt"] },
            { label: "Land", cardIds: ["swamp"] },
        ],
        ...overrides,
    });

    it("takes the best card of each category, never two of one", () => {
        const picks = chooseResolution(owedCategorized());
        // Value order is bomb > bear > bolt > swamp; "bear" is skipped because
        // the Creature seat is already taken by "bomb".
        expect(picks).toEqual(["bomb", "bolt", "swamp"]);
    });

    it("submits only ONE card when every candidate shares a single category", () => {
        const picks = chooseResolution(
            owedCategorized({
                max: 1,
                candidates: [
                    { id: "c1", value: 100 },
                    { id: "c2", value: 90 },
                ],
                categories: [{ label: "Creature", cardIds: ["c1", "c2"] }],
            })
        );
        expect(picks).toEqual(["c1"]);
    });

    it("respects `max` even when more categories are satisfiable", () => {
        const picks = chooseResolution(owedCategorized({ max: 2 }));
        expect(picks).toEqual(["bomb", "bolt"]);
    });

    it("leaves the uncategorized dig untouched (Impulse / Narset)", () => {
        // No `categories` → the plain greedy, exactly as before.
        const picks = chooseResolution(
            owedCategorized({ categories: undefined, max: 2 })
        );
        expect(picks).toEqual(["bomb", "bear"]);
    });
});
