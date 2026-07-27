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
    children,
}: {
    to: string;
    /** Light only on an exact match — used by "Home" (`/`), which is a prefix
     *  of every other path and would otherwise always read as active. */
    exact?: boolean;
    children: ReactNode;
}) {
    return (
        <Link
            to={to}
            activeOptions={{ exact }}
            className="rounded-sm px-2 py-1 text-xs tracking-[0.14em] uppercase text-text-muted transition-colors hover:text-parchment"
            activeProps={{
                className: "text-accent-strong",
                "aria-current": "page",
            }}
        >
            {children}
        </Link>
    );
}
