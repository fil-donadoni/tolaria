import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
    /** What's empty — the one line every call site already had. */
    message: ReactNode;
    /** Optional second line — a hint on how to fill the empty space. */
    description?: ReactNode;
    /** Optional single action offered from the empty state (e.g. a Button). */
    action?: ReactNode;
    className?: string;
};

/**
 * The ONE empty state (issue #2592, PRD #2405 D51): "nothing to show here
 * yet" content, used inside whatever layout the caller already has (a Panel
 * body, a dialog, a grid pane, a zone header). Deliberately NOT its own
 * shell-filling page frame — the codebase already has one shell recipe for a
 * whole route root (`LoadingScreen`, `JoinAntechamberShell`,
 * `LimitedEventPageFrame`) and this composes inside those exactly like
 * `Banner` does, rather than forking a second one. A route root with no
 * frame of its own wraps this the same way it would wrap a spinner.
 *
 * Renders a bare `<p>` when only `message` is set — the same DOM shape the
 * 10+ call sites this replaces already had — so a caller overriding
 * `className` (e.g. `deck-list.tsx`'s dashed-border recipe) still lands the
 * text-size/color classes on the actual text via inheritance.
 */
export default function EmptyState({
    message,
    description,
    action,
    className,
}: EmptyStateProps) {
    return (
        <div
            data-slot="empty-state"
            className={cn("text-sm text-text-muted", className)}
        >
            <p>{message}</p>
            {description && (
                <p className="mt-1 text-xs text-text-disabled">{description}</p>
            )}
            {action && <div className="mt-3">{action}</div>}
        </div>
    );
}
