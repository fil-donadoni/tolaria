// The CLIENT half of issue #3263's seam (CR 605.1a).
//
// The engine now taps a fixed multi-colour mana ability for its full output,
// but the board decides on its own whether the permanent is clickable while
// paying a cost, and it decided with probes that all answer "no" for this
// shape: `getActivatedManaColor` returns a single `Color`, so a {W}{B} output
// is null; `hasFixedSacrificeManaAbility` matches only a TAP-LESS sacrifice
// cost; `getManaChoices` matches only a chooser. Offered by the server and not
// clickable on the board is the ADR 0068 divergence the other way round.
//
// Driven through `projectPublicState`: a hand-built instance would mask a
// wire-dropped field, and the client only ever sees the projection.

import { describe, it, expect, beforeAll } from "vitest";
import {
    getActivatedManaColor,
    getManaChoices,
    hasFixedMultiColorTapManaAbility,
    hasFixedSacrificeManaAbility,
    hasManaAbility,
    manaActivationRequiresTap,
} from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import { preloadDefinitions } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";

/** "{T}: Add {W}{B}." with no single-colour ability to fall back on. No
 *  catalogue card is this shape (the Invasion "Vent" lands pair theirs with a
 *  single-colour `{T}: Add {U}`), and the shape is reachable in production only
 *  through a GRANTED ability — so it is a test-only definition, shadowing no
 *  catalogue id. See `convex/__tests__/multiColorFixedTapMana.test.ts`. */
const PRISM_VENT: CardDefinition = {
    id: "test-3263-wire-prism-vent",
    name: "Test Prism Vent",
    rarity: "common",
    oracleText: "{T}: Add {W}{B}.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "test-3263-wire-prism-vent-tap",
            oracleText: "{T}: Add {W}{B}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { W: 1, B: 1 },
        },
    ],
};

beforeAll(() => {
    preloadDefinitions([PRISM_VENT]);
});

/** The definition on p1's battlefield, projected onto the wire and read back
 *  exactly as the client reads it. */
function projectedPermanent(defId: string): CardInstance {
    const instance = makeInstance(defId, {
        id: "wire-source",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
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

describe("multi-colour fixed TAP mana sources on the client (CR 605.1a, issue #3263)", () => {
    it("the {W}{B} output survives the projection and the new probe sees it", () => {
        const vent = projectedPermanent(PRISM_VENT.id);
        expect(hasManaAbility(vent)).toBe(true);
        expect(hasFixedMultiColorTapManaAbility(vent)).toBe(true);
        // The three probes the payment-clickability gate used to rely on, all
        // of which answer "not a payment source" for this shape.
        expect(getActivatedManaColor(vent)).toBeNull();
        expect(hasFixedSacrificeManaAbility(vent)).toBe(false);
        expect(getManaChoices(vent)).toBeNull();
        // CR 302.6 — it DOES pay {T}, unlike the sacrifice-only shape.
        expect(manaActivationRequiresTap(vent)).toBe(true);
    });

    it("a single-colour tap source is NOT claimed by the new probe", () => {
        const elves = projectedPermanent(getCardByName("Llanowar Elves").id);
        expect(hasFixedMultiColorTapManaAbility(elves)).toBe(false);
        expect(getActivatedManaColor(elves)).toBe("G");
    });

    it("a same-colour-MULTIPLE tap source is not claimed either (Sol Ring)", () => {
        const ring = projectedPermanent(getCardByName("Sol Ring").id);
        expect(hasFixedMultiColorTapManaAbility(ring)).toBe(false);
        expect(getActivatedManaColor(ring)).toBe("C");
    });

    it("the tap-less sacrifice shape stays with its own probe (Morgue Toad)", () => {
        const toad = projectedPermanent(getCardByName("Morgue Toad").id);
        expect(hasFixedMultiColorTapManaAbility(toad)).toBe(false);
        expect(hasFixedSacrificeManaAbility(toad)).toBe(true);
    });

    it("Ancient Spring keeps its single-colour answer (the catalogue near-miss)", () => {
        // Its "{T}, Sacrifice this land: Add {W}{B}." IS a multi-colour tap
        // ability, so the probe claims the card — but the gate consults it only
        // when `getActivatedManaColor` has no answer, and here it has one.
        const spring = projectedPermanent(getCardByName("Ancient Spring").id);
        expect(getActivatedManaColor(spring)).toBe("U");
    });
});
