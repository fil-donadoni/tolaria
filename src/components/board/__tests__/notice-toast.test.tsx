// Issue #5661 — the non-error toast beside `ErrorToast`: a status (not an
// alert) that hides itself after `NOTICE_TOAST_MS`.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
    render,
    screen,
    fireEvent,
    cleanup,
    act,
} from "@testing-library/react";
import NoticeToast, { NOTICE_TOAST_MS } from "../notice-toast";

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("NoticeToast (issue #5661)", () => {
    it("renders nothing without a message", () => {
        const { container } = render(
            <NoticeToast message={null} noticeKey={null} onDismiss={() => {}} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("shows the message as a polite status in a success Banner", () => {
        const { container } = render(
            <NoticeToast
                message="Bob took Pile B: Shock"
                noticeKey="k1"
                onDismiss={() => {}}
            />
        );
        const status = screen.getByRole("status");
        expect(status.textContent).toContain("Bob took Pile B: Shock");
        expect(
            container
                .querySelector('[data-slot="banner"]')
                ?.getAttribute("data-tone")
        ).toBe("success");
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("dismisses on click and by itself after NOTICE_TOAST_MS", () => {
        vi.useFakeTimers();
        const onDismiss = vi.fn();
        render(
            <NoticeToast message="m" noticeKey="k1" onDismiss={onDismiss} />
        );
        fireEvent.click(screen.getByLabelText("Dismiss notice"));
        expect(onDismiss).toHaveBeenCalledTimes(1);
        act(() => vi.advanceTimersByTime(NOTICE_TOAST_MS));
        expect(onDismiss).toHaveBeenCalledTimes(2);
    });

    it("restarts its timer for a new notice with the same text", () => {
        vi.useFakeTimers();
        const onDismiss = vi.fn();
        const { rerender } = render(
            <NoticeToast message="m" noticeKey="k1" onDismiss={onDismiss} />
        );
        act(() => vi.advanceTimersByTime(NOTICE_TOAST_MS - 100));
        rerender(
            <NoticeToast message="m" noticeKey="k2" onDismiss={onDismiss} />
        );
        act(() => vi.advanceTimersByTime(200));
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it("hides while yielding to an error but keeps counting down", () => {
        vi.useFakeTimers();
        const onDismiss = vi.fn();
        const { container } = render(
            <NoticeToast
                message="m"
                noticeKey="k1"
                hidden
                onDismiss={onDismiss}
            />
        );
        expect(container.firstChild).toBeNull();
        act(() => vi.advanceTimersByTime(NOTICE_TOAST_MS));
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    // Issue #8956 — Space / Escape dismiss, captured so the key never also
    // passes priority; a pending choice owns the keyboard.
    it("Space dismisses and the keystroke never reaches a bubble listener", () => {
        const onDismiss = vi.fn();
        const bubble = vi.fn();
        window.addEventListener("keydown", bubble);
        render(
            <NoticeToast message="m" noticeKey="k1" onDismiss={onDismiss} />
        );
        fireEvent.keyDown(document.body, { code: "Space", key: " " });
        window.removeEventListener("keydown", bubble);
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(bubble).not.toHaveBeenCalled();
    });

    it("Escape dismisses too", () => {
        const onDismiss = vi.fn();
        render(
            <NoticeToast message="m" noticeKey="k1" onDismiss={onDismiss} />
        );
        fireEvent.keyDown(document.body, { key: "Escape" });
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("leaves Space to the pending choice while the viewer is prompted", () => {
        const onDismiss = vi.fn();
        const bubble = vi.fn();
        window.addEventListener("keydown", bubble);
        render(
            <NoticeToast
                message="m"
                noticeKey="k1"
                keysSuppressed
                onDismiss={onDismiss}
            />
        );
        fireEvent.keyDown(document.body, { code: "Space", key: " " });
        window.removeEventListener("keydown", bubble);
        expect(onDismiss).not.toHaveBeenCalled();
        expect(bubble).toHaveBeenCalledTimes(1);
    });

    it("ignores Space while hidden behind an error", () => {
        const onDismiss = vi.fn();
        render(
            <NoticeToast
                message="m"
                noticeKey="k1"
                hidden
                onDismiss={onDismiss}
            />
        );
        fireEvent.keyDown(document.body, { code: "Space", key: " " });
        expect(onDismiss).not.toHaveBeenCalled();
    });
});
