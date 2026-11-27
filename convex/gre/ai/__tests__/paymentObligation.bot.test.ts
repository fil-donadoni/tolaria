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
import type { GameState, DelayedTriggerInstance, StackItem } from "../../state";
import { forest } from "../../../cards/sets/lea/index.cards";
import { getCardByName, registerTokenDefinition } from "../../../cards";
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

/** The obligation with its `mayPay` cost replaced. */
const withCost = (cost: unknown): EffectOp[] => [
    { ...(OBLIGATION[0] as object), cost } as EffectOp,
    OBLIGATION[1],
];

/** A sorcery that puts a land onto the battlefield — the ramp shape. */
const RAMP = "test-10947-ramp";
registerTokenDefinition({
    id: RAMP,
    name: RAMP,
    rarity: "common",
    manaCost: { X: 1, G: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: { types: ["Land"] },
            count: { min: 0, max: 1 },
            prompt: "Search your library for a land card.",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "battlefield",
        },
    ] as EffectOp[],
} as CardDefinition);

/** "Exile this card from your hand: Add {G}." — a mana ability activated
 *  from the hand (CR 113.6b). */
const HAND_MANA = "test-10947-hand-mana";
registerTokenDefinition({
    id: HAND_MANA,
    name: HAND_MANA,
    rarity: "common",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "hand-mana",
            oracleText: "Exile this card from your hand: Add {G}.",
            cost: { exileThis: true },
            useStack: false,
            manaProduced: { G: 1 },
            activateFromHand: true,
        },
    ],
} as CardDefinition);

/** The obligation as a definition TEMPLATE (`delayedTriggers`), the path a
 *  `resolve()` card schedules, with no inline body on the instance. */
const TEMPLATE_OWER = "test-10947-template-ower";
registerTokenDefinition({
    id: TEMPLATE_OWER,
    name: TEMPLATE_OWER,
    rarity: "common",
    manaCost: {},
    types: ["Instant"],
    delayedTriggers: [
        {
            id: "owe",
            oracleText:
                "At the beginning of your next upkeep, pay {2}{G}{G}. If you don't, you lose the game.",
            timing: "next-upkeep",
            effects: OBLIGATION,
        },
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
/** A stack item of `defId`'s, cast or triggered by its controller. */
function onStack(defId: string, overrides: Partial<StackItem>): StackItem {
    const controller = overrides.controllerId ?? ME;
    return {
        ...makeInstance(defId, {
            controllerId: controller,
            ownerId: controller,
            zone: "stack",
        }),
        castById: controller,
        ...overrides,
    };
}

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

describe("the payer's own turn (issue #10947)", () => {
    /** The Bot's own precombat main, its land drop for the turn spent. */
    const ownTurn = (n: number, landDropSpent = true): GameState => {
        const state = position(n);
        state.activePlayerId = ME;
        state.phase = "PRECOMBAT_MAIN";
        state.players[0].landsPlayedThisTurn = landDropSpent ? 1 : 0;
        return state;
    };

    it("scores the cast in the loss band when nothing can add the fourth source before the upkeep", () => {
        const state = ownTurn(3);
        const cast = onePly(state, castOf(state));
        expect(cast).toBeLessThan(onePly(state, PASS));
        expect(cast).toBeLessThanOrEqual(-DEFAULT_EVAL_WEIGHTS.winScore / 2);
        const owed = ownTurn(3);
        owed.delayedTriggers = [obligation()];
        expect(holdsUnpayableLossObligation(owed, ME)).toBe(true);
    });

    it("fails open with the land drop open and a land in hand — the pair keys on the source it can add", () => {
        const state = ownTurn(3, false);
        state.players[0].hand.push(
            makeInstance(forest().id, { controllerId: ME, ownerId: ME })
        );
        expect(onePly(state, castOf(state))).toBeGreaterThan(
            -DEFAULT_EVAL_WEIGHTS.winScore / 2
        );
        state.delayedTriggers = [obligation()];
        expect(holdsUnpayableLossObligation(state, ME)).toBe(false);
    });

    it("reads a land in hand as no source once the land drop is spent", () => {
        const state = ownTurn(3);
        state.delayedTriggers = [obligation()];
        state.players[0].hand.push(
            makeInstance(forest().id, { controllerId: ME, ownerId: ME })
        );
        expect(holdsUnpayableLossObligation(state, ME)).toBe(true);
    });

    it("fails open on a mana creature castable this turn, not on the opponent's turn (CR 302.1)", () => {
        const elves = () =>
            makeInstance(getCardByName("Llanowar Elves").id, {
                controllerId: ME,
                ownerId: ME,
            });
        const own = ownTurn(3);
        own.delayedTriggers = [obligation()];
        own.players[0].hand.push(elves());
        expect(holdsUnpayableLossObligation(own, ME)).toBe(false);
        const theirs = owing(3, [obligation()]);
        theirs.players[0].hand.push(elves());
        expect(holdsUnpayableLossObligation(theirs, ME)).toBe(true);
    });

    it("fails open on a castable ramp spell, and reads one it cannot pay as no source", () => {
        const own = ownTurn(3);
        own.delayedTriggers = [obligation()];
        own.players[0].hand.push(
            makeInstance(RAMP, { controllerId: ME, ownerId: ME })
        );
        expect(holdsUnpayableLossObligation(own, ME)).toBe(false);
        own.players[0].battlefield = forests(3, true);
        expect(holdsUnpayableLossObligation(own, ME)).toBe(true);
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

    it("reads a summoning-sick mana creature as a source: by the upkeep it can tap (CR 302.6)", () => {
        const state = owing(3, [obligation()]);
        state.players[0].battlefield.push(
            makeInstance(getCardByName("Llanowar Elves").id, {
                controllerId: ME,
                ownerId: ME,
                isSummoningSick: true,
            })
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

    it("reads a mana ability activated from the hand as a source (CR 113.6b)", () => {
        const state = owing(3, [obligation()]);
        state.players[0].hand.push(
            makeInstance(HAND_MANA, { controllerId: ME, ownerId: ME })
        );
        expect(holdsUnpayableLossObligation(state, ME)).toBe(false);
    });

    it("reads a fetchland as a source: its crack nets an untapped land before the payment (CR 605.1a)", () => {
        const state = owing(3, [obligation()]);
        state.players[0].battlefield.push(
            makeInstance(getCardByName("Polluted Delta").id, {
                controllerId: ME,
                ownerId: ME,
            })
        );
        expect(holdsUnpayableLossObligation(state, ME)).toBe(false);
    });

    it("reads the obligation off the definition's template when the instance carries no inline body", () => {
        const template = obligation({
            sourceCardId: TEMPLATE_OWER,
            triggerId: "owe",
            effects: undefined,
        });
        expect(holdsUnpayableLossObligation(owing(3, [template]), ME)).toBe(
            true
        );
        expect(holdsUnpayableLossObligation(owing(4, [template]), ME)).toBe(
            false
        );
    });

    it("reads an each-own-upkeep obligation", () => {
        expect(
            holdsUnpayableLossObligation(
                owing(3, [obligation({ timing: "each-own-upkeep" })]),
                ME
            )
        ).toBe(true);
    });

    it("does not read an obligation whose controller is not the player it targets", () => {
        expect(
            holdsUnpayableLossObligation(
                owing(3, [obligation({ controller: OPP })]),
                ME
            )
        ).toBe(false);
        expect(
            holdsUnpayableLossObligation(
                owing(3, [obligation({ targetPlayerId: OPP })]),
                ME
            )
        ).toBe(false);
    });

    it("does not read a cost with a non-mana leg", () => {
        const withLife = withCost({ mana: { X: 2, G: 2 }, life: 2 });
        expect(
            holdsUnpayableLossObligation(
                owing(3, [obligation({ effects: withLife })]),
                ME
            )
        ).toBe(false);
    });

    it("does not read a Phyrexian or hybrid symbol the planner cannot price (CR 107.4e/f)", () => {
        for (const cost of [
            { X: 2, G: 1, phyrexian: { G: 1 } },
            { X: 2, G: 1, hybrid: [["G", "W"]] },
            { X: "X", G: 2 },
        ]) {
            expect(
                holdsUnpayableLossObligation(
                    owing(3, [obligation({ effects: withCost(cost) })]),
                    ME
                )
            ).toBe(false);
        }
        expect(
            holdsUnpayableLossObligation(
                owing(3, [obligation({ effects: withCost({ X: 2, G: 2 }) })]),
                ME
            )
        ).toBe(true);
    });

    it("reads an obligation already on the stack, paid from the board as it stands — where the production rollout stops", () => {
        /** The Bot's upkeep, the obligation fired onto the stack. */
        const fired = (n: number, tapped = false): GameState => {
            const state = owing(n, [], {
                activePlayerId: ME,
                priorityPlayerId: ME,
                phase: "UPKEEP",
            });
            state.players[0].battlefield = forests(n, tapped);
            state.stack = [
                onStack(DRAW_THEN_OWE, {
                    id: "fired-1",
                    controllerId: ME,
                    ownerId: ME,
                    zone: "stack",
                    delayedTriggerId: "$inline-effects",
                    delayedEffects: OBLIGATION,
                }),
            ];
            return state;
        };
        expect(holdsUnpayableLossObligation(fired(3), ME)).toBe(true);
        expect(evaluate(fired(3), ME)).toBeLessThanOrEqual(
            -DEFAULT_EVAL_WEIGHTS.winScore / 2
        );
        expect(holdsUnpayableLossObligation(fired(4), ME)).toBe(false);
        // No untap falls between the trigger and its payment.
        expect(holdsUnpayableLossObligation(fired(4, true), ME)).toBe(true);
        // Another item of the payer's above it may add a source first.
        const withOwnSpell = fired(3);
        withOwnSpell.stack.push(
            onStack(RAMP, {
                id: "ramp-1",
                controllerId: ME,
                ownerId: ME,
                zone: "stack",
            })
        );
        expect(holdsUnpayableLossObligation(withOwnSpell, ME)).toBe(false);
    });

    it("reads a fired obligation off its source's template when the stack item carries no inline body", () => {
        const fired = (n: number): GameState => {
            const state = owing(n, [], {
                activePlayerId: ME,
                priorityPlayerId: ME,
                phase: "UPKEEP",
            });
            state.stack = [
                onStack(TEMPLATE_OWER, {
                    id: "fired-template-1",
                    controllerId: ME,
                    ownerId: ME,
                    zone: "stack",
                    delayedTriggerId: "owe",
                }),
            ];
            return state;
        };
        expect(holdsUnpayableLossObligation(fired(3), ME)).toBe(true);
        expect(holdsUnpayableLossObligation(fired(4), ME)).toBe(false);
    });
});
