// EmptyState (issue #2592, PRD #2405 D51) — the ONE "nothing to show here
// yet" component, replacing a dozen copy-pasted `<p>` recipes across
// lobby/limited/deckbuilder surfaces.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import EmptyState from "../empty-state";

afterEach(cleanup);

describe("EmptyState (issue #2592)", () => {
    it("renders the message", () => {
        render(<EmptyState message="Nothing here yet." />);
        expect(screen.getByText("Nothing here yet.")).toBeTruthy();
    });

    it("renders no description/action when neither is passed", () => {
        const { container } = render(<EmptyState message="Empty." />);
        // Just the bare <p> — no second line, no action wrapper.
        expect(container.querySelectorAll("p")).toHaveLength(1);
    });

    it("renders an optional description as a second line", () => {
        render(
            <EmptyState
                message="Empty."
                description="Try a different filter."
            />
        );
        expect(screen.getByText("Try a different filter.")).toBeTruthy();
    });

    it("renders an optional single action", () => {
        render(
            <EmptyState
                message="Empty."
                action={<button type="button">Create one</button>}
            />
        );
        expect(screen.getByRole("button", { name: "Create one" })).toBeTruthy();
    });
});
