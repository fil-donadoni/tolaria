// CR 107.4f — Phyrexian mana in an ACTIVATED ability's cost (issue #7830).
//
// "A Phyrexian mana symbol can be paid with either the indicated color of mana
// or 2 life." The split is chosen per pip as the cost is paid (CR 602.2b →
// 601.2f-h). These tests drive the two commit paths the mutation uses —
// `activateAbilityOnState` (non-targeted) and `finalizeTargetSelection`
// (targeted, through `applyOneTargetSelection`) — on variants of shipped cards
// (`withTemporaryDefinition`: no printed card carries such a cost yet; Etali,
// Primal Conqueror is issue #2608).

import { describe, expect, it } from "vitest";
import { activateAbilityOnState, applyOneTargetSelection } from "../../game";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { GameState } from "../state";

const FOUNTAIN = getCardByName("Fountain of Youth");
const PYROMANCER = getCardByName("Prodigal Pyromancer");

/** "{1}{G/P}, {T}: You gain 1 life." — Fountain of Youth with its `{2}`
 *  re-costed to one generic plus one green Phyrexian pip. */
function phyrexianFountain(): CardDefinition {
    return {
        ...FOUNTAIN,
        activatedAbilities: FOUNTAIN.activatedAbilities!.map((a) => ({
            ...a,
            cost: { ...a.cost, mana: { X: 1, phyrexian: { G: 1 } } },
        })),
    };
}

/** "{R/P}, {T}: 1 damage to any target." — a TARGETED ability. */
function phyrexianPyromancer(): CardDefinition {
    return {
        ...PYROMANCER,
        activatedAbilities: PYROMANCER.activatedAbilities!.map((a) => ({
            ...a,
            cost: { ...a.cost, mana: { phyrexian: { R: 1 } } },
        })),
    };
}

const FOUNTAIN_ABILITY = FOUNTAIN.activatedAbilities![0].id;
const PYRO_ABILITY = PYROMANCER.activatedAbilities![0].id;

function fountainState(opts: {
    life?: number;
    pool?: Partial<Record<string, number>>;
}): GameState {
    const fountain = makeInstance(FOUNTAIN.id, { id: "fountain" });
    return makeState({
        players: [
            makePlayer("p1", {
                life: opts.life ?? 20,
                battlefield: [fountain],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...opts.pool },
            }),
            makePlayer("p2"),
        ],
    });
}

function activateFountain(state: GameState, phyrexianLifePips?: number) {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "fountain",
        abilityId: FOUNTAIN_ABILITY,
        ...(phyrexianLifePips !== undefined ? { phyrexianLifePips } : {}),
    });
}

describe("Phyrexian mana in an activated ability's cost (CR 107.4f)", () => {
    it("charges the pip as mana of its colour when paid with mana — never free", () => {
        withTemporaryDefinition(phyrexianFountain(), () => {
            const state = fountainState({ pool: { G: 1, C: 1 } });
            activateFountain(state, 0);
            const me = state.players[0];
            // {1}{G}: both pool mana spent, no life paid.
            expect(me.manaPool.G).toBe(0);
            expect(me.manaPool.C).toBe(0);
            expect(me.life).toBe(20);
            expect(state.stack).toHaveLength(1);
        });
    });

    it("charges 2 life instead when the activator pays the pip with life", () => {
        withTemporaryDefinition(phyrexianFountain(), () => {
            const state = fountainState({ pool: { G: 1, C: 1 } });
            activateFountain(state, 1);
            const me = state.players[0];
            // {1} + 2 life: only ONE of the two pool mana is spent.
            expect(me.manaPool.G + me.manaPool.C).toBe(1);
            expect(me.life).toBe(18);
            expect(state.stack).toHaveLength(1);
        });
    });

    it("an unchosen split defaults to the most-life split life covers", () => {
        withTemporaryDefinition(phyrexianFountain(), () => {
            const state = fountainState({ pool: { C: 1 } });
            activateFountain(state);
            expect(state.players[0].life).toBe(18);
            expect(state.stack).toHaveLength(1);
        });
    });

    it("CR 119.4 — below 2 life the life branch is unavailable", () => {
        withTemporaryDefinition(phyrexianFountain(), () => {
            const state = fountainState({ life: 1, pool: { G: 1, C: 1 } });
            expect(() => activateFountain(state, 1)).toThrow(/Not enough life/);
            expect(state.stack).toHaveLength(0);
            // The mana branch stays legal, and is the default at 1 life.
            activateFountain(state);
            expect(state.players[0].life).toBe(1);
            expect(state.players[0].manaPool.G).toBe(0);
            expect(state.stack).toHaveLength(1);
        });
    });

    it("paying life down to 0 is legal (CR 119.4 — 2 life covers it)", () => {
        withTemporaryDefinition(phyrexianFountain(), () => {
            const state = fountainState({ life: 2, pool: { C: 1 } });
            activateFountain(state, 1);
            expect(state.players[0].life).toBe(0);
            expect(state.stack).toHaveLength(1);
        });
    });

    it("an uncovered cost parks a payment phase owing the pip's colour and the life", () => {
        withTemporaryDefinition(phyrexianFountain(), () => {
            const withMana = fountainState({});
            activateFountain(withMana, 0);
            expect(withMana.pendingActivation?.manaCost).toEqual({
                X: 1,
                G: 1,
            });
            expect(withMana.pendingActivation?.lifeCost).toBeUndefined();

            const withLife = fountainState({});
            activateFountain(withLife, 1);
            expect(withLife.pendingActivation?.manaCost).toEqual({ X: 1 });
            expect(withLife.pendingActivation?.lifeCost).toBe(2);
            // Deferred: nothing is paid until the payment commits.
            expect(withLife.players[0].life).toBe(20);
        });
    });

    it("the targeted commit path charges the same split (finalizeTargetSelection)", () => {
        withTemporaryDefinition(phyrexianPyromancer(), () => {
            const build = () =>
                makeState({
                    players: [
                        makePlayer("p1", {
                            battlefield: [
                                makeInstance(PYROMANCER.id, {
                                    id: "pyro",
                                    isSummoningSick: false,
                                }),
                            ],
                            manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
                        }),
                        makePlayer("p2"),
                    ],
                });
            for (const [lifePips, life, red] of [
                [0, 20, 0],
                [1, 18, 1],
            ] as const) {
                const state = build();
                activateAbilityOnState(state, {
                    playerId: "p1",
                    cardInstanceId: "pyro",
                    abilityId: PYRO_ABILITY,
                    phyrexianLifePips: lifePips,
                });
                expect(state.pendingTarget?.cardInstanceId).toBe("pyro");
                applyOneTargetSelection(state, "p1", {
                    targetType: "player",
                    targetId: "p2",
                });
                expect(state.stack).toHaveLength(1);
                expect(state.players[0].life).toBe(life);
                expect(state.players[0].manaPool.R).toBe(red);
            }
        });
    });

    it("the targeted path refuses a life pick at announcement below 2 life", () => {
        withTemporaryDefinition(phyrexianPyromancer(), () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        life: 1,
                        battlefield: [
                            makeInstance(PYROMANCER.id, {
                                id: "pyro",
                                isSummoningSick: false,
                            }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            expect(() =>
                activateAbilityOnState(state, {
                    playerId: "p1",
                    cardInstanceId: "pyro",
                    abilityId: PYRO_ABILITY,
                    phyrexianLifePips: 1,
                })
            ).toThrow(/Not enough life/);
            expect(state.pendingTarget).toBeUndefined();
        });
    });
});
