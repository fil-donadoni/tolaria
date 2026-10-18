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
});
