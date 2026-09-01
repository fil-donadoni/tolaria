/**
 * "You may spend mana as though it were mana of any color/type" — the FULL
 * GRE → `game.ts` → payment path (CR 609.4b / 118.14, issue #2890).
 *
 * `convex/gre/__tests__/manaSubstitutionBreadth.test.ts` proves the breadth
 * primitive and the Op in isolation. This file asserts the pieces in BETWEEN,
 * which is where a payment-permission historically dies: the activation that
 * arms the grant, the cast mutation that has to SEE it, the payment seam that
 * has to SPEND it exactly once, and the cleanup that has to revoke it.
 *
 * Same harness convention as `castCommitLifeSeam.test.ts` — a stub
 * `MutationCtx` driving the REGISTERED mutation's own `_handler`, never a
 * hand-rolled reimplementation of `announceCast`'s body.
 */

import { describe, expect, it } from "vitest";
import {
    activateAbilityOnState,
    announceCast,
    tryAutoCommitPendingCast,
} from "../game";
import {
    getCastManaSubstitutions,
    getManaSubstitutions,
    hasSpellManaSubstitutionGrant,
    resolveTopOfStack,
    settleSpellManaSubstitutionGrant,
    type GameState,
} from "../gre/state";
import { finalizeCleanup } from "../gre/phases";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { northStar } from "../cards/sets/leg";
import { darkRitual, forest, mountain, savannahLions } from "../cards/sets/lea";
import { faerieSquadron } from "../cards/sets/inv";
import { hogaakArisenNecropolis } from "../cards/sets/mh1";
import { getLegalActions } from "../gre/rules";
import { robberOfTheRich } from "../cards/sets/eld";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const NORTH_STAR_ABILITY = "north-star-any-type-mana";
const ROBBER_TRIGGER = "robber-of-the-rich-attack";

type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

/** p1: North Star on the battlefield (untapped, not summoning-sick — it is an
 *  artifact), a Dark Ritual in hand, and a floating pool caller-supplied. A
 *  Forest is on the battlefield; nothing here can produce {B}.
 *
 *  Dark Ritual rather than a targeted spell on purpose: it has no
 *  `targetRequirement`, so `announceCast` reaches its IMMEDIATE-commit branch
 *  (the one that pays through `payCastManaCost`) instead of parking on target
 *  selection — the same reason `castCommitLifeSeam.test.ts` uses Toxic Deluge. */
function northStarBoard(pool: Record<string, number>): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(darkRitual.id, {
                        id: "bolt",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    makeInstance(northStar.id, {
                        id: "star",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    }),
                    makeInstance(forest.id, {
                        id: "forest",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    }),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...pool },
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

/** Activate North Star for real — {4} from the floating pool, {T} on the
 *  artifact — then resolve the ability off the stack. */
function armNorthStar(state: GameState): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "star",
        abilityId: NORTH_STAR_ABILITY,
    });
    // The ability is on the stack and the cost is paid before resolution.
    expect(state.stack).toHaveLength(1);
    expect(state.stack[0].abilityId).toBe(NORTH_STAR_ABILITY);
    expect(
        state.players[0].battlefield.find((c) => c.id === "star")!.isTapped
    ).toBe(true);
    resolveTopOfStack(state);
    // Resolution handed priority to the non-active player (CR 117.3b); the
    // cast the grant was armed for happens once p1 has it back. Model that
    // rather than asserting from the opponent's priority window.
    state.priorityPlayerId = "p1";
    state.passCount = 0;
}

describe("North Star — activation arms the grant and pays its own cost (CR 602.1 / 609.4b)", () => {
    it("{4}, {T} drains the pool, taps the artifact, and records one any-type grant", () => {
        const state = northStarBoard({ C: 4 });
        armNorthStar(state);

        expect(state.players[0].manaPool.C).toBe(0);
        expect(state.spellManaSubstitutionGrants).toEqual({ p1: ["any-type"] });
    });

    it("an unspent grant does NOT survive the turn (CR 514.2)", () => {
        const state = northStarBoard({ C: 4 });
        armNorthStar(state);
        expect(hasSpellManaSubstitutionGrant(state, "p1")).toBe(true);

        state.phase = "CLEANUP";
        finalizeCleanup(state);

        expect(hasSpellManaSubstitutionGrant(state, "p1")).toBe(false);
        expect(state.spellManaSubstitutionGrants).toBeUndefined();
    });
});

describe("North Star — an off-colour spell becomes payable, for ONE spell (CR 609.4b)", () => {
    /** Announce Lightning Bolt through the REGISTERED mutation. */
    async function announce(state: GameState, cardInstanceId: string) {
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation<AnnounceCastArgs, void>(
            announceCast as unknown as Handler<AnnounceCastArgs, void>,
            harness.ctx,
            {
                gameId: "game-1" as Id<"games">,
                playerId: "p1",
                cardInstanceId,
            }
        );
        return harness.state();
    }

    it("without the grant, {G} cannot pay Dark Ritual's {B} — the cast is not even legal", async () => {
        // The castability gate (`getLegalActions` → `canPotentiallyPayCost` →
        // `coloredCostLeftover`) is substitution-aware, so this is where the
        // difference shows: with only a Forest and {G} floating, "cast" is not
        // offered at all and the mutation refuses the announcement.
        await expect(
            announce(northStarBoard({ G: 1 }), "bolt")
        ).rejects.toThrow(/Illegal action "cast"/);
    });

    it("with the grant, the same {G} pays the {B} and the spell commits", async () => {
        const state = northStarBoard({ C: 4, G: 1 });
        armNorthStar(state);

        const after = await announce(state, "bolt");
        // CR 609.4b — the green mana was spent as though it were black.
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].card.id).toBe(darkRitual.id);
        expect(after.pendingCast).toBeUndefined();
        expect(after.players[0].manaPool.G).toBe(0);
        // "for ONE spell this turn" — the grant is gone.
        expect(after.spellManaSubstitutionGrants).toBeUndefined();
    });

    it("a spell payable in its own colours leaves the grant intact", async () => {
        const state = northStarBoard({ C: 4, B: 1 });
        armNorthStar(state);

        const after = await announce(state, "bolt");
        expect(after.stack).toHaveLength(1);
        expect(after.players[0].manaPool.B).toBe(0);
        // Nothing needed fixing, so nothing was designated — the grant survives
        // for the off-colour spell the player armed it for.
        expect(after.spellManaSubstitutionGrants).toEqual({ p1: ["any-type"] });
    });

    it("the grant does not reach an ACTIVATED ability's cost (Oracle: 'that spell's mana cost')", () => {
        const state = northStarBoard({ C: 4 });
        armNorthStar(state);
        // No cast named — the shape every ability / morph / may-pay payment
        // uses. The grant is withheld.
        expect(getManaSubstitutions(state, "p1")).toEqual([]);
        // Naming a card is not enough on its own either: the one-shot grant
        // needs the cost to BE that spell's printed mana cost (CR 601.2f).
        expect(getManaSubstitutions(state, "p1", "bolt")).toEqual([]);
        // Through the shared cast wrapper, with Dark Ritual's printed {B}, it
        // is offered.
        expect(
            getCastManaSubstitutions(
                state,
                state.players[0],
                "bolt",
                darkRitual,
                { B: 1 }
            )
        ).toHaveLength(30);
    });
});

describe("Robber of the Rich — the fixing rides ONE exiled card's cast permission (CR 609.4b)", () => {
    /** Robber attacking p2, whose library top is a Mountain and whose hand is
     *  larger than p1's (CR 603.4 intervening condition). */
    function robberBoard(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(robberOfTheRich.id, {
                            id: "robber",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "battlefield",
                        }),
                        makeInstance(forest.id, {
                            id: "forest",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "battlefield",
                        }),
                    ],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
                }),
                makePlayer("p2", {
                    hand: [
                        makeInstance(mountain.id, {
                            id: "p2-hand-1",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                    library: [
                        makeInstance(darkRitual.id, {
                            id: "loot",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "library",
                        }),
                    ],
                }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    }

    function fireAttackTrigger(state: GameState): void {
        const robber = state.players[0].battlefield.find(
            (c) => c.id === "robber"
        )!;
        state.stack.push({
            ...robber,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: ROBBER_TRIGGER,
            triggerSourceId: robber.id,
            triggerEvent: {
                type: "ATTACKERS_DECLARED",
                attackerIds: [robber.id],
                attackingPlayerId: "p1",
            },
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("stamps the any-color permission on the stolen card, and only that card", () => {
        const state = robberBoard();
        fireAttackTrigger(state);

        const stolen = state.players[1].exile.find((c) => c.id === "loot");
        expect(stolen?.castableFromExileBy).toBe("p1");
        // CR 105.1 — "any COLOR": colorless is never a substitution target.
        expect(stolen?.castFromExileManaSubstitution).toBe("any-color");
    });

    it("the fixing applies to THAT card's cast and to nothing else p1 casts", () => {
        const state = robberBoard();
        fireAttackTrigger(state);

        // 25 pairs = the "any color" generator (CR 105.1's five colours as
        // targets); the exiled Bolt's {R} is now payable with the Forest's {G}.
        expect(getManaSubstitutions(state, "p1", "loot")).toHaveLength(25);
        // Any other spell p1 casts sees nothing…
        expect(getManaSubstitutions(state, "p1", "some-other-spell")).toEqual(
            []
        );
        // …nor does an activated ability's cost…
        expect(getManaSubstitutions(state, "p1")).toEqual([]);
        // …nor does the card's OWNER, who never received the permission.
        expect(getManaSubstitutions(state, "p2", "loot")).toEqual([]);
    });

    it("the stolen off-colour card actually commits, paid with the wrong colour", () => {
        const state = robberBoard();
        fireAttackTrigger(state);

        // The parked-cast seam every exile cast goes through once the pool is
        // in place (`tapForPayment` → `tryAutoCommitPendingCast`).
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "loot",
            manaCost: { B: 1 },
            tappedLandIds: [],
        };
        const committed = tryAutoCommitPendingCast(state, "p1");

        expect(committed?.cardInstanceId).toBe("loot");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].card.id).toBe(darkRitual.id);
        // CR 609.4b — the {G} was spent as though it were {B}.
        expect(state.players[0].manaPool.G).toBe(0);
        // The permission is consumed with the card leaving exile (CR 601.3).
        expect(state.players[1].exile).toHaveLength(0);
    });
});

describe("the grant reaches the spell's MANA COST only (CR 601.2f / 609.4b)", () => {
    // North Star: "…to pay that spell's mana cost. (Additional costs are still
    // paid normally.)" CR 601.2f makes the total cost "the mana cost or
    // alternative cost …, plus all additional costs" — three components, and
    // the permission names the first. A Kicker leg is an additional cost
    // (CR 118.8), so its coloured pips must be paid in their own colour.
    function kickerBoard(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(faerieSquadron.id, {
                            id: "faerie",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(northStar.id, {
                            id: "star",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "battlefield",
                        }),
                    ],
                    // One blue for the printed {U}; the rest colorless. The
                    // kicker's own {U} has no second blue source anywhere.
                    manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 7 },
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    }

    it("withholds the one-shot grant from a KICKED cast (CR 118.8)", () => {
        const state = kickerBoard();
        armNorthStar(state);
        // Faerie Squadron's printed cost — the grant applies.
        expect(
            getCastManaSubstitutions(
                state,
                state.players[0],
                "faerie",
                faerieSquadron,
                { U: 1 }
            )
        ).toHaveLength(30);
        // The same cast KICKED ({U} + {3}{U}) — the total cost is no longer the
        // spell's mana cost, so the permission is not offered at all.
        expect(
            getCastManaSubstitutions(
                state,
                state.players[0],
                "faerie",
                faerieSquadron,
                { U: 2, X: 3 }
            )
        ).toEqual([]);
    });

    it("leaves an ALTERNATIVE cost untouched (CR 601.2f — paid instead of the mana cost)", () => {
        const state = kickerBoard();
        armNorthStar(state);
        // Any cost that is not the printed one — a flashback/escape/bestow/dash
        // amount — reads the same way: not "that spell's mana cost".
        expect(
            getCastManaSubstitutions(
                state,
                state.players[0],
                "faerie",
                faerieSquadron,
                { G: 1 }
            )
        ).toEqual([]);
    });

    it("a withheld grant is not SPENT either", () => {
        const state = kickerBoard();
        armNorthStar(state);
        settleSpellManaSubstitutionGrant(
            state,
            state.players[0],
            { U: 2, X: 3 },
            faerieSquadron,
            "faerie"
        );
        // Nothing was paid with it, so nothing was designated.
        expect(hasSpellManaSubstitutionGrant(state, "p1")).toBe(true);
    });
});

describe("the grant never reaches a 'rather than pay that mana' cost (CR 702.51a)", () => {
    // CR 702.51a, printed: convoke means "you may tap an untapped creature of
    // that color you control RATHER THAN PAY THAT MANA". No mana is spent, so
    // CR 609.4b — which governs only how a player may SPEND mana — cannot
    // reach a convoke pip. Widening convoke creatures in the castability
    // census would offer a cast `recordConvokeCreaturePick` then refuses.
    it("does not make Hogaak castable off white creatures alone", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(hogaakArisenNecropolis.id, {
                            id: "hogaak",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(northStar.id, {
                            id: "star",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "battlefield",
                        }),
                        ...Array.from({ length: 8 }, (_, i) =>
                            makeInstance(savannahLions.id, {
                                id: `lion-${i}`,
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "battlefield",
                                enteredOnTurn: 1,
                            })
                        ),
                    ],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            turn: 5,
        });
        state.spellManaSubstitutionGrants = { p1: ["any-type"] };

        const hogaak = state.players[0].hand[0];
        // Hogaak's two {B/G} pips can only be paid by convoking a black or
        // green creature; eight white ones can never cover them, grant or no
        // grant. Offering the cast would strand the player in a convoke picker
        // that cannot be completed.
        expect(getLegalActions(state, state.players[0], hogaak)).not.toContain(
            "cast"
        );
    });
});
