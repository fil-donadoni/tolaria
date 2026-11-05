import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PlayerSpeed from "../player-speed";

describe("PlayerSpeed (CR 702.179)", () => {
    it("shows nothing for a player with no speed", () => {
        const { container } = render(<PlayerSpeed speed={undefined} />);
        expect(container.firstChild).toBeNull();
    });

    it("shows the number below max speed", () => {
        render(<PlayerSpeed speed={3} />);
        expect(screen.getByTestId("player-speed").textContent).toBe("Speed 3");
    });

    it("names max speed at 4", () => {
        render(<PlayerSpeed speed={4} />);
        expect(screen.getByTestId("player-speed").textContent).toBe(
            "Max speed"
        );
    });
});
