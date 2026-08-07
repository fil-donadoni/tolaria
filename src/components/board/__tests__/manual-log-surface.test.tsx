// The Manual Game log's collapsed surface (issue #2172).
//
// `ManualLog` itself (subscription + pagination) is untouched and out of
// scope here — these tests cover what this PR actually changed: the surface
// mounts NOTHING while closed (so it can never subtract board width or
// disturb the band budgets, AC2/AC3), opens on command, and offers every
// dismissal path (Close button, backdrop tap, Escape) a controller-opened
// overlay is expected to.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

const loadMore = vi.fn();
vi.mock("convex/react", () => ({
    usePaginatedQuery: () => ({
        results: [{ action: { text: "Player drew a card" } }],
        status: "Exhausted",
        loadMore,
    }),
}));
vi.mock("@convex/_generated/api", () => ({
    api: { manualLog: { getManualLog: {} } },
}));

const { default: ManualLogSurface } = await import("../manual-log-surface");

beforeEach(cleanup);

describe("ManualLogSurface (#2172)", () => {
    it("renders nothing while closed — no width-subtracting DOM at all", () => {
        const { container } = render(
            <ManualLogSurface
                gameId={"game-id" as never}
                open={false}
                onClose={vi.fn()}
            />
        );
        expect(container.innerHTML).toBe("");
    });

    it("mounts the log panel, unchanged, once opened", () => {
        render(
            <ManualLogSurface
                gameId={"game-id" as never}
                open={true}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByText("Action Log")).toBeTruthy();
        expect(screen.getByText("Player drew a card")).toBeTruthy();
    });

    it("is an absolute overlay, not a layout participant", () => {
        render(
            <ManualLogSurface
                gameId={"game-id" as never}
                open={true}
                onClose={vi.fn()}
            />
        );
        const surface = document.querySelector("[data-manual-log-surface]");
        expect(surface).not.toBeNull();
        expect(surface?.className).toContain("absolute");
        expect(surface?.className).toContain("inset-0");
    });

    it("closes on the Close button", () => {
        const onClose = vi.fn();
        render(
            <ManualLogSurface
                gameId={"game-id" as never}
                open={true}
                onClose={onClose}
            />
        );
        fireEvent.click(screen.getByText("Close"));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes on a backdrop tap", () => {
        const onClose = vi.fn();
        render(
            <ManualLogSurface
                gameId={"game-id" as never}
                open={true}
                onClose={onClose}
            />
        );
        fireEvent.click(screen.getByLabelText("Close log"));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes on Escape while open", () => {
        const onClose = vi.fn();
        render(
            <ManualLogSurface
                gameId={"game-id" as never}
                open={true}
                onClose={onClose}
            />
        );
        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does NOT listen for Escape while closed", () => {
        const onClose = vi.fn();
        render(
            <ManualLogSurface
                gameId={"game-id" as never}
                open={false}
                onClose={onClose}
            />
        );
        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).not.toHaveBeenCalled();
    });
});
