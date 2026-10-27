// CR 602.1b (issue #3685) — a printed "Activate only if …" restriction carried
// as DATA (`ActivatedAbility.activationCondition`) rather than a `canActivate`
// closure. Threshold ("Activate only if there are seven or more cards in your
// graveyard") is the first class migrated: Barbarian Ring and Cephalid
// Coliseum are the FIXTURES, nothing under test reads a card name.
//
// Pinned here: the server's activation mutation refuses at six and accepts at
// seven for both cards, counting the source's CONTROLLER's graveyard (CR 109.5)
// and never an opponent's; the evaluator's accepted subset; and the
// authoring-time validator refusing a predicate that only means something
// during resolution.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import { activateAbilityOnState } from "../../game";
import {
    activationConditionErrors,
    activationConditionHolds,
} from "../activationPrecondition";
import { validateAbilityEffectScript } from "../effects/validate";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition, EffectPredicate } from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";

const FILLER = getCardByName("Grizzly Bears").id;

const THRESHOLD_ABILITIES = [
    { card: "Barbarian Ring", abilityId: "barbarian-ring-sac" },
    { card: "Cephalid Coliseum", abilityId: "cephalid-coliseum-threshold" },
] as const;

const THRESHOLD: EffectPredicate = {
    left: { count: { zone: "graveyard", controller: "controller" } },
    op: "ge",
    right: 7,
};

function inst(cardId: string, id: string, owner: "p1" | "p2") {
    return makeInstance(cardId, {
        controllerId: owner,
        ownerId: owner,
        id,
        isSummoningSick: false,
    });
}

function pile(owner: "p1" | "p2", count: number): CardInstanceState[] {
    return Array.from({ length: count }, (_, i) =>
        inst(FILLER, `${owner}-gy-${i}`, owner)
    );
}

/** p1 holds priority in its own main phase with the threshold land untapped,
 *  `mine` cards in its graveyard and `theirs` in the opponent's. */
function board(cardName: string, mine: number, theirs: number): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [inst(getCardByName(cardName).id, "land", "p1")],
                graveyard: pile("p1", mine),
            }),
            makePlayer("p2", {
                battlefield: [inst(FILLER, "bear", "p2")],
                graveyard: pile("p2", theirs),
            }),
        ],
    });
}

function activate(state: GameState, abilityId: string) {
    return activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "land",
        abilityId,
    } as Parameters<typeof activateAbilityOnState>[1]);
}

describe("threshold activationCondition — the server gate (CR 602.1b)", () => {
    for (const { card, abilityId } of THRESHOLD_ABILITIES) {
        describe(card, () => {
            it("carries the restriction as data, not a closure", () => {
                const ability = getCardByName(card).activatedAbilities!.find(
                    (a) => a.id === abilityId
                )!;
                expect(ability.canActivate).toBeUndefined();
                expect(ability.activationCondition).toEqual(THRESHOLD);
            });

            it("refuses the activation with six cards in the controller's graveyard", () => {
                expect(() => activate(board(card, 6, 0), abilityId)).toThrow(
                    "Ability cannot be activated right now"
                );
            });

            it("accepts it with seven", () => {
                expect(() =>
                    activate(board(card, 7, 0), abilityId)
                ).not.toThrow();
            });

            it("counts YOUR graveyard (CR 109.5), never an opponent's", () => {
                expect(() => activate(board(card, 6, 7), abilityId)).toThrow(
                    "Ability cannot be activated right now"
                );
            });
        });
    }
});

describe("activationConditionHolds — the activation-time subset", () => {
    const state = board("Barbarian Ring", 3, 4);
    const source = state.players[0].battlefield[0];
    const holds = (condition: EffectPredicate) =>
        activationConditionHolds(state, source, condition);

    it("scopes `controller` to the source's controller and `acrossAllPlayers` to every player", () => {
        expect(
            holds({
                left: {
                    count: { zone: "graveyard", controller: "controller" },
                },
                op: "eq",
                right: 3,
            })
        ).toBe(true);
        expect(
            holds({
                left: { count: { zone: "graveyard", acrossAllPlayers: true } },
                op: "eq",
                right: 7,
            })
        ).toBe(true);
    });

    it("reads a hand's size and applies `times`", () => {
        expect(
            holds({
                left: {
                    count: { zone: "hand", controller: "controller", times: 2 },
                },
                op: "eq",
                right: 0,
            })
        ).toBe(true);
        expect(
            holds({
                left: 6,
                op: "le",
                right: {
                    count: {
                        zone: "graveyard",
                        controller: "controller",
                        times: 2,
                    },
                },
            })
        ).toBe(true);
    });

    it("fails CLOSED on a predicate outside the subset", () => {
        expect(holds({ binding: "$paid" })).toBe(false);
        expect(holds({ left: { ref: "$x" }, op: "ge", right: 0 })).toBe(false);
        // Shapes the validator refuses, reached unvalidated: a filter is never
        // silently dropped and an unreadable zone never counts as the hand.
        expect(
            holds({
                left: {
                    count: {
                        zone: "graveyard",
                        controller: "controller",
                        filter: { type: "Land" },
                    },
                },
                op: "ge",
                right: 0,
            })
        ).toBe(false);
        expect(
            holds({
                left: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { supertypes: "Snow" },
                    },
                },
                op: "ge",
                right: 0,
            })
        ).toBe(false);
        expect(
            holds({
                left: { count: { zone: "library", controller: "controller" } },
                op: "ge",
                right: 0,
            })
        ).toBe(false);
    });
});

describe("activationCondition validation — resolution-only shapes fail at authoring time", () => {
    const validate = (activationCondition: unknown, useStack = true) =>
        validateAbilityEffectScript(
            { id: "probe", activationCondition, useStack },
            "Probe"
        );

    it("accepts the threshold comparison", () => {
        expect(validate(THRESHOLD)).toEqual([]);
        expect(activationConditionErrors(THRESHOLD)).toEqual([]);
    });

    it("rejects a binding predicate — nothing is bound before activation", () => {
        expect(validate({ binding: "$paid" })).toEqual([
            expect.stringContaining("accepts only a comparison predicate"),
        ]);
    });

    it("rejects a ref operand, a filtered count and an unreadable zone", () => {
        expect(
            validate({ left: { ref: "$paid" }, op: "ge", right: 1 })
        ).toEqual([expect.stringContaining("activationCondition.left")]);
        expect(
            validate({
                left: {
                    count: {
                        zone: "graveyard",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                },
                op: "ge",
                right: 3,
            })
        ).toEqual([expect.stringContaining("count.filter")]);
        expect(
            validate({
                left: { count: { zone: "library", controller: "controller" } },
                op: "le",
                right: 20,
            })
        ).toEqual([expect.stringContaining("count.zone")]);
    });

    it("rejects a count with no scope, or with two", () => {
        expect(
            validate({
                left: { count: { zone: "graveyard" } },
                op: "ge",
                right: 7,
            })
        ).toEqual([expect.stringContaining("exactly one scope")]);
        expect(
            validate({
                left: {
                    count: {
                        zone: "graveyard",
                        controller: "opponent",
                        acrossAllPlayers: true,
                    },
                },
                op: "ge",
                right: 7,
            })
        ).toEqual([expect.stringContaining("exactly one scope")]);
    });

    it("rejects it on a mana ability, whose tap sites never read it", () => {
        expect(validate(THRESHOLD, false)).toEqual([
            expect.stringContaining("on a mana ability"),
        ]);
    });
});

// CR 602.5 + CR 109.5 (issue #5258) — "Activate only if you control five or
// more lands" / "… if an opponent controls more lands than you": a BATTLEFIELD
// count, filtered by literal card type or colour. Barbarian Ring's sacrifice
// ability is the vehicle (its condition swapped for each form); nothing under
// test reads a card name.
const LAND = getCardByName("Forest").id;
const GREEN_BEAR = getCardByName("Grizzly Bears").id;

const lands = (n: number): EffectPredicate => ({
    left: {
        count: {
            zone: "battlefield",
            controller: "controller",
            filter: { type: ["Land"] },
        },
    },
    op: "ge",
    right: n,
});

const OPPONENT_MORE_LANDS: EffectPredicate = {
    left: {
        count: {
            zone: "battlefield",
            controller: "opponent",
            filter: { type: ["Land"] },
        },
    },
    op: "gt",
    right: {
        count: {
            zone: "battlefield",
            controller: "controller",
            filter: { type: ["Land"] },
        },
    },
};

/** p1 controls the source plus `mine` Forests, p2 controls `theirs` Forests
 *  and `bears` Grizzly Bears. The source is itself a land (CR 305 — it counts
 *  toward "lands you control"). */
function landBoard(mine: number, theirs: number, bears = 0): GameState {
    const forests = (owner: "p1" | "p2", n: number) =>
        Array.from({ length: n }, (_, i) =>
            inst(LAND, `${owner}-forest-${i}`, owner)
        );
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    inst(getCardByName("Barbarian Ring").id, "land", "p1"),
                    ...forests("p1", mine),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    ...forests("p2", theirs),
                    ...Array.from({ length: bears }, (_, i) =>
                        inst(GREEN_BEAR, `bear-${i}`, "p2")
                    ),
                ],
            }),
        ],
    });
}

/** Barbarian Ring with its sacrifice ability's condition replaced. */
function ringWith(activationCondition: EffectPredicate): CardDefinition {
    const ring = getCardByName("Barbarian Ring");
    return {
        ...ring,
        activatedAbilities: ring.activatedAbilities!.map((a) =>
            a.id === "barbarian-ring-sac" ? { ...a, activationCondition } : a
        ),
    };
}

describe("battlefield activationCondition — the server gate (CR 602.5, issue #5258)", () => {
    it('"you control five or more lands": four refuse, five accept — the source counts', () => {
        withTemporaryDefinition(ringWith(lands(5)), () => {
            expect(() =>
                activate(landBoard(3, 9), "barbarian-ring-sac")
            ).toThrow("Ability cannot be activated right now");
            expect(() =>
                activate(landBoard(4, 0), "barbarian-ring-sac")
            ).not.toThrow();
        });
    });

    it('"an opponent controls more lands than you": strictly more, a tie refuses', () => {
        withTemporaryDefinition(ringWith(OPPONENT_MORE_LANDS), () => {
            // p1: the Ring + 2 Forests = 3 lands.
            expect(() =>
                activate(landBoard(2, 3), "barbarian-ring-sac")
            ).toThrow("Ability cannot be activated right now");
            expect(() =>
                activate(landBoard(2, 4), "barbarian-ring-sac")
            ).not.toThrow();
        });
    });
});

describe("battlefield activationCondition — the evaluator (CR 109.5)", () => {
    it("reads \"opponent\" as the controller's opponent and the filter's type", () => {
        const state = landBoard(0, 4, 3);
        const source = state.players[0].battlefield[0];
        const opponentLands: EffectPredicate = {
            left: {
                count: {
                    zone: "battlefield",
                    controller: "opponent",
                    filter: { type: "Land" },
                },
            },
            op: "eq",
            right: 4,
        };
        expect(activationConditionHolds(state, source, opponentLands)).toBe(
            true
        );
    });

    it("reads the LIVE colour (CR 105.2) — a colour filter counts the green permanents", () => {
        const state = landBoard(0, 0, 2);
        const source = state.players[0].battlefield[0];
        // Grizzly Bears is green by its mana cost; a Forest is colourless.
        const greenAtLeast = (n: number): EffectPredicate => ({
            left: {
                count: {
                    zone: "battlefield",
                    controller: "opponent",
                    filter: { color: ["G"] },
                },
            },
            op: "ge",
            right: n,
        });
        expect(activationConditionHolds(state, source, greenAtLeast(2))).toBe(
            true
        );
        expect(activationConditionHolds(state, source, greenAtLeast(3))).toBe(
            false
        );
    });

    it("fails CLOSED on a table with no single opponent", () => {
        const base = landBoard(0, 9);
        const alone = { ...base, players: [base.players[0]] };
        expect(
            activationConditionHolds(
                alone,
                alone.players[0].battlefield[0],
                OPPONENT_MORE_LANDS
            )
        ).toBe(false);
    });
});

describe("battlefield activationCondition — validation (issue #5258)", () => {
    const validate = (activationCondition: unknown) =>
        validateAbilityEffectScript(
            { id: "probe", activationCondition, useStack: true },
            "Probe"
        );

    it("accepts a literal type or colour filter, and the opponent comparison", () => {
        expect(validate(lands(5))).toEqual([]);
        expect(validate(OPPONENT_MORE_LANDS)).toEqual([]);
    });

    it("rejects a filter key the board view cannot read, and a non-literal value", () => {
        expect(
            validate({
                left: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { supertypes: "Snow" },
                    },
                },
                op: "ge",
                right: 4,
            })
        ).toEqual([expect.stringContaining("count.filter.supertypes")]);
        expect(
            validate({
                left: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { color: { sacrificed: { read: "colors" } } },
                    },
                },
                op: "ge",
                right: 2,
            })
        ).toEqual([expect.stringContaining("count.filter.color")]);
    });
});
