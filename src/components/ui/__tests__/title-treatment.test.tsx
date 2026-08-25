import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TitleTreatment from "../title-treatment";

describe("TitleTreatment (issue #597)", () => {
    // ADR 0103 §4 / issue #2723: TitleTreatment IS "the display-face large
    // title". Beleren is confined to the card domain, and the utility that
    // used to name it here resolves to nothing since #2722 — the headline was
    // already falling back to Geist, silently, with none of the display
    // treatment (weight 500 / -0.025em / lining tabular numerals) applied.
    it("renders the glowing headline on the chrome display face", () => {
        const { container } = render(<TitleTreatment title="Victory" />);
        const heading = container.querySelector("h1")!;
        expect(heading.textContent).toBe("Victory");
        const tokens = heading.className.split(/\s+/);
        expect(tokens).toContain("title-treatment-glow");
        expect(tokens).toContain("text-display");
        expect(tokens).not.toContain("font-beleren");
    });

    it("puts the subtitle on the display face too", () => {
        const { container } = render(
            <TitleTreatment title="Game Over" subtitle="Filippo wins!" />
        );
        const subtitle = container.querySelector(
            'span[class*="text-display"]:not(h1)'
        );
        expect(subtitle?.textContent).toBe("Filippo wins!");
    });

    it("renders the runic ring element for the later motion pass (#598)", () => {
        const { container } = render(<TitleTreatment title="Game Over" />);
        expect(container.querySelectorAll(".runic-ring")).toHaveLength(1);
    });

    it("renders the subtitle flanked by clasp flourishes when provided", () => {
        const { container } = render(
            <TitleTreatment title="Game Over" subtitle="Filippo wins!" />
        );
        expect(screen.getByText("Filippo wins!")).toBeTruthy();
        expect(
            container.querySelectorAll('[data-slot="subtitle-flourish"]')
        ).toHaveLength(2);
    });

    it("omits the subtitle row when no subtitle is given", () => {
        const { container } = render(<TitleTreatment title="Game Over" />);
        expect(
            container.querySelectorAll('[data-slot="subtitle-flourish"]')
        ).toHaveLength(0);
    });
});
