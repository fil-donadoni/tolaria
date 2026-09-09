// Issue #3299 — the on-card loyalty shield is gated on HAVING loyalty, not on
// being a planeswalker.
//
// CR 606.2: "an activated ability with a loyalty symbol in its cost is a
// loyalty ability. Normally, only planeswalkers have loyalty abilities" —
// normally, not only. A creature granted one (Agatha's Soul Cauldron copying
// Grist, the Hunger Tide's abilities out of exile) pays `+N` onto ITSELF, and
// while the badge read `isPlaneswalker` those counters were invisible: the
// player could not see them accumulate and could not tell whether a `-N` cost
// was affordable under CR 606.6.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import LoyaltyBadge from "../loyalty-badge";

/** Grist, the Hunger Tide — MH2. Its `+1` is a real loyalty ability. */
const GRIST = "69af2825-18c2-4463-b6ba-42eaa070ccc1";

afterEach(cleanup);

function card(over: Partial<CardInstance>): CardInstance {
    return {
        id: "c1",
        card: { id: "def-1" },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        types: ["Creature"],
        subtypes: [],
        ...over,
    } as unknown as CardInstance;
}

describe("LoyaltyBadge (CR 606.2 / 122.1e, issue #3299)", () => {
    it("renders the shield on a NON-planeswalker holding loyalty counters", () => {
        const { container } = render(
            <LoyaltyBadge card={card({ counters: { loyalty: 3 } })} />
        );
        const shield = container.querySelector("[data-loyalty-shield]");
        expect(shield).not.toBeNull();
        expect(shield?.getAttribute("aria-label")).toBe("3 loyalty");
        expect(shield?.textContent).toBe("3");
    });

    it("renders nothing for an ordinary creature with no loyalty and no loyalty ability", () => {
        const { container } = render(
            <LoyaltyBadge card={card({ counters: { "+1/+1": 1 } })} />
        );
        expect(container.querySelector("[data-loyalty-shield]")).toBeNull();
        // An explicit zero in the map is the same answer — the count is not
        // what the predicate reads when nothing can hold loyalty here.
        const bare = render(
            <LoyaltyBadge card={card({ counters: { loyalty: 0 } })} />
        );
        expect(
            bare.container.querySelector("[data-loyalty-shield]")
        ).toBeNull();
    });

    it("renders the zero of a creature that HOLDS a loyalty ability", () => {
        // The `-2` emptied it (CR 606.6 allows landing on 0) and CR 704.5i does
        // not remove a creature, so the shield stays up at zero. `grantedActivatedAbilities`
        // is the shape `projectPublicState` hands the client for a Cauldron grant.
        const { container } = render(
            <LoyaltyBadge
                card={card({
                    counters: { loyalty: 0 },
                    grantedActivatedAbilities: [
                        {
                            sourceCardId: GRIST,
                            abilityId: "grist-the-hunger-tide-plus1",
                            origin: "card-abilities",
                            auraId: "cauldron",
                            seq: 1,
                        },
                    ],
                })}
            />
        );
        expect(
            container
                .querySelector("[data-loyalty-shield]")
                ?.getAttribute("aria-label")
        ).toBe("0 loyalty");
    });

    it("clears the P/T box on a creature and sits on the printed shield otherwise (QA)", () => {
        // A planeswalker's own printed loyalty shield is the only thing in that
        // corner, so the badge sits right on it. A CREATURE has its P/T box
        // there instead, and at 1.5% the shield overflows it.
        const pw = render(
            <LoyaltyBadge
                card={card({
                    types: ["Planeswalker"],
                    counters: { loyalty: 3 },
                })}
            />
        );
        expect(
            (pw.container.querySelector("[data-loyalty-shield]") as HTMLElement)
                .style.bottom
        ).toBe("1.5%");

        cleanup();
        const creature = render(
            <LoyaltyBadge card={card({ counters: { loyalty: 3 } })} />
        );
        expect(
            (
                creature.container.querySelector(
                    "[data-loyalty-shield]"
                ) as HTMLElement
            ).style.bottom
        ).toBe("13.5%");
    });

    it("still renders a planeswalker's zero (CR 122.1e — the SBA has not run yet)", () => {
        const { container } = render(
            <LoyaltyBadge
                card={card({ types: ["Planeswalker"], counters: {} })}
            />
        );
        const shield = container.querySelector("[data-loyalty-shield]");
        expect(shield?.getAttribute("aria-label")).toBe("0 loyalty");
    });
});
