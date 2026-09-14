import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { bugReportTriggerFloats } from "~/lib/bug-report-requests";
import BugReportButton from "../bug-report-button";
import BugReportFloatingButton from "../bug-report-floating-button";
import BugReportHost from "../bug-report-host";

// `BugReportHost` always mounts `BugReportDialog` (open or closed), which
// calls Convex hooks unconditionally — stub them out so this test exercises
// only the trigger/host wiring, not the dialog's data wiring (covered by
// `bug-report-dialog.test.tsx`).
vi.mock("convex/react", () => ({
    useQuery: () => null,
    useMutation: () => vi.fn(),
    useAction: () => vi.fn(),
    // The dialog reads the socket's state for its diagnostic payload (#3256).
    useConvex: () => ({
        connectionState: () => ({
            isWebSocketConnected: true,
            hasEverConnected: true,
            connectionCount: 1,
            connectionRetries: 0,
            hasInflightRequests: false,
        }),
    }),
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        users: { currentUser: { _name: "currentUser" } },
        bugReports: {
            generateUploadUrl: { _name: "generateUploadUrl" },
            submitBugReport: { _name: "submitBugReport" },
        },
    },
}));

let pathname = "/";
vi.mock("@tanstack/react-router", () => ({
    useRouterState: ({
        select,
    }: {
        select: (state: { location: { pathname: string } }) => string;
    }) => select({ location: { pathname } }),
}));

beforeEach(() => {
    pathname = "/";
});

// Issue #3419: on the board the trigger belongs to the controller surface, so
// the router-root floating button stands down there — and ONLY there. The
// Draft Room also owns its chrome but has no controller to host the trigger.
describe("bugReportTriggerFloats — the board is the one route without it", () => {
    it("floats on every non-board route", () => {
        for (const path of [
            "/",
            "/decks/create",
            "/limited/e1/draft",
            "/join/g1",
        ])
            expect(bugReportTriggerFloats(path)).toBe(true);
    });

    it("stands down on the board, trailing slash or not", () => {
        expect(bugReportTriggerFloats("/game")).toBe(false);
        expect(bugReportTriggerFloats("/game/")).toBe(false);
    });
});

describe("BugReportFloatingButton (issues #1764, #3419)", () => {
    it("renders no free-floating trigger on the board", () => {
        pathname = "/game";
        const { container } = render(<BugReportFloatingButton />);
        expect(container.innerHTML).toBe("");
    });

    // #1764: an equal z-index with the phase sheet won DOM-order ties (this
    // mounts at the router root, after the route) and ate the sheet's taps.
    it("sits below sheets/modals off the board", () => {
        const { getByRole } = render(<BugReportFloatingButton />);
        const button = getByRole("button", { name: "Report a bug" });
        expect(button.className).toContain("fixed");
        expect(button.className).toContain("z-dev-overlay");
        expect(button.className).not.toContain("z-sheet");
        expect(button.className).not.toContain("z-modal");
    });

    // The controller bar/strip seams are never set on a route with no
    // controller, so their fallbacks WERE the off-board position. Pin that
    // position literally, and pin that the dead seams are gone with the
    // board placement they served.
    it("keeps its off-board bottom-right inset, with no controller seam left in it", () => {
        const { getByRole } = render(<BugReportFloatingButton />);
        const classes = getByRole("button", { name: "Report a bug" })
            .className.split(/\s+/)
            .filter(Boolean);
        expect(classes).toEqual(
            expect.arrayContaining([
                "bottom-[8.5rem]",
                "right-3",
                "md:bottom-4",
                "md:right-4",
            ])
        );
        expect(classes.join(" ")).not.toContain("--controller-");
        expect(classes.some((c) => c.startsWith("left-"))).toBe(false);
    });
});

// Every host — the floating button, the pod, the strip, the pause menu — asks
// the ONE router-root `BugReportHost`, so all of them open the same dialog.
describe("BugReportHost owns the dialog every trigger opens (issue #3419)", () => {
    it("an inline trigger, rendered anywhere, opens the host's dialog", () => {
        render(
            <>
                <BugReportHost />
                <BugReportButton className="inline" />
            </>
        );
        expect(screen.queryByText("Report a bug")).toBe(null);

        fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));

        expect(screen.getByText("Report a bug")).toBeTruthy();
    });

    it("the floating trigger opens the same dialog", () => {
        render(
            <>
                <BugReportHost />
                <BugReportFloatingButton />
            </>
        );
        fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
        expect(screen.getByText("Report a bug")).toBeTruthy();
    });

    it("a trigger with no host mounted does nothing", () => {
        render(<BugReportButton className="inline" />);
        fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
        expect(screen.queryByText("Report a bug")).toBe(null);
    });
});
