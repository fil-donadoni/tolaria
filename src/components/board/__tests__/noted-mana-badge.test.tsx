// #753 — Jeweled Amulet / Ice Cauldron noted-mana indicator. The badge surfaces
// which mana colour the artifact has banked so the player can tell what its
// "remove a charge counter" ability will add. Asserts observable structure (a
// mana-symbol image per noted colour, a count when >1, nothing when no note).
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import NotedManaBadge from "../noted-mana-badge";

function makeCard(notedMana?: CardInstance["notedMana"]): CardInstance {
    return {
        id: "amulet",
        card: { id: "jeweled-amulet" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        ...(notedMana ? { notedMana } : {}),
    };
}

describe("NotedManaBadge (#753)", () => {
    beforeEach(() => cleanup());

    it("renders nothing when no mana is noted", () => {
        const { container } = render(<NotedManaBadge card={makeCard()} />);
        expect(container.firstChild).toBeNull();
    });

    it("renders nothing when the noted mana is empty", () => {
        const { container } = render(
            <NotedManaBadge card={makeCard({ mana: {} })} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("renders the noted colour as a mana symbol image", () => {
        const { container } = render(
            <NotedManaBadge card={makeCard({ mana: { R: 1 } })} />
        );
        const img = container.querySelector("img");
        expect(img).not.toBeNull();
        // ManaSymbol resolves {R} → /img/symbols/R.svg
        expect(img!.getAttribute("src")).toBe("/img/symbols/R.svg");
        // A single mana is not annotated with a count.
        expect(within(container).queryByText("1")).toBeNull();
    });

    it("shows the amount when more than one of a colour is noted", () => {
        const { container } = render(
            <NotedManaBadge card={makeCard({ mana: { U: 2 } })} />
        );
        const img = container.querySelector("img");
        expect(img!.getAttribute("src")).toBe("/img/symbols/U.svg");
        expect(within(container).getByText("2")).toBeTruthy();
    });

    it("renders one symbol per noted colour", () => {
        const { container } = render(
            <NotedManaBadge card={makeCard({ mana: { R: 1, G: 1 } })} />
        );
        const srcs = Array.from(container.querySelectorAll("img")).map((i) =>
            i.getAttribute("src")
        );
        expect(srcs).toEqual(
            expect.arrayContaining(["/img/symbols/R.svg", "/img/symbols/G.svg"])
        );
    });
});
