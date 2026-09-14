// Issue #3419 — the portrait bar's bug-report entry lives in the pause menu,
// and the menu closes as the report opens. Two independent dialogs swap inside
// one click, so this renders BOTH real dialogs together: the report must stay
// open once the menu that asked for it is gone.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import PauseMenuDialog from "~/components/board/pause-menu-dialog";
import BugReportHost from "../bug-report-host";

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
        game: {
            concede: { _name: "concede" },
            forfeitMatch: { _name: "forfeitMatch" },
            manualConcedeMatch: { _name: "manualConcedeMatch" },
        },
        users: { currentUser: { _name: "currentUser" } },
        bugReports: {
            generateUploadUrl: { _name: "generateUploadUrl" },
            submitBugReport: { _name: "submitBugReport" },
        },
    },
}));
vi.mock("~/lib/session", async (importOriginal) => ({
    ...(await importOriginal<typeof import("~/lib/session")>()),
    clearSession: () => {},
}));

function MenuUnderTest() {
    const [open, setOpen] = useState(true);
    return (
        <PauseMenuDialog
            open={open}
            onOpenChange={setOpen}
            gameId={"g1" as Id<"games">}
            playerId="me"
            match={null}
        />
    );
}

describe("Pause menu → bug report (issue #3419)", () => {
    it("closes the game menu and leaves the bug-report dialog open", async () => {
        render(
            <>
                <BugReportHost />
                <MenuUnderTest />
            </>
        );
        expect(screen.getAllByText("Game Menu").length).toBeGreaterThan(0);
        expect(screen.queryByRole("button", { name: "Cancel" })).toBe(null);

        fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));

        // The report's own consent-bearing form is up (its Cancel button is
        // the dialog's, the menu has none) and the menu's title is gone.
        expect(
            await screen.findByRole("button", { name: "Cancel" })
        ).toBeTruthy();
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.queryAllByText("Game Menu")).toEqual([]);
        expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    });
});
