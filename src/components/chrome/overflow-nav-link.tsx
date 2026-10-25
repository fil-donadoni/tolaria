import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * One navigation row inside an overflow popover (issue #3681): the
 * `AppContextBar` and Draft Room bar overflows and the Admin menu.
 *
 * `min-h-[var(--menu-row-h)]` (44px, ADR 0103 §5) is a FLOOR at every pointer
 * and viewport — a floating popover costs no band height, so there is no
 * `short-viewport:` rung. The parent `<nav>` spaces rows by
 * `--menu-row-gap`. Still a plain router `<Link>`, not a menu item: role,
 * focus and keyboard behaviour stay those of a link.
 */
export default function OverflowNavLink({
    to,
    params,
    onClick,
    className,
    activeClassName,
    children,
}: {
    to: string;
    params?: Record<string, string>;
    onClick?: () => void;
    className?: string;
    /** Extra classes while the link's route is active. */
    activeClassName?: string;
    children: ReactNode;
}) {
    return (
        <Link
            // Callers pass a concrete path; `params` fill its `$segments`.
            to={to}
            params={params}
            onClick={onClick}
            activeProps={
                activeClassName ? { className: activeClassName } : undefined
            }
            className={cn(
                "flex min-h-[var(--menu-row-h)] items-center rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-parchment",
                className
            )}
        >
            {children}
        </Link>
    );
}
