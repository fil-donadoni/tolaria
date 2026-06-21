import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PlayerPoisonCounters from "../player-poison-counters";

// Poison counters badge (CR 122 / 704.5c) — renders only when count > 0,
// shows the count, and uses the semantic danger token (ADR 0007).
describe("PlayerPoisonCounters (CR 122)", () => {
    it("renders nothing when count is zero", () => {
        const { container } = render(<PlayerPoisonCounters count={0} />);
        expect(container.firstChild).toBeNull();
    });

    it("renders nothing when count is undefined (absent = zero)", () => {
        const { container } = render(
            <PlayerPoisonCounters count={undefined} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("renders the count and the poison glyph when count > 0", () => {
        const { container, getByText } = render(
            <PlayerPoisonCounters count={3} />
        );
        expect(getByText("3")).toBeTruthy();
        // The official poison glyph ships as an inline SVG.
        expect(container.querySelector("svg")).toBeTruthy();
    });

    it("renders a near-lethal count (CR 704.5c threshold)", () => {
        const { getByText, getByLabelText } = render(
            <PlayerPoisonCounters count={9} />
        );
        expect(getByText("9")).toBeTruthy();
        expect(getByLabelText("9 poison counters")).toBeTruthy();
    });

    it("uses the semantic danger token, not a chromatic class", () => {
        const { container } = render(<PlayerPoisonCounters count={5} />);
        const badge = container.firstChild as HTMLElement;
        expect(badge.className).toContain("text-danger-strong");
    });
});
