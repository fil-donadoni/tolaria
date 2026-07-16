// Share invite link button tests (issue #1245, PRD #1241 stories 15-16):
// mirrors the single-match share pattern (`waiting-for-opponent.test.tsx`-
// style discipline — there isn't one yet, but the pattern is
// `WaitingForOpponent` itself) — copies `${origin}/limited/${eventId}` via
// the project's shared `copyText` helper and toggles the label to "Link
// copied!".
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import LimitedShareInviteButton from "../limited-share-invite-button";

const copyText = vi.fn().mockResolvedValue(undefined);

vi.mock("~/lib/clipboard", () => ({
    copyText: (...args: unknown[]) => copyText(...args),
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("LimitedShareInviteButton (issue #1245)", () => {
    it("copies the event URL (origin + /limited/<eventId>) via the shared copyText helper", () => {
        render(
            <LimitedShareInviteButton
                eventId={"event-42" as never}
            />
        );

        fireEvent.click(screen.getByText("Share invite link"));

        expect(copyText).toHaveBeenCalledWith(
            `${window.location.origin}/limited/event-42`
        );
    });

    it("toggles the label to 'Link copied!' after sharing", () => {
        render(
            <LimitedShareInviteButton
                eventId={"event-42" as never}
            />
        );

        fireEvent.click(screen.getByText("Share invite link"));

        expect(screen.getByText("Link copied!")).toBeTruthy();
        expect(screen.queryByText("Share invite link")).toBe(null);
    });
});
