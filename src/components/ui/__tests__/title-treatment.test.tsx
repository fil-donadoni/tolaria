import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TitleTreatment from "../title-treatment";

describe("TitleTreatment (issue #597)", () => {
    it("renders the glowy Beleren headline", () => {
        const { container } = render(<TitleTreatment title="Victory" />);
        const heading = container.querySelector("h1")!;
        expect(heading.textContent).toBe("Victory");
        expect(heading.className).toContain("title-treatment-glow");
        expect(heading.className).toContain("font-beleren");
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
