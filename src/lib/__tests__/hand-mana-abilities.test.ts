// A mana ability activated from the HAND (CR 113.6m / 605.1a, issue #5326) —
// "Exile this card from your hand: Add {G}." on Elvish Spirit Guide, the
// catalogue card. The client offers it on the hand card
// (`getHandManaAbilities`) and NEVER on the permanent the same card becomes
// (`getManaCostMenuAbility`, `hasManaAbility`): CR 113.6m makes the ability
// function only in the zone its cost moves the card out of. The view is built
// through `buildTriggerStateView`, as the board builds it.

import { describe, it, expect } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    buildTriggerStateView,
    getHandManaAbilities,
    getHandStackAbilities,
    getManaCostMenuAbility,
    hasManaAbility,
} from "../card-utils";
import type { CardInstance } from "~/types/game";

const GUIDE_ID = getCardByName("Elvish Spirit Guide").id;

function guide(zone: "hand" | "battlefield"): CardInstance {
    return {
        id: "guide-1",
        card: { id: GUIDE_ID },
        controllerId: "p1",
        ownerId: "p1",
        zone,
        isTapped: false,
        types: ["Creature"],
        subtypes: ["Elf", "Spirit"],
    } as CardInstance;
}

function viewWith(card: CardInstance) {
    return buildTriggerStateView(
        [
            {
                id: "p1",
                life: 20,
                hand: card.zone === "hand" ? [card] : [],
                battlefield: card.zone === "battlefield" ? [card] : [],
                graveyard: [],
            },
        ],
        "p1"
    );
}

describe("hand mana ability on the client (CR 113.6m / 605.1a)", () => {
    it("is offered on the hand card, as a mana ability", () => {
        const card = guide("hand");
        expect(
            getHandManaAbilities(card, "PRECOMBAT_MAIN", viewWith(card))
        ).toEqual([
            {
                id: "elvish-spirit-guide-mana",
                oracleText: "Exile this card from your hand: Add {G}.",
            },
        ]);
        // Never through the stack-ability menu, which dispatches
        // `activateAbility` — the wrong mutation for a mana ability.
        expect(
            getHandStackAbilities(card, "PRECOMBAT_MAIN", viewWith(card))
        ).toEqual([]);
    });

    it("never lists a STACK hand ability (Raugrin Triome's Cycling)", () => {
        const triome = {
            ...guide("hand"),
            id: "triome-1",
            card: { id: getCardByName("Raugrin Triome").id },
            types: ["Land"],
        } as CardInstance;
        expect(
            getHandManaAbilities(triome, "PRECOMBAT_MAIN", viewWith(triome))
        ).toEqual([]);
    });

    it("is not offered on the permanent", () => {
        const card = guide("battlefield");
        expect(getManaCostMenuAbility(card, viewWith(card))).toBeNull();
        expect(hasManaAbility(card)).toBe(false);
    });
});
