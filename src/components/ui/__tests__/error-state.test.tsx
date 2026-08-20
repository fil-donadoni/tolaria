// ErrorState (issue #2592, PRD #2405 D51) — the ONE "this is why there's
// nothing else on this surface" component, built on `Banner tone="danger"`.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import ErrorState from "../error-state";

afterEach(cleanup);

describe("ErrorState (issue #2592)", () => {
    it("renders the message with an alert role", () => {
        render(<ErrorState message="This event no longer exists." />);
        const alert = screen.getByRole("alert");
        expect(alert.textContent).toContain("This event no longer exists.");
    });

    it("renders an optional action (e.g. Retry/Back)", () => {
        render(
            <ErrorState
                message="Gone."
                action={<button type="button">Back</button>}
            />
        );
        expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    });

    it("uses the danger tone (shared Banner styling)", () => {
        const { container } = render(<ErrorState message="Gone." />);
        const banner = container.querySelector('[data-slot="banner"]')!;
        expect(banner.getAttribute("data-tone")).toBe("danger");
    });
});
