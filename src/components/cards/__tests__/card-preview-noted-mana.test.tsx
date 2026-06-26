// #754 — the card preview must show the mana noted on a battery permanent
// (CR 106.10 — Ice Cauldron / Jeweled Amulet) so the player can read the stored
// type/amount. Mirrors the counters section. These assert the section renders a
// mana symbol per noted colour with a count when >1, and nothing when no note.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import CardPreviewNotedMana from "../card-preview-noted-mana";

describe("CardPreviewNotedMana (#754, CR 106.10)", () => {
    beforeEach(() => cleanup());

    it("renders nothing when no mana is noted", () => {
        const { container } = render(
            <CardPreviewNotedMana noted={undefined} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("renders nothing when the noted mana is empty", () => {
        const { container } = render(
            <CardPreviewNotedMana noted={{ mana: {} }} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("shows the noted colour as a mana symbol and the section header", () => {
        const { container, getByText } = render(
            <CardPreviewNotedMana
                noted={{ mana: { U: 2 }, castableCardId: "noted-spell" }}
            />
        );
        expect(getByText("Noted mana")).toBeTruthy();
        const img = container.querySelector("img");
        expect(img!.getAttribute("src")).toBe("/img/symbols/U.svg");
        // >1 of a colour is annotated with a count.
        expect(within(container).getByText("×2")).toBeTruthy();
    });

    it("does not annotate a single mana with a count", () => {
        const { container } = render(
            <CardPreviewNotedMana noted={{ mana: { R: 1 } }} />
        );
        expect(within(container).queryByText("×1")).toBeNull();
        expect(container.querySelector("img")!.getAttribute("src")).toBe(
            "/img/symbols/R.svg"
        );
    });
});
