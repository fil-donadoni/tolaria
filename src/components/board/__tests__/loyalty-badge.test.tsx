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

    it("renders nothing for a creature with no loyalty counters", () => {
        const { container } = render(
            <LoyaltyBadge card={card({ counters: { "+1/+1": 1 } })} />
        );
        expect(container.querySelector("[data-loyalty-shield]")).toBeNull();
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
