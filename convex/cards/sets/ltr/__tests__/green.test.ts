// Per-card behavior tests for green cards in `convex/cards/sets/ltr/green.ts`
// (LTR, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises.

import { describe, it, expect } from "vitest";
import { counterspell } from "../../lea";
import { theOneRing } from "../colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { tryAutoCommitPendingCast } from "../../../../game";
import {
    addRestrictedManaToPool,
    payManaCostForSpell,
    resolveTopOfStack,
    restrictionAllowsSpell,
    spendablePoolForSpell,
    type GameState,
    type StackItem,
} from "../../../../gre/state";

describe("Delighted Halfling (LTR #158, CR 106.6 / 701.13, issue #1559)", () => {
    it("restrictionAllowsSpell gates legendary-spell mana on the SUPERTYPE, not card type", () => {
        // Keyed on supertype: any card type is fine as long as "Legendary" is
        // among the supertypes.
        expect(
            restrictionAllowsSpell(
                "legendary-spell",
                ["Creature"],
                ["Legendary"]
            )
        ).toBe(true);
        expect(
            restrictionAllowsSpell(
                "legendary-spell",
                ["Artifact"],
                ["Legendary"]
            )
        ).toBe(true);
        // No "Legendary" supertype -> ineligible, regardless of card type.
        expect(
            restrictionAllowsSpell("legendary-spell", ["Creature"], [])
        ).toBe(false);
        expect(restrictionAllowsSpell("legendary-spell", ["Creature"])).toBe(
            false
        );
    });

    it("pays a legendary spell from legendary-spell-restricted mana but rejects a non-legendary spell", () => {
        const caster = makePlayer("p1", {
            restrictedMana: [
                {
                    color: "G",
                    amount: 1,
                    restriction: "legendary-spell",
                    cantBeCounteredRider: true,
                },
            ],
        });
        // The One Ring is a Legendary Artifact (CR 205.4a).
        const legendaryTypes = theOneRing.types;
        const legendarySupertypes = theOneRing.supertypes ?? [];
        expect(
            spendablePoolForSpell(
                caster,
                legendaryTypes,
                undefined,
                legendarySupertypes
            ).G
        ).toBe(1);

        // A non-legendary spell (plain card types, no supertypes) can't spend it.
        const nonLegendary = makePlayer("p1", {
            restrictedMana: [
                {
                    color: "G",
                    amount: 1,
                    restriction: "legendary-spell",
                    cantBeCounteredRider: true,
                },
            ],
        });
        expect(
            spendablePoolForSpell(nonLegendary, ["Creature"], undefined, [])
                .G ?? 0
        ).toBe(0);
    });

    it("payManaCostForSpell reports whether the spent mana carried the can't-be-countered rider", () => {
        const withRider = makePlayer("p1", {
            restrictedMana: [
                {
                    color: "G",
                    amount: 1,
                    restriction: "legendary-spell",
                    cantBeCounteredRider: true,
                },
            ],
        });
        const usedRider = payManaCostForSpell(
            withRider,
            { G: 1 },
            theOneRing.types,
            [],
            undefined,
            undefined,
            theOneRing.supertypes ?? []
        );
        expect(usedRider).toBe(true);
        expect(withRider.restrictedMana).toBeUndefined();

        // Paying entirely from the fungible pool (no restricted mana touched)
        // never reports the rider.
        const fromPool = makePlayer("p1", {
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        });
        const usedRiderFromPool = payManaCostForSpell(
            fromPool,
            { G: 1 },
            theOneRing.types,
            [],
            undefined,
            undefined,
            theOneRing.supertypes ?? []
        );
        expect(usedRiderFromPool).toBe(false);
    });

    it("addRestrictedManaToPool keeps rider and non-rider units of the same color/restriction separate", () => {
        const player = makePlayer("p1");
        addRestrictedManaToPool(
            player,
            "G",
            1,
            "legendary-spell",
            undefined,
            true
        );
        addRestrictedManaToPool(
            player,
            "G",
            1,
            "legendary-spell",
            undefined,
            false
        );
        expect(player.restrictedMana).toEqual([
            {
                color: "G",
                amount: 1,
                restriction: "legendary-spell",
                cantBeCounteredRider: true,
            },
            { color: "G", amount: 1, restriction: "legendary-spell" },
        ]);
        // A second deposit WITH the rider merges into the first unit.
        addRestrictedManaToPool(
            player,
            "G",
            2,
            "legendary-spell",
            undefined,
            true
        );
        expect(player.restrictedMana).toEqual([
            {
                color: "G",
                amount: 3,
                restriction: "legendary-spell",
                cantBeCounteredRider: true,
            },
            { color: "G", amount: 1, restriction: "legendary-spell" },
        ]);
    });

    /** Builds a state with a legendary spell (The One Ring) in p1's hand and a
     *  pending cast for it, ready for `tryAutoCommitPendingCast`. */
    function pendingLegendaryCast(
        restrictedMana: NonNullable<
            ReturnType<typeof makePlayer>["restrictedMana"]
        >
    ): GameState {
        const ring = makeInstance(theOneRing.id, { id: "ring", zone: "hand" });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [ring], restrictedMana }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "ring",
            manaCost: { G: 1 },
            tappedLandIds: [],
        };
        return state;
    }

    it("tryAutoCommitPendingCast stamps dynamicCantBeCountered when the payment drew on rider mana", () => {
        const state = pendingLegendaryCast([
            {
                color: "G",
                amount: 1,
                restriction: "legendary-spell",
                cantBeCounteredRider: true,
            },
        ]);
        const committed = tryAutoCommitPendingCast(state, "p1");
        expect(committed).not.toBeNull();
        const stackItem = state.stack.find((s) => s.id === "ring") as
            | StackItem
            | undefined;
        expect(stackItem).toBeDefined();
        expect(stackItem?.dynamicCantBeCountered).toBe(true);
        // The restricted mana was actually consumed, not left floating.
        expect(state.players[0].restrictedMana).toBeUndefined();
    });

    it("tryAutoCommitPendingCast leaves dynamicCantBeCountered unset when no rider mana was spent", () => {
        const state = pendingLegendaryCast([
            { color: "G", amount: 1, restriction: "legendary-spell" },
        ]);
        const committed = tryAutoCommitPendingCast(state, "p1");
        expect(committed).not.toBeNull();
        const stackItem = state.stack.find((s) => s.id === "ring") as
            | StackItem
            | undefined;
        expect(stackItem?.dynamicCantBeCountered).toBeUndefined();
    });

    it("counter() fizzles against a spell carrying dynamicCantBeCountered (CR 106.6 / 701.13)", () => {
        const state = makeState();
        const target = pushSpell(state, theOneRing.id, "p2");
        target.dynamicCantBeCountered = true;
        pushSpell(state, counterspell.id, "p1", [
            { type: "spell", id: target.id },
        ]);
        resolveTopOfStack(state);
        // The counter attempt fizzles (CR 701.5c-style): the target spell
        // stays on the stack.
        expect(state.stack.find((s) => s.id === target.id)).toBeDefined();
    });

    it("control: the same spell WITHOUT the rider is countered normally", () => {
        const state = makeState();
        const target = pushSpell(state, theOneRing.id, "p2");
        pushSpell(state, counterspell.id, "p1", [
            { type: "spell", id: target.id },
        ]);
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === target.id)).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === target.id)).toBe(
            true
        );
    });

    it("dynamicCantBeCountered and the restricted-mana rider survive the wire projection", () => {
        const state = pendingLegendaryCast([
            {
                color: "G",
                amount: 1,
                restriction: "legendary-spell",
                cantBeCounteredRider: true,
            },
        ]);
        tryAutoCommitPendingCast(state, "p1");
        const projected = projectPublicState(state, 1, "p1");
        const projectedStackItem = projected.stack.find(
            (s) => s.id === "ring"
        ) as StackItem | undefined;
        expect(projectedStackItem?.dynamicCantBeCountered).toBe(true);

        // A second, untouched player floating the rider unit still shows it
        // after projection (the mana-pool UI reads this).
        const state2 = makeState({
            players: [
                makePlayer("p1", {
                    restrictedMana: [
                        {
                            color: "G",
                            amount: 1,
                            restriction: "legendary-spell",
                            cantBeCounteredRider: true,
                        },
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const projected2 = projectPublicState(state2, 1, "p1");
        expect(projected2.players[0].restrictedMana).toEqual([
            {
                color: "G",
                amount: 1,
                restriction: "legendary-spell",
                cantBeCounteredRider: true,
            },
        ]);
    });
});
