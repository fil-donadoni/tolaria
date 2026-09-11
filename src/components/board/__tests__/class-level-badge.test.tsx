// Issue #3234 — the Class level affordance (CR 716).
//
// The level has nowhere else to appear on the board: CR 716.4 / 711.7 keep it
// OUT of the counter system, so `CounterBadges` cannot render it the way it
// renders a Saga's lore counters. And the level alone is not the affordance —
// CR 716.2a admits exactly one bar at any moment (the one for level+1), so
// without its cost beside it the only way to learn the price is to open the
// ability menu.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import ClassLevelBadge from "../class-level-badge";

/** Stormchaser's Talent — BLB. Bars at {3}{U}: Level 2 and {5}{U}: Level 3. */
const TALENT = "a36e682d-b43d-4e08-bf5b-70d7e924dbe5";

afterEach(cleanup);

function card(over: Partial<CardInstance>): CardInstance {
    return {
        id: "c1",
        card: { id: TALENT },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        types: ["Enchantment"],
        subtypes: ["Class"],
        ...over,
    } as unknown as CardInstance;
}

const symbols = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("img")).map((img) =>
        img.getAttribute("alt")
    );

describe("ClassLevelBadge (CR 716)", () => {
    it("CR 716.2d — a Class with no stored level renders as level 1 and shows the level-2 bar's cost", () => {
        const { container } = render(<ClassLevelBadge card={card({})} />);
        const badge = container.querySelector("[data-class-level]")!;
        expect(badge.getAttribute("data-class-level")).toBe("1");
        expect(badge.textContent).toContain("Lv 1");
        expect(badge.textContent).toContain("→2");
        expect(symbols(container)).toEqual(["{3}", "{U}"]);
    });

    it("CR 716.2a — at level 2 it shows the NEXT bar, not the one already spent", () => {
        const { container } = render(
            <ClassLevelBadge card={card({ classLevel: 2 })} />
        );
        const badge = container.querySelector("[data-class-level]")!;
        expect(badge.getAttribute("data-class-level")).toBe("2");
        expect(badge.textContent).toContain("→3");
        expect(symbols(container)).toEqual(["{5}", "{U}"]);
    });

    it("at the top level the cost half disappears and the level stays", () => {
        const { container } = render(
            <ClassLevelBadge card={card({ classLevel: 3 })} />
        );
        const badge = container.querySelector("[data-class-level]")!;
        expect(badge.textContent).toBe("Lv 3");
        expect(symbols(container)).toEqual([]);
        expect(badge.getAttribute("aria-label")).toContain("maximum level");
    });

    it("renders nothing for a permanent that is not a Class", () => {
        const { container } = render(
            <ClassLevelBadge
                card={card({ subtypes: [], types: ["Creature"] })}
            />
        );
        expect(container.querySelector("[data-class-level]")).toBeNull();
    });
});
