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
import type { EffectPredicate } from "../../cards/types";
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
                    count: { zone: "battlefield", controller: "controller" },
                },
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

    it("rejects a count with no scope, or an opponent scope", () => {
        expect(
            validate({
                left: { count: { zone: "graveyard", controller: "opponent" } },
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
