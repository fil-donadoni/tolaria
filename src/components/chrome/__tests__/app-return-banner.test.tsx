// The global "return to game/event" chrome band (issue #2582, ADR 0101). No
// dom test rendered the REAL component before issue #2730's v4 re-skin
// (bespoke `border-accent/40 bg-accent/15` wash → the hairline + status-dot
// recipe every other banner shares). Covers both affordances and the Return
// action, pinning the hairline recipe so a revert to the accent wash is
// caught here.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import type { ActiveSession } from "~/hooks/useActiveSession";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user1", nickname: "Me", email: "" }),
}));

vi.mock("~/lib/session", () => ({
    storeSession: vi.fn(),
}));

import AppReturnBanner from "../app-return-banner";

afterEach(cleanup);

function gameSession(
    over: Partial<NonNullable<ActiveSession["game"]>> = {}
): ActiveSession {
    return {
        game: {
            gameId: "g1" as Id<"games">,
            name: "Game 1",
            status: "playing",
            solo: false,
            ...over,
        },
        event: null,
        loading: false,
    };
}

describe("AppReturnBanner (issue #2582)", () => {
    it("uses the hairline + status-dot recipe, not the retired accent wash", () => {
        const { container } = render(
            <AppReturnBanner session={gameSession()} />
        );
        const banner = container.querySelector(
            '[data-slot="app-return-banner"]'
        ) as HTMLElement;
        expect(banner).not.toBeNull();
        expect(banner.className).not.toContain("bg-accent/15");
        expect(banner.className).not.toContain("border-accent/40");
        expect(banner.className).toContain("bg-surface");
        const dot = banner.querySelector("[aria-hidden]");
        expect(dot).not.toBeNull();
    });

    it("names the in-progress game and resumes it on click", () => {
        render(<AppReturnBanner session={gameSession()} />);
        expect(screen.getByText("A game is in progress.")).toBeTruthy();
        fireEvent.click(screen.getByText("Return to game"));
        expect(navigate).toHaveBeenCalledWith({ to: "/game" });
    });

    it("renders nothing when nothing is in flight", () => {
        const { container } = render(
            <AppReturnBanner
                session={{ game: null, event: null, loading: false }}
            />
        );
        expect(container.firstChild).toBeNull();
    });
});
