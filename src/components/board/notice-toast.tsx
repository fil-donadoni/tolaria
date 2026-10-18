import { useEffect } from "react";
import { Banner } from "~/components/ui/banner";
import { Button } from "~/components/ui/button";
import { ABOVE_CONTROLLER_BAR } from "~/lib/controller-bar-metrics";

/** How long a confirmation stays up before it hides itself. */
export const NOTICE_TOAST_MS = 5000;

/** Non-error toast (issue #5661): a confirmation of something that already
 *  happened (a pile pick). The quiet twin of `ErrorToast` — same anchor, a
 *  `success` tone, `role="status"`, and it hides itself after
 *  {@link NOTICE_TOAST_MS} since there is nothing to copy or act on. `message`
 *  null hides it; a new message restarts the timer. */
export default function NoticeToast({
    message,
    noticeKey,
    hidden = false,
    onDismiss,
}: {
    message: string | null;
    /** Identity of the notice — the timer restarts per key, so two notices
     *  reading the same text still each get their full time. */
    noticeKey: string | null;
    /** Yield the anchor (to the error toast) without pausing the timer, so a
     *  notice never resurfaces long after the fact. */
    hidden?: boolean;
    onDismiss: () => void;
}) {
    useEffect(() => {
        if (!noticeKey) return;
        const timer = setTimeout(onDismiss, NOTICE_TOAST_MS);
        return () => clearTimeout(timer);
        // onDismiss is a fresh closure every render; the timer is per notice.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [noticeKey]);

    if (!message || hidden) return null;

    return (
        // Anchored exactly as `ErrorToast` is (see its note on the mobile cap
        // and the measured controller-bar seam); the board hides this one while an error shows.
        <div
            className={`fixed left-1/2 -translate-x-1/2 z-modal max-sm:w-[calc(100vw-2rem)] max-sm:max-w-sm ${ABOVE_CONTROLLER_BAR} md:bottom-24`}
        >
            <Banner
                tone="success"
                role="status"
                aria-live="polite"
                className="gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2"
            >
                <span className="flex min-w-0 items-center gap-2 sm:gap-3">
                    <p className="min-w-0 flex-1 line-clamp-2 px-1 text-xs sm:px-2 sm:text-sm">
                        {message}
                    </p>
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={onDismiss}
                        aria-label="Dismiss notice"
                        className="min-h-6 min-w-6 px-1 text-sm leading-none"
                    >
                        ×
                    </Button>
                </span>
            </Banner>
        </div>
    );
}
