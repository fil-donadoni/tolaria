import type { ReactNode } from "react";
import { Banner } from "@/components/ui/banner";

type ErrorStateProps = {
    /** What went wrong — the one line every call site already had. */
    message: ReactNode;
    /** Optional single action offered from the error state — typically a
     *  "Retry" button, or (when there's nothing to retry, e.g. the thing the
     *  page was about is gone) a "Back" link. */
    action?: ReactNode;
    className?: string;
};

/**
 * The ONE error state (issue #2592, PRD #2405 D51): "this is why there's
 * nothing else on this surface" content, built on `Banner tone="danger"` —
 * the same base `ErrorToast` (the mutation-error toast) already extends,
 * per the repo's "extend the ONE inline notice, never fork" rule
 * (`banner.tsx`'s own doc comment).
 *
 * Reserved for a surface whose subject is gone or unreachable (an event
 * deleted out from under a viewer, a pool that failed to resolve) — NOT for
 * a transient, dismissible mutation-failure banner shown alongside otherwise
 * live content (`limited-draft-table.tsx` / `limited-event-detail.tsx` keep
 * their own inline `<Banner tone="danger">{error}</Banner>` for that; it is
 * already the shared component, just not wrapped a second time here).
 */
export default function ErrorState({
    message,
    action,
    className,
}: ErrorStateProps) {
    return (
        <Banner tone="danger" role="alert" className={className}>
            <span className="flex flex-col items-start gap-2">
                {message}
                {action}
            </span>
        </Banner>
    );
}
