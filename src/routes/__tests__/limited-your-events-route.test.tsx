// `/limited/events` redirect stub (issue #2590): the your-events page was
// absorbed into the merged `/limited` list behind the `mine` filter, so this
// route's entire job is redirecting to `/limited?mine=1`. Proves the redirect
// actually fires — a test asserting the OLD page's content would pass
// against a stale two-page setup and prove nothing about the new behavior.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import LimitedYourEventsRoute from "../limited-your-events.route";

const navigate = vi.fn();
const search = vi.fn<() => Record<string, unknown>>();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
    useSearch: () => search(),
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("LimitedYourEventsRoute (issue #2590)", () => {
    it("redirects unconditionally to /limited?mine=1", () => {
        search.mockReturnValue({});

        render(<LimitedYourEventsRoute />);

        expect(navigate).toHaveBeenCalledWith({
            to: "/limited",
            search: { mine: true },
            replace: true,
        });
    });

    // Issue #2822: `bun run check:ui`'s `limited-your-events` surface enters
    // at `/limited/events?label=ui-gate/`, and the whole point of that param
    // is that the list it lands on is bounded to the seeded fixture. A
    // redirect that dropped it would put the deployment's own events back
    // into the measurement — silently, with the surface still reporting PASS.
    it("carries a fixture ?label= through the redirect", () => {
        search.mockReturnValue({ label: "ui-gate/" });

        render(<LimitedYourEventsRoute />);

        expect(navigate).toHaveBeenCalledWith({
            to: "/limited",
            search: { mine: true, label: "ui-gate/" },
            replace: true,
        });
    });
});
