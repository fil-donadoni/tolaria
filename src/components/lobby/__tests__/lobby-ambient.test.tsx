// The active deck's art as the lobby's ambient (ADR 0103 §6, issue #2726) —
// the second half of acceptance criterion #3. The integration proof (selecting
// a shelf tile really swaps it) lives in `lobby.test.tsx`; this covers the
// layer's own two contracts: it paints the deck it was given, and it is
// invisible to anything that counts CARDS.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import LobbyAmbient from "../lobby-ambient";

describe("LobbyAmbient (issue #2726)", () => {
    it("renders nothing for a deck with no Featured Card", () => {
        const { container } = render(<LobbyAmbient featuredCardId={null} />);
        expect(container.innerHTML).toBe("");
    });

    it("paints the given card's art, and repaints when it changes", () => {
        const { container, rerender } = render(
            <LobbyAmbient featuredCardId="print-a" />
        );
        const src = () =>
            container
                .querySelector<HTMLImageElement>("[data-lobby-ambient] img")!
                .getAttribute("src")!;
        expect(src()).toContain("print-a");
        rerender(<LobbyAmbient featuredCardId="print-b" />);
        expect(src()).toContain("print-b");
    });

    it("is decoration on every count the probe checks", () => {
        // `scripts/ui-gate/probe.js` excludes an image inside anything
        // `aria-hidden` or `[data-ambient-art]`. A full-bleed backdrop that
        // failed either check would score as an occluded CARD behind the
        // panels — the exact artifact `budgets.json` holds a `cardsOcc`
        // ceiling for.
        const { container } = render(<LobbyAmbient featuredCardId="print-a" />);
        const root = container.querySelector("[data-lobby-ambient]")!;
        expect(root.getAttribute("aria-hidden")).toBe("true");
        const img = root.querySelector("img")!;
        expect(img.getAttribute("aria-hidden")).toBe("true");
        expect(img.hasAttribute("data-ambient-art")).toBe(true);
        // ...and inert, so it never eats a click meant for the menu on top.
        expect(root.className).toContain("pointer-events-none");
    });
});
