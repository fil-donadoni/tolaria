// CR 605.1a / 601.2f (issue #3384) — the client-side mana-ability affordability
// predicate reasons PER OPTION, not off the card's FIRST mana ability.
//
// `canAffordManaAbilityCost` decides whether a source reads as clickable at
// priority. It used to ask `getActivatedManaAbility` for ONE ability and judge
// the whole card by that ability's mana leg. A source whose costed option is
// not its first (Arena of Glory: free "{T}: Add {R}", then "{R}, {T}, Exert
// this land: Add {R}{R}") was therefore judged by an ability the player may not
// be activating — permissively in that direction, and in the MIRROR shape (a
// costed first ability beside a free second) it greyed out a source that was
// payable all along.
//
// No shipped card carries the mirror shape, so it is built here as a VARIANT
// definition served through `withTemporaryDefinition` — the catalogue object is
// deep-frozen in node test setup and may not be mutated.

import { describe, it, expect } from "vitest";
import { canAffordManaAbilityCost } from "../card-utils";
import { withTemporaryDefinition } from "@convex/cards";
import { arenaOfGlory } from "@convex/cards/sets/mh3/colorless";
import { mountain } from "@convex/cards/sets/lea";
import type { CardDefinition } from "@convex/cards/types";
import type { CardInstance } from "@/types/game";

const EMPTY_POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

function instanceOf(
    cardId: string,
    id: string,
    subtypes: string[] = []
): CardInstance {
    return {
        id,
        card: { id: cardId },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        types: ["Land"],
        subtypes,
    } as unknown as CardInstance;
}

/** Arena of Glory with its two mana abilities in the OPPOSITE printed order,
 *  so the costed one is what `getActivatedManaAbility` finds first. */
const costedFirst: CardDefinition = {
    ...arenaOfGlory,
    activatedAbilities: [...(arenaOfGlory.activatedAbilities ?? [])].reverse(),
};

/** …and one whose ONLY option is the costed one: genuinely unpayable with an
 *  empty pool and nothing else to tap. */
const costedOnly: CardDefinition = {
    ...arenaOfGlory,
    activatedAbilities: (arenaOfGlory.activatedAbilities ?? []).filter(
        (a) => a.cost.mana !== undefined
    ),
};

describe("canAffordManaAbilityCost — per option (CR 605.1a, issue #3384)", () => {
    it("admits a source whose FREE option is not its first, with an empty pool and nothing else to tap", () => {
        withTemporaryDefinition(costedFirst, () => {
            const arena = instanceOf(costedFirst.id, "arena");
            // Pre-fix: the first ability is the "{R}" one, the pool is empty
            // and there is no other untapped source, so the whole land greyed
            // out — while its plain "{T}: Add {R}" was payable all along.
            expect(canAffordManaAbilityCost(arena, EMPTY_POOL, [arena])).toBe(
                true
            );
        });
    });

    it("still subtracts the genuinely hopeless case — every option costed, nothing to fund it", () => {
        withTemporaryDefinition(costedOnly, () => {
            const arena = instanceOf(costedOnly.id, "arena");
            expect(canAffordManaAbilityCost(arena, EMPTY_POOL, [arena])).toBe(
                false
            );
        });
    });

    it("admits the same hopeless source once ANOTHER untapped source can fund it (CR 601.2g)", () => {
        withTemporaryDefinition(costedOnly, () => {
            const arena = instanceOf(costedOnly.id, "arena");
            const land = instanceOf(mountain.id, "mountain-0", ["Mountain"]);
            // The server auto-taps to fund the leg, so the client must not
            // pre-empt it — only the total absence of any way to produce mana
            // hides the source.
            expect(
                canAffordManaAbilityCost(arena, EMPTY_POOL, [arena, land])
            ).toBe(true);
        });
    });

    it("does not judge the card by an ability its own canActivate refuses (CR 602.5b)", () => {
        // CR 602.5b (issue #947) — an un-imprinted Chrome Mox has NO usable
        // mana ability, not one whose cost happens to be unpayable. Reading the
        // ability anyway would grey out a source for a cost it can never be
        // asked to pay. The gate needs a VIEW: with none supplied every
        // precondition would judge against an empty board (that is the Mox Opal
        // metalcraft regression `card-utils.test.ts` caught).
        const gated: CardDefinition = {
            ...costedOnly,
            activatedAbilities: (costedOnly.activatedAbilities ?? []).map(
                (a) => ({ ...a, canActivate: () => false })
            ),
        };
        withTemporaryDefinition(gated, () => {
            const arena = instanceOf(gated.id, "arena");
            expect(
                canAffordManaAbilityCost(arena, EMPTY_POOL, [arena], {
                    players: [],
                })
            ).toBe(true);
        });
    });

    it("leaves the shipped shape (free option first) tappable, as before", () => {
        const arena = instanceOf(arenaOfGlory.id, "arena");
        expect(canAffordManaAbilityCost(arena, EMPTY_POOL, [arena])).toBe(true);
    });
});
