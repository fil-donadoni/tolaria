/**
 * Activation-scoped mana substitution — a `scope` on the `mana-substitution`
 * STATIC (CR 609.4b / 602.1, issue #2944).
 *
 * CR 609.4b, printed: "If an effect allows a player to spend mana 'as though it
 * were mana of any [type or color],' this affects only how the player may pay a
 * cost. It doesn't change that cost, and it doesn't change what mana was
 * actually spent to pay that cost."
 *
 * Issue #2890 shipped that permission CAST-scoped. This file guards the other
 * axis — Agatha's Soul Cauldron's "you may spend mana as though it were mana of
 * any color to activate abilities of creatures you control" — and the four
 * things nothing else can catch:
 *
 *   1. An UNSCOPED static (Sunglasses of Urza) still reaches every cost. The
 *      whole change is a no-op for it, and only a test that reads the real card
 *      says so.
 *   2. A SCOPED static fails CLOSED at every payment site that does not name an
 *      activation — a spell cast, a morph/companion special action, a may-pay
 *      cost. That is the direction the bug would be silent in: an over-broad
 *      permission pays a cost the Oracle never reached and nothing goes red.
 *   3. The scope's `applies` predicate actually discriminates (an opponent's
 *      creature, a non-creature source), rather than being a boolean in
 *      disguise that a single `scope !== undefined` check would satisfy.
 *   4. The affordability probe, the auto-tap plan, the real payment and the
 *      BOT's planner all see the SAME set. A disagreement there is a bot
 *      freeze, not a cosmetic drift, so each is exercised through its own
 *      entry point rather than through `getManaSubstitutions` alone.
 */

import { describe, expect, it } from "vitest";
import type { ManaCost } from "../../cards/types";
import {
    getAbilityManaSubstitutions,
    getManaSubstitutions,
    getPlayer,
    isManaCostCovered,
    normalizeManaCost,
} from "../state";
import {
    activateAbilityOnState,
    applyManaAbilityManaCost,
    autoTapForManaAbilityCost,
    tryAutoCommitPendingActivation,
} from "../../game";
import { substitutionsForBreadth } from "../manaColors";
import {
    ARTIFACT_ID,
    board,
    CREATURE_ID,
    MANA_CREATURE_ID,
} from "./fixtures/manaSubstitutionScopeProbe";
import { makeInstance, makeState } from "../../cards/__tests__/setup";
import { sunglassesOfUrza } from "../../cards/sets/lea";
import { forest } from "../../cards/sets/lea";

describe("CR 609.4b — an UNSCOPED mana-substitution static is untouched", () => {
    it("Sunglasses of Urza still reaches every cost, named activation or not", () => {
        const state = makeState();
        state.players[0].battlefield.push(
            makeInstance(sunglassesOfUrza.id, { id: "sunglasses-1" })
        );
        const creature = makeInstance(CREATURE_ID, { id: "creature-1" });
        state.players[0].battlefield.push(creature);

        // The plain call — every non-cast payment site in the engine.
        expect(getManaSubstitutions(state, "p1")).toEqual([
            { from: "W", to: "R" },
        ]);
        // And the ability seam, which must add nothing and remove nothing.
        expect(getAbilityManaSubstitutions(state, "p1", creature)).toEqual([
            { from: "W", to: "R" },
        ]);
        // Including for a source the Cauldron's predicate would have rejected.
        expect(getAbilityManaSubstitutions(state, "p1", undefined)).toEqual([
            { from: "W", to: "R" },
        ]);
    });
});

describe("CR 609.4b / 602.1 — a SCOPED static reaches only the activation", () => {
    it("is withheld from every caller that names no activation", () => {
        const { state } = board();
        // A spell cast, a morph or companion special action and a may-pay cost
        // all reach `getManaSubstitutions` with no ability source. Fails CLOSED.
        expect(getManaSubstitutions(state, "p1")).toEqual([]);
        expect(getManaSubstitutions(state, "p1", "some-cast-id")).toEqual([]);
    });

    it("is returned for an activated ability of a creature its controller controls", () => {
        const { state, creature } = board();
        const subs = getAbilityManaSubstitutions(state, "p1", creature);
        // CR 105.1 — five colours are legal targets, `{C}` is not; the pairs
        // come from the single generator, so this is the generator's own set.
        expect(subs).toEqual(substitutionsForBreadth("any-color"));
        expect(subs).toHaveLength(25);
        expect(subs.some((s) => s.to === "C")).toBe(false);
        expect(subs).toContainEqual({ from: "G", to: "R" });
        // CR 107.4c — colorless mana spent as a colour is what the permission
        // allows; the reverse (a `{C}` pip paid with a colour) is "any-type".
        expect(subs).toContainEqual({ from: "C", to: "R" });
    });

    it("discriminates on the predicate, not on the presence of a scope", () => {
        const { state, artifact, theirCreature } = board();
        // "creatures you control" — a noncreature permanent of the controller's
        expect(getAbilityManaSubstitutions(state, "p1", artifact)).toEqual([]);
        // ... and a creature the controller does NOT control.
        expect(getAbilityManaSubstitutions(state, "p1", theirCreature)).toEqual(
            []
        );
    });

    it("vanishes with its source (CR 611.2 — derived live)", () => {
        const { state, creature } = board();
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "cauldron-1"
        );
        expect(getAbilityManaSubstitutions(state, "p1", creature)).toEqual([]);
    });
});

describe("CR 602.1 — probe, auto-tap and payment agree (issue #2944)", () => {
    it("makes a {R} ability of a controlled creature payable with {G}", () => {
        const { state, creature } = board({ G: 1 });
        const cost = normalizeManaCost({ R: 1 } as ManaCost);
        const subs = getAbilityManaSubstitutions(state, "p1", creature);
        // A spare Forest, untouched by a correct run: the floating {G} already
        // covers the {R} through the permission. It is what makes the
        // affordability PROBE observable — a probe that reads the unscoped set
        // declares the cost uncovered, parks a payment phase and auto-taps this
        // land before the (correctly scoped) commit settles anyway. Same end
        // state on the stack, one land burned for nothing.
        getPlayer(state, "p1").battlefield.push(
            makeInstance(forest.id, { id: "forest-1" })
        );

        // The affordability probe agrees ...
        expect(
            isManaCostCovered(getPlayer(state, "p1").manaPool, cost, subs)
        ).toBe(true);
        // ... and so does the real activation: it commits inline instead of
        // parking a payment phase, and the {G} is what paid the {R}.
        const lifeBefore = getPlayer(state, "p1").life;
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: creature.id,
            abilityId: "red-gain",
        });
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(getPlayer(state, "p1").manaPool.G ?? 0).toBe(0);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore);
        expect(
            getPlayer(state, "p1").battlefield.find((c) => c.id === "forest-1")
                ?.isTapped
        ).toBe(false);
    });

    it("commits a PARKED activation once the off-colour mana arrives", () => {
        // The deferred-payment flow, which the inline commit above never
        // reaches: announce with an empty pool, park, tap, commit. This is the
        // path `tryAutoCommitPendingActivation` owns, and the one whose source
        // lookup had to be hoisted above its own coverage check
        // (`findPendingActivationSource`) for the scope to be visible there.
        const { state, creature } = board();
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: creature.id,
            abilityId: "red-gain",
        });
        expect(state.pendingActivation?.manaCost).toEqual({ R: 1 });

        getPlayer(state, "p1").manaPool = { G: 1 };
        const committed = tryAutoCommitPendingActivation(state, "p1");
        expect(committed).not.toBeNull();
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(getPlayer(state, "p1").manaPool.G ?? 0).toBe(0);
    });

    it("does NOT make the same {R} ability of a NONCREATURE payable with {G}", () => {
        const { state, artifact } = board({ G: 1 });
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: artifact.id,
            abilityId: "red-gain",
        });
        // The predicate rejected the source, so the cost is unpaid and the
        // activation parks awaiting mana — the fail-closed direction.
        expect(state.stack).toHaveLength(0);
        expect(state.pendingActivation?.manaCost).toEqual({ R: 1 });
    });

    it("auto-taps a Forest for a {R} ability cost under the permission", () => {
        const { state, creature } = board();
        const player = getPlayer(state, "p1");
        const land = makeInstance(forest.id, { id: "forest-1" });
        player.battlefield.push(land);

        const ability = {
            id: "red-gain",
            oracleText: "{R}: You gain 1 life.",
            cost: { mana: { R: 1 } as ManaCost },
            useStack: true,
        };
        autoTapForManaAbilityCost(state, player, creature, ability as never);

        // The Forest was tapped and its {G} now covers the {R} pip through the
        // very substitutions the payment will use.
        expect(
            player.battlefield.find((c) => c.id === "forest-1")?.isTapped
        ).toBe(true);
        expect(
            isManaCostCovered(
                player.manaPool,
                normalizeManaCost({ R: 1 } as ManaCost),
                getAbilityManaSubstitutions(state, "p1", creature)
            )
        ).toBe(true);
    });

    it("leaves the auto-tap alone when the source is not a creature", () => {
        const { state, artifact } = board();
        const player = getPlayer(state, "p1");
        player.battlefield.push(makeInstance(forest.id, { id: "forest-1" }));
        autoTapForManaAbilityCost(state, player, artifact, {
            id: "red-gain",
            oracleText: "{R}: You gain 1 life.",
            cost: { mana: { R: 1 } as ManaCost },
            useStack: true,
        } as never);
        // Nothing the board can make pays a {R}, so no source is burned.
        expect(
            player.battlefield.find((c) => c.id === "forest-1")?.isTapped
        ).toBe(false);
    });
});

describe("CR 605.1a — a mana ability's OWN cost goes through the same seam", () => {
    it("auto-tap and the mana-ability payment agree (issue #2944 review)", () => {
        // The one payment site with its own affordability throw and no stack
        // item. Before it read the ability seam, `autoTapForManaAbilityCost`
        // reserved a Forest under the permission and this threw "Not enough
        // mana to activate this ability" on the very next line.
        const { state } = board();
        const player = getPlayer(state, "p1");
        const sprites = makeInstance(MANA_CREATURE_ID, { id: "sprites-1" });
        player.battlefield.push(sprites);
        player.battlefield.push(makeInstance(forest.id, { id: "forest-1" }));
        const ability = {
            id: "red-for-white",
            oracleText: "{R}, {T}: Add {W}.",
            cost: { mana: { R: 1 } as ManaCost, tap: true },
            useStack: false,
            manaProduced: { W: 1 } as ManaCost,
        };

        autoTapForManaAbilityCost(state, player, sprites, ability as never);
        expect(
            player.battlefield.find((c) => c.id === "forest-1")?.isTapped
        ).toBe(true);
        expect(() =>
            applyManaAbilityManaCost(state, player, ability as never, sprites)
        ).not.toThrow();
        expect(player.manaPool.G ?? 0).toBe(0);
    });

    it("still refuses the same cost when the source is outside the scope", () => {
        const { state } = board({ G: 1 });
        const player = getPlayer(state, "p1");
        const rock = makeInstance(ARTIFACT_ID, { id: "rock-1" });
        player.battlefield.push(rock);
        expect(() =>
            applyManaAbilityManaCost(
                state,
                player,
                {
                    id: "red-for-white",
                    cost: { mana: { R: 1 } as ManaCost, tap: true },
                    useStack: false,
                } as never,
                rock
            )
        ).toThrow("Not enough mana");
    });
});

describe("CR 110.1 — a source outside the battlefield is not a permanent", () => {
    it("withholds the permission from a graveyard- or hand-source ability", () => {
        // CR 113.6 / 702.29a — Ashen Ghoul's graveyard activation and a Cycling
        // cost both reach the seam with a `CardInstanceState` in another zone.
        // `PermanentView` carries no `zone`, so the card's own predicate cannot
        // see it: the gate is the seam's, and it fails closed.
        const { state } = board();
        const inGraveyard = makeInstance(CREATURE_ID, {
            id: "creature-gy",
            zone: "graveyard",
        });
        const inHand = makeInstance(CREATURE_ID, {
            id: "creature-hand",
            zone: "hand",
        });
        getPlayer(state, "p1").graveyard.push(inGraveyard);
        getPlayer(state, "p1").hand.push(inHand);

        expect(getAbilityManaSubstitutions(state, "p1", inGraveyard)).toEqual(
            []
        );
        expect(getAbilityManaSubstitutions(state, "p1", inHand)).toEqual([]);
    });
});
