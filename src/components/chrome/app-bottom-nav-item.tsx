// One destination in the phone-portrait bottom nav (issue #2582, ADR 0101).
//
// Separate from `AppNavLink` rather than a variant of it: a bottom-nav item is
// an icon over a label filling an equal share of the bar, with a 44px minimum
// touch target (`--control-h-coarse`, WCAG 2.5.8) — none of which the top
// bar's inline text link wants. One component per file, per the repo rule.
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

export default function AppBottomNavItem({
    to,
    exact = false,
    icon: Icon,
    label,
    badge = false,
}: {
    to: string;
    /** Light only on an exact match — `/` is a prefix of every other path. */
    exact?: boolean;
    icon: LucideIcon;
    label: string;
    /** Something is in progress behind this destination (issue #2582). */
    badge?: boolean;
}) {
    return (
        <Link
            to={to}
            activeOptions={{ exact }}
            className="relative flex min-h-[var(--control-h-coarse)] flex-1 flex-col items-center justify-center gap-0.5 rounded-sm text-text-muted transition-colors hover:text-parchment"
            activeProps={{
                className: "text-accent-strong",
                "aria-current": "page",
            }}
        >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span className="text-[0.625rem] tracking-[0.14em] uppercase">
                {label}
            </span>
            {badge && (
                <>
                    <span
                        data-slot="nav-badge"
                        aria-hidden="true"
                        className="absolute top-1.5 right-1/4 h-1.5 w-1.5 rounded-full bg-accent-strong"
                    />
                    <span className="sr-only"> (in progress)</span>
                </>
            )}
        </Link>
    );
}
