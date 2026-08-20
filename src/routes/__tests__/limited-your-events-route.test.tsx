// `/limited/events` redirect stub (issue #2590): the your-events page was
// absorbed into the merged `/limited` list behind the `mine` filter, so this
// route's entire job is redirecting to `/limited?mine=1`. Proves the redirect
// actually fires — a test asserting the OLD page's content would pass
// against a stale two-page setup and prove nothing about the new behavior.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import LimitedYourEventsRoute from "../limited-your-events.route";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("LimitedYourEventsRoute (issue #2590)", () => {
    it("redirects unconditionally to /limited?mine=1", () => {
        render(<LimitedYourEventsRoute />);

        expect(navigate).toHaveBeenCalledWith({
            to: "/limited",
            search: { mine: true },
            replace: true,
        });
    });
});
