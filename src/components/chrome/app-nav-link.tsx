// One entry in the app header's primary navigation. A router `Link` (client
// navigation, no reload) that marks itself when the current location is inside
// its route — `activeOptions.exact` is false by default so `/limited` stays lit
// while the user is deep in `/limited/$eventId/build`, which is what a section
// tab should do.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export default function AppNavLink({
    to,
    exact = false,
    badge = false,
    children,
}: {
    to: string;
    /** Light only on an exact match — used by "Home" (`/`), which is a prefix
     *  of every other path and would otherwise always read as active. */
    exact?: boolean;
    /**
     * Mark the destination as holding something in progress (issue #2582, PRD
     * #2405 user story 8). A dot alone is invisible to a screen reader, so the
     * state is also announced as text — the dot is the redundant half.
     */
    badge?: boolean;
    children: ReactNode;
}) {
    return (
        <Link
            to={to}
            activeOptions={{ exact }}
            className="relative rounded-sm px-2 py-1 text-xs tracking-[0.14em] uppercase text-text-muted transition-colors hover:text-parchment"
            activeProps={{
                className: "text-accent-strong",
                "aria-current": "page",
            }}
        >
            {children}
            {badge && (
                <>
                    <span
                        data-slot="nav-badge"
                        aria-hidden="true"
                        className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-accent-strong"
                    />
                    <span className="sr-only"> (in progress)</span>
                </>
            )}
        </Link>
    );
}
