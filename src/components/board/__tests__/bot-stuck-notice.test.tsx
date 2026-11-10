// Rung 5 of the bot's liveness ladder (issue #9003): the transient notice that
// the server skipped a Bot decision and filed the fault. No control — the
// player never clicks anything — and it goes away by itself.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import BotStuckNotice, { BOT_SKIP_NOTICE_MS } from "../bot-stuck-notice";

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("BotStuckNotice (issue #9003)", () => {
    it("renders nothing before the first skip", () => {
        const { container } = render(<BotStuckNotice skipped={null} />);
        expect(container.firstChild).toBeNull();
    });

    it("says the decision was skipped and reported, through the shared Banner, with no control", () => {
        const { container } = render(<BotStuckNotice skipped={{ id: 1 }} />);
        expect(screen.getByRole("status").textContent).toContain(
            "The Bot hit an error and skipped a decision — reported automatically"
        );
        expect(container.querySelector('[data-slot="banner"]')).not.toBeNull();
        expect(screen.queryByRole("button")).toBeNull();
    });

    it("goes away by itself, and comes back for the next skip", () => {
        const { rerender } = render(<BotStuckNotice skipped={{ id: 1 }} />);
        act(() => {
            vi.advanceTimersByTime(BOT_SKIP_NOTICE_MS + 1);
        });
        expect(screen.queryByRole("status")).toBeNull();

        // The same skip re-rendered stays gone.
        rerender(<BotStuckNotice skipped={{ id: 1 }} />);
        expect(screen.queryByRole("status")).toBeNull();

        rerender(<BotStuckNotice skipped={{ id: 2 }} />);
        expect(screen.getByRole("status")).toBeTruthy();
    });
});
