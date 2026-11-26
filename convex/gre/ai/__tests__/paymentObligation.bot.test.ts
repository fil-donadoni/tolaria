// CR 603.7a / 104.3e — a delayed "pay or lose the game" obligation its payer
// cannot meet is priced as the loss it is, before it is taken on (issue
// #10818).
//
// THE BUG. Between the resolution that queues the obligation and the upkeep
// that fires it, the leaf saw only the spell's payoff: the rollout policy's
// one-ply probe resolves the cast it probes, scored a free draw, and took it
// — from the `pass` edge too, so `pass` and the cast both sank to the loss
// floor and the margin tie-break picked the cast. The obligation is read in
// the shared leaf (`evaluate`), so the one-ply value and the leaf agree.
//
// The spell here is a free instant: "Draw two cards. At the beginning of your
// next upkeep, pay {2}{G}{G}. If you don't, you lose the game." — the Pact
// cycle's obligation on a payoff the probe can see without a library search.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import type { GameState, DelayedTriggerInstance } from "../../state";
import { forest } from "../../../cards/sets/lea/index.cards";
import { registerTokenDefinition } from "../../../cards";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import { cloneGameState } from "../../clone";
import { applyMoveInSearch, policyValue } from "../../search";
import { evaluate } from "../../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { enumerateMoves, type Move } from "../../moves";
import { holdsUnpayableLossObligation } from "../paymentObligation";

const ME = "p1";
const OPP = "p2";

const OBLIGATION: EffectOp[] = [
    {
        op: "mayPay",
        player: "controller",
        cost: { X: 2, G: 2 },
        prompt: "Pay {2}{G}{G}?",
        bind: "$paid",
    } as EffectOp,
    {
        op: "if",
        predicate: { not: { binding: "$paid" } },
        then: [{ op: "loseGame", player: "controller" }],
    } as EffectOp,
];

const DRAW_THEN_OWE = "test-10818-draw-then-owe";
registerTokenDefinition({
    id: DRAW_THEN_OWE,
    name: DRAW_THEN_OWE,
    rarity: "common",
    manaCost: {},
    types: ["Instant"],
    effects: [
        { op: "draw", player: "controller", count: 2 },
        {
            op: "delayedTrigger",
            timing: "next-upkeep",
            targetPlayer: "controller",
            oracleText:
                "At the beginning of your next upkeep, pay {2}{G}{G}. If you don't, you lose the game.",
            effects: OBLIGATION,
        } as EffectOp,
    ],
} as CardDefinition);

const forests = (n: number, tapped = false) =>
    Array.from({ length: n }, () =>
        makeInstance(forest().id, {
            controllerId: ME,
            ownerId: ME,
            isTapped: tapped,
        })
    );

const library = (owner: string) =>
    Array.from({ length: 10 }, () =>
        makeInstance(forest().id, { controllerId: owner, ownerId: owner })
    );

/** The opponent's postcombat main, the Bot holding the instant with priority
 *  and `n` Forests. */
function position(n: number): GameState {
    return makeState({
        turn: 4,
        phase: "POSTCOMBAT_MAIN",
        activePlayerId: OPP,
        priorityPlayerId: ME,
        players: [
            makePlayer(ME, {
                battlefield: forests(n),
                hand: [
                    makeInstance(DRAW_THEN_OWE, {
                        id: "subject",
                        controllerId: ME,
                        ownerId: ME,
                    }),
                ],
                library: library(ME),
            }),
            makePlayer(OPP, { library: library(OPP) }),
        ],
    });
}

const PASS: Move = { kind: "pass" };

/** The subject's one enumerated cast — the move the search really plays. */
function castOf(state: GameState): Move {
    const casts = enumerateMoves(state, ME).filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === "subject"
    );
    expect(casts).toHaveLength(1);
    return casts[0];
}

/** The rollout policy's one-ply value of `move` (`policyValue`). */
function onePly(state: GameState, move: Move): number {
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, ME, move);
    return policyValue(probe, ME, move, DEFAULT_EVAL_WEIGHTS, ME);
}

/** A queued instance of the obligation, as the resolution leaves it. */
function obligation(
    overrides: Partial<DelayedTriggerInstance> = {}
): DelayedTriggerInstance {
    return {
        id: "delayed-1",
        sourceCardId: DRAW_THEN_OWE,
        triggerId: "inline",
        controller: ME,
        timing: "next-upkeep",
        targetPlayerId: ME,
        payload: {},
        effects: OBLIGATION,
        ...overrides,
    };
}

function owing(
    n: number,
    triggers: DelayedTriggerInstance[],
    over: Partial<GameState> = {}
): GameState {
    const state = position(n);
    state.delayedTriggers = triggers;
    return { ...state, ...over };
}

describe("the one-ply value prices an unpayable pay-or-lose obligation (CR 603.7a, 104.3e)", () => {
    it("scores the cast below passing when three Forests cannot pay the upkeep", () => {
        const state = position(3);
        const cast = onePly(state, castOf(state));
        expect(cast).toBeLessThan(onePly(state, PASS));
        expect(cast).toBeLessThanOrEqual(-DEFAULT_EVAL_WEIGHTS.winScore / 2);
    });

    it("keeps the cast out of the loss band when four Forests pay it — the pair keys on payability", () => {
        const state = position(4);
        expect(onePly(state, castOf(state))).toBeGreaterThan(
            -DEFAULT_EVAL_WEIGHTS.winScore / 2
        );
    });
});

describe("holdsUnpayableLossObligation", () => {
    it("is true when the sources cannot pay, and the leaf reads it as a loss", () => {
        const state = owing(3, [obligation()]);
        expect(holdsUnpayableLossObligation(state, ME)).toBe(true);
        expect(holdsUnpayableLossObligation(state, OPP)).toBe(false);
        expect(evaluate(state, ME)).toBeLessThanOrEqual(
            -DEFAULT_EVAL_WEIGHTS.winScore / 2
        );
        expect(evaluate(state, OPP)).toBeGreaterThanOrEqual(
            DEFAULT_EVAL_WEIGHTS.winScore / 2
        );
    });

    it("reads tapped sources untapped: the untap step precedes the upkeep (CR 502.3)", () => {
        const state = owing(0, [obligation()]);
        state.players[0].battlefield = forests(4, true);
        expect(holdsUnpayableLossObligation(state, ME)).toBe(false);
    });

    it("pays two obligations of the same upkeep as one sum", () => {
        expect(holdsUnpayableLossObligation(owing(4, [obligation()]), ME)).toBe(
            false
        );
        expect(
            holdsUnpayableLossObligation(
                owing(4, [obligation(), obligation({ id: "delayed-2" })]),
                ME
            )
        ).toBe(true);
    });

    it("fails open with the land drop still open on the payer's own turn", () => {
        const state = owing(3, [obligation()], { activePlayerId: ME });
        state.players[0].hand.push(
            makeInstance(forest().id, { controllerId: ME, ownerId: ME })
        );
        expect(holdsUnpayableLossObligation(state, ME)).toBe(false);
    });

    it("fails open on a timing other than the payer's own upkeep", () => {
        expect(
            holdsUnpayableLossObligation(
                owing(3, [obligation({ timing: "next-end-step" })]),
                ME
            )
        ).toBe(false);
    });

    it("is false when the unpaid arm costs something short of the game", () => {
        const lifeOnly: EffectOp[] = [
            OBLIGATION[0],
            {
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [{ op: "loseLife", player: "controller", amount: 3 }],
            } as EffectOp,
        ];
        expect(
            holdsUnpayableLossObligation(
                owing(3, [obligation({ effects: lifeOnly })]),
                ME
            )
        ).toBe(false);
    });
});
