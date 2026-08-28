/**
 * Cast-time mana substitution — "you may spend mana as though it were mana of
 * any color/type" (CR 609.4b / 118.14, issue #2890).
 *
 * This is the `grantSpellManaSubstitution` Op's permanent test plus the shared
 * breadth primitive's. Three things it has to prove, because nothing else can:
 *
 *   1. The two breadths are actually DIFFERENT. They collapse to the same
 *      behaviour on every cost that has no `{C}` pip, so without the asymmetry
 *      case a single wrong generator would pass everything.
 *   2. The grant reaches payment THROUGH `getManaSubstitutions` — never by a
 *      test handing substitutions to `isManaCostCovered` by hand, which would
 *      prove the payment layer (already shipped) and not the new channel.
 *   3. CR 609.4b's "It doesn't change that cost" — asserted on the PROJECTED
 *      cost, through `projectPublicState`.
 */

import { describe, expect, it } from "vitest";
import { substitutionsForBreadth } from "../manaColors";
import {
    consumeSpellManaSubstitutionGrant,
    getCastManaSubstitutions,
    getManaSubstitutions,
    hasSpellManaSubstitutionGrant,
    isManaCostCovered,
    payManaCost,
    resolveTopOfStack,
    settleSpellManaSubstitutionGrant,
    type CardInstanceState,
    type GameState,
} from "../state";
import { buildAutoTapSources, solveAutoTap } from "../autoTap";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { makeInstance, makeState } from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";
import { lightningBolt } from "../../cards/sets/lea";
import { getInstanceManaCost } from "../../cards/registry";
import { manaGateBattlefields } from "../constants";
import { northStar } from "../../cards/sets/leg";

const NORTH_STAR_ABILITY = "north-star-any-type-mana";

/** North Star on p1's battlefield, untapped and not summoning-sick. */
function stateWithNorthStar(): GameState {
    const state = makeState();
    const artifact = makeInstance(northStar.id, {
        id: "north-star-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    state.players[0].battlefield.push(artifact);
    return state;
}

/** Resolve North Star's activated ability off the stack (the {4}{T} cost is
 *  the activation path's business — this exercises the EFFECT). */
function resolveNorthStarAbility(state: GameState): void {
    const source = state.players[0].battlefield.find(
        (c) => c.id === "north-star-1"
    )!;
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId: NORTH_STAR_ABILITY,
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("substitutionsForBreadth (CR 105.1 / 106.1b / 118.14)", () => {
    it("'any-type' may target colorless, 'any-color' may not", () => {
        const anyType = substitutionsForBreadth("any-type");
        const anyColor = substitutionsForBreadth("any-color");
        // CR 106.1b — six TYPES of mana, colorless among them.
        expect(anyType.some((p) => p.to === "C")).toBe(true);
        // CR 105.1 — five COLORS, colorless NOT among them.
        expect(anyColor.some((p) => p.to === "C")).toBe(false);
    });

    it("both breadths accept colorless mana as the mana being SPENT", () => {
        // CR 118.14 — "players may spend mana as though it were colorless mana
        // or mana of any color": the permission is about the mana spent, so a
        // colorless pool entry is a legal `from` under either wording.
        for (const breadth of ["any-color", "any-type"] as const) {
            expect(
                substitutionsForBreadth(breadth).some((p) => p.from === "C")
            ).toBe(true);
        }
    });

    it("emits no identity pairs and covers every colour as a source", () => {
        for (const breadth of ["any-color", "any-type"] as const) {
            const pairs = substitutionsForBreadth(breadth);
            expect(pairs.some((p) => p.from === p.to)).toBe(false);
            for (const c of ["W", "U", "B", "R", "G", "C"]) {
                expect(pairs.some((p) => p.from === c)).toBe(true);
            }
        }
        expect(substitutionsForBreadth("any-type")).toHaveLength(30);
        expect(substitutionsForBreadth("any-color")).toHaveLength(25);
    });
});

describe("the {C} asymmetry — the one observable difference (CR 107.4c)", () => {
    // CR 107.4c — "{C} … represents a cost that can be paid only with one
    // colorless mana". Under "any type" coloured mana may be spent AS colorless
    // and pays it; under "any color" it never can, because colorless is not a
    // colour and so is never a substitution target.
    const colorlessPip = { C: 1 };

    it("'any-type' pays a {C} pip with coloured mana", () => {
        expect(
            isManaCostCovered(
                { R: 1 },
                colorlessPip,
                substitutionsForBreadth("any-type")
            )
        ).toBe(true);
    });

    it("'any-color' does NOT pay a {C} pip with coloured mana", () => {
        expect(
            isManaCostCovered(
                { R: 1 },
                colorlessPip,
                substitutionsForBreadth("any-color")
            )
        ).toBe(false);
    });

    it("both breadths pay a coloured pip with off-colour mana", () => {
        for (const breadth of ["any-color", "any-type"] as const) {
            expect(
                isManaCostCovered(
                    { R: 1 },
                    { U: 1 },
                    substitutionsForBreadth(breadth)
                )
            ).toBe(true);
        }
    });

    it("payment actually deducts the substituted mana, it is not just covered", () => {
        const pool: Record<string, number> = { R: 2 };
        payManaCost(pool, { U: 1, X: 1 }, substitutionsForBreadth("any-color"));
        expect(pool.R).toBe(0);
    });

    it("monocoloured-hybrid {C/W} is a COLOURED symbol, payable under either breadth (CR 107.4e)", () => {
        // CR 107.4e — "A hybrid mana symbol is also a colored mana symbol, even
        // if one of its components is colorless." So its white half is a legal
        // substitution target under "any color" too, and green mana pays it.
        for (const breadth of ["any-color", "any-type"] as const) {
            expect(
                isManaCostCovered(
                    { G: 1 },
                    { "W/C": 1 },
                    substitutionsForBreadth(breadth)
                )
            ).toBe(true);
        }
        // Without any permission it is payable only by its own two halves.
        expect(isManaCostCovered({ G: 1 }, { "W/C": 1 })).toBe(false);
        expect(isManaCostCovered({ C: 1 }, { "W/C": 1 })).toBe(true);
    });
});

describe("grantSpellManaSubstitution Op — the one-shot grant (CR 609.4b / 118.14)", () => {
    it("resolution records the grant on the activating player", () => {
        const state = stateWithNorthStar();
        expect(hasSpellManaSubstitutionGrant(state, "p1")).toBe(false);
        resolveNorthStarAbility(state);
        expect(state.spellManaSubstitutionGrants).toEqual({
            p1: ["any-type"],
        });
        expect(hasSpellManaSubstitutionGrant(state, "p2")).toBe(false);
    });

    it("two activations stack — each buys one spell", () => {
        const state = stateWithNorthStar();
        resolveNorthStarAbility(state);
        resolveNorthStarAbility(state);
        expect(state.spellManaSubstitutionGrants?.p1).toEqual([
            "any-type",
            "any-type",
        ]);
    });

    it("is offered for a spell's own mana cost, and withheld everywhere else", () => {
        const state = stateWithNorthStar();
        const bolt = makeInstance(getCardByName("Lightning Bolt").id, {
            id: "bolt-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        state.players[0].hand.push(bolt);
        resolveNorthStarAbility(state);

        // No cast named — an activated ability's cost, a morph, a may-pay. The
        // Oracle says "that SPELL's mana cost", so nothing is granted.
        expect(getManaSubstitutions(state, "p1")).toEqual([]);
        // Casting Lightning Bolt for its printed {R} — the full any-type set.
        expect(
            getCastManaSubstitutions(
                state,
                state.players[0],
                "bolt-1",
                getCardByName("Lightning Bolt"),
                { R: 1 }
            )
        ).toHaveLength(30);
        // Never the opponent's.
        expect(
            getCastManaSubstitutions(
                state,
                state.players[1],
                "bolt-1",
                getCardByName("Lightning Bolt"),
                { R: 1 }
            )
        ).toEqual([]);
    });

    it("consumption pops one grant and clears the record when empty", () => {
        const state = stateWithNorthStar();
        resolveNorthStarAbility(state);
        resolveNorthStarAbility(state);
        consumeSpellManaSubstitutionGrant(state, "p1");
        expect(state.spellManaSubstitutionGrants?.p1).toEqual(["any-type"]);
        consumeSpellManaSubstitutionGrant(state, "p1");
        expect(state.spellManaSubstitutionGrants).toBeUndefined();
        // Idempotent when nothing is held.
        consumeSpellManaSubstitutionGrant(state, "p1");
        expect(state.spellManaSubstitutionGrants).toBeUndefined();
    });
});

describe("settleSpellManaSubstitutionGrant — spent only when it did the work", () => {
    /** North Star armed, Lightning Bolt in hand, the caller-supplied pool. */
    function armedWithBoltInHand(pool: Record<string, number>): GameState {
        const state = stateWithNorthStar();
        state.players[0].hand.push(
            makeInstance(lightningBolt.id, {
                id: "bolt-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        resolveNorthStarAbility(state);
        state.players[0].manaPool = pool;
        return state;
    }

    it("keeps the grant when the cost was already payable in its own colours", () => {
        const state = armedWithBoltInHand({ R: 1 });
        settleSpellManaSubstitutionGrant(
            state,
            state.players[0],
            { R: 1 },
            lightningBolt,
            "bolt-1"
        );
        expect(hasSpellManaSubstitutionGrant(state, "p1")).toBe(true);
    });

    it("spends the grant when the pool could not have covered the cost without it", () => {
        const state = armedWithBoltInHand({ G: 1 });
        settleSpellManaSubstitutionGrant(
            state,
            state.players[0],
            { R: 1 },
            lightningBolt,
            "bolt-1"
        );
        expect(hasSpellManaSubstitutionGrant(state, "p1")).toBe(false);
    });

    it("keeps the grant when the cost carries an ADDITIONAL component (CR 601.2f)", () => {
        // Same unpayable pool, but the cost is no longer the spell's own mana
        // cost — the permission was never offered, so it cannot be spent.
        const state = armedWithBoltInHand({ G: 1 });
        settleSpellManaSubstitutionGrant(
            state,
            state.players[0],
            { R: 1, X: 2 },
            lightningBolt,
            "bolt-1"
        );
        expect(hasSpellManaSubstitutionGrant(state, "p1")).toBe(true);
    });
});

describe("auto-tap reaches the grant through getManaSubstitutions (CR 605.1a)", () => {
    it("plans an off-colour Forest for a {R} cost only while the grant is live", () => {
        const state = stateWithNorthStar();
        state.players[0].battlefield.push(
            makeInstance(getCardByName("Forest").id, {
                id: "forest-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
        state.players[0].hand.push(
            makeInstance(lightningBolt.id, {
                id: "bolt-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        // Real source builder, not a hand-built list — the plan has to come
        // out of the same enumeration the cast path uses.
        const sources = buildAutoTapSources(
            state.players[0].battlefield,
            manaGateBattlefields(state)
        );

        const subs = () =>
            getCastManaSubstitutions(
                state,
                state.players[0],
                "bolt-1",
                lightningBolt,
                { R: 1 }
            );

        // No grant: the solver has no way to turn {G} into {R}.
        expect(solveAutoTap({}, { R: 1 }, subs(), sources)).toBeNull();

        resolveNorthStarAbility(state);
        expect(solveAutoTap({}, { R: 1 }, subs(), sources)).toEqual([
            { cardId: "forest-1" },
        ]);
    });
});

describe("CR 609.4b — the grant does not change the cost (wire format)", () => {
    it("the projected mana cost is identical with and without a live grant", () => {
        const state = stateWithNorthStar();
        const bolt = makeInstance(getCardByName("Lightning Bolt").id, {
            id: "bolt-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        state.players[0].hand.push(bolt);

        // Priced the way every client affordance prices a cast: off the
        // PROJECTED instance, through the same reducer the board renders from.
        const projectedCost = (projected: {
            players: { hand: (unknown | null)[] }[];
        }) =>
            getInstanceManaCost(
                projected.players[0].hand.find(
                    (c) => c !== null && (c as { id: string }).id === "bolt-1"
                ) as CardInstanceState
            );

        const beforeCost = projectedCost(projectPublicState(state, 1, "p1"));

        resolveNorthStarAbility(state);

        const afterCost = projectedCost(projectPublicState(state, 1, "p1"));

        // "It doesn't change that cost" — the projection the client prices
        // every affordance from is byte-identical.
        expect(afterCost).toEqual(beforeCost);
        expect(getCardByName("Lightning Bolt").manaCost).toEqual({ R: 1 });
    });
});

describe("serialization round-trip (drift guard)", () => {
    it("the one-shot grant and the per-card exile grant both survive save/load", () => {
        const state = stateWithNorthStar();
        resolveNorthStarAbility(state);
        const stolen = makeInstance(getCardByName("Lightning Bolt").id, {
            id: "stolen-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "exile",
        });
        stolen.castableFromExileBy = "p1";
        stolen.castFromExileManaSubstitution = "any-color";
        state.players[1].exile.push(stolen);

        const restored = expandState(compactState(state));
        expect(restored.spellManaSubstitutionGrants).toEqual({
            p1: ["any-type"],
        });
        expect(
            restored.players[1].exile.find((c) => c.id === "stolen-1")
                ?.castFromExileManaSubstitution
        ).toBe("any-color");
    });
});
