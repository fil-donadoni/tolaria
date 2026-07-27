// The shared 404 page: its card pick and its deliberate silence about WHY a
// page is missing (the `/draft-lab` admin gate renders this exact component
// for a non-admin, so any "you need to be an admin" wording here would leak
// the surface's existence — see `src/routes/draft-lab.route.tsx`).
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFoundPage from "../not-found-page";
import { LOST_IN_CARDS, pickLostInCard } from "@/lib/lostInCards";

describe("pickLostInCard", () => {
    it("maps the random draw across the whole pool", () => {
        expect(pickLostInCard(() => 0)).toBe(LOST_IN_CARDS[0]);
        expect(pickLostInCard(() => 0.999)).toBe(
            LOST_IN_CARDS[LOST_IN_CARDS.length - 1]
        );
    });

    it("clamps a degenerate random() === 1 instead of returning undefined", () => {
        expect(pickLostInCard(() => 1)).toBe(
            LOST_IN_CARDS[LOST_IN_CARDS.length - 1]
        );
    });

    it("every pooled card is a real Scryfall print id and an actual 'Lost in' name", () => {
        expect(LOST_IN_CARDS.length).toBeGreaterThan(0);
        for (const card of LOST_IN_CARDS) {
            expect(card.name).toMatch(/\blost in\b/i);
            expect(card.id).toMatch(/^[0-9a-f-]{36}$/);
        }
    });
});

describe("NotFoundPage", () => {
    it("renders a card from the Lost In pool", () => {
        render(<NotFoundPage />);
        const img = screen.getByRole("img");
        const alt = img.getAttribute("alt");
        expect(LOST_IN_CARDS.some((c) => c.name === alt)).toBe(true);
        expect(img.getAttribute("src")).toContain(
            LOST_IN_CARDS.find((c) => c.name === alt)!.id
        );
    });

    it("says the page is missing without saying why", () => {
        render(<NotFoundPage />);
        expect(screen.getByText("Page not found")).toBeTruthy();
        expect(document.body.textContent).not.toMatch(
            /admin|permission|forbidden/i
        );
    });
});
