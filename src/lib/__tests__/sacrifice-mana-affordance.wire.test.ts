// The CLIENT half of issue #2021's seam (CR 605.1a / 302.6).
//
// The engine can activate a sacrifice-only mana ability, but the board decides
// on its own whether the permanent is clickable at all, and it decided with two
// probes that both answer "no" for this shape: `getActivatedManaColor` (matches
// only a `cost.tap` ability, and returns a single `Color`, so a {U}{R} output
// is null even when it matches) and `isTapLockedBySummoningSickness` (applied
// unconditionally, though CR 302.6 gates only a cost containing the tap or
// untap symbol). An Eldrazi Spawn token is summoning sick for exactly the turn
// a player wants to sacrifice it.
//
// Driven through `projectPublicState`: a hand-built instance would mask a
// wire-dropped field, and the client only ever sees the projection.

import { describe, it, expect } from "vitest";
import {
    getActivatedManaColor,
    hasFixedSacrificeManaAbility,
    hasManaAbility,
    manaActivationRequiresTap,
} from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import { createTokenPermanents } from "@convex/gre/state";
import { ELDRAZI_SPAWN_TOKEN } from "@convex/cards/sharedTokens";
import type { TokenSpec } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";

/** The named card on p1's battlefield, projected onto the wire and read back
 *  exactly as the client reads it. */
function projectedPermanent(
    cardName: string,
    overrides: Record<string, unknown> = {}
): CardInstance {
    const instance = makeInstance(getCardByName(cardName).id, {
        id: "wire-source",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
        ...overrides,
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [instance] }),
            makePlayer("p2"),
        ],
    });
    const wire = projectPublicState(state, 1, "p1");
    return wire.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === "wire-source") as unknown as CardInstance;
}

describe("sacrifice-only mana sources on the client (CR 605.1a, issue #2021)", () => {
    it("Tinder Wall reads as a mana source the tap-colour probe cannot see", () => {
        const wall = projectedPermanent("Tinder Wall");
        expect(hasManaAbility(wall)).toBe(true);
        expect(hasFixedSacrificeManaAbility(wall)).toBe(true);
        // The probe the payment-clickability gate used to rely on alone.
        expect(getActivatedManaColor(wall)).toBeNull();
    });

    it("Morgue Toad's MULTI-colour output is recognised", () => {
        const toad = projectedPermanent("Morgue Toad");
        expect(hasFixedSacrificeManaAbility(toad)).toBe(true);
        expect(getActivatedManaColor(toad)).toBeNull();
    });

    it("a tap mana source is NOT claimed by the sacrifice probe", () => {
        const elves = projectedPermanent("Llanowar Elves");
        expect(hasFixedSacrificeManaAbility(elves)).toBe(false);
        expect(getActivatedManaColor(elves)).toBe("G");
    });

    it("Lion's Eye Diamond (a CHOICE ability) is not claimed either", () => {
        const led = projectedPermanent("Lion's Eye Diamond");
        expect(hasFixedSacrificeManaAbility(led)).toBe(false);
    });
});

describe("what the summoning-sickness gate asks (CR 302.6, issue #2021)", () => {
    it("a sacrifice-only mana cost does not require {T}", () => {
        expect(
            manaActivationRequiresTap(projectedPermanent("Tinder Wall"))
        ).toBe(false);
    });

    it("a {T} mana ability does", () => {
        expect(
            manaActivationRequiresTap(projectedPermanent("Llanowar Elves"))
        ).toBe(true);
    });

    it("a basic land does", () => {
        expect(manaActivationRequiresTap(projectedPermanent("Forest"))).toBe(
            true
        );
    });

    it("the Eldrazi Spawn token is a summoning-sick, tap-less mana source", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // See the engine-side test: the spec declares no `triggeredAbilities`,
        // the one field where `EffectTokenSpec` and `TokenSpec` diverge.
        const [id] = createTokenPermanents(
            state,
            ELDRAZI_SPAWN_TOKEN as TokenSpec,
            "p1"
        );
        const wire = projectPublicState(state, 1, "p1");
        const token = wire.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === id) as unknown as CardInstance;

        expect(token.isSummoningSick).toBe(true);
        expect(hasManaAbility(token)).toBe(true);
        expect(hasFixedSacrificeManaAbility(token)).toBe(true);
        // Both together are the board's verdict: sick, but nothing to gate.
        expect(manaActivationRequiresTap(token)).toBe(false);
    });
});
