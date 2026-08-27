// The Browse-mode top bar (issue #2582, ADR 0101 §"AppShell").
//
// Was the app-wide ORNATE header (PRD #589 → issue #600): filigree frame,
// wordmark, ornamental divider, two stacked rows. Browser-measured at 112px in
// issue #2056 — 40% of a 277px viewport, and 12% of a phone's. v3 replaces it
// with a single 56px row (`h-14`, `SHELL_BROWSE_BAND_PX`) that drops to 40px on
// a landscape phone (`short-viewport:h-10`, `SHELL_BROWSE_COMPACT_BAND_PX`).
//
// Three things went, and each was a height term rather than a taste call:
//   - the ornamental divider (~16-20px of pure ornament under the row);
//   - the two-row `flex-col md:flex-row` stack (a phone got both rows);
//   - `CornerFiligreeFrame`'s 32px corners, replaced by the v3 10px
//     `CornerBracketFrame` (issue #2581) — itself retired by ADR 0103 §5
//     (issue #2734): the frame is now the `panel-physical` box's own
//     hairline edge (`border border-border-subtle` below), no ink at the
//     corners at all.
//
// The bar does NOT render on a portrait phone at all: there the destinations
// live in `AppBottomNav`, under the thumb. `AppShell` decides that; this
// component is only what the bar looks like.
import { Link } from "@tanstack/react-router";
import AppNavLink from "./app-nav-link";
import AppHeaderAdminMenu from "./app-header-admin-menu";
import AppHeaderProfile from "./app-header-profile";

export default function AppHeader({
    /** A game is in progress — badge the destination that leads back to it. */
    gameBadge = false,
    /** A Limited event is in progress — badge the Limited destination. */
    limitedBadge = false,
}: {
    gameBadge?: boolean;
    limitedBadge?: boolean;
}) {
    return (
        <header className="panel-physical relative flex h-14 items-center gap-4 rounded-md border border-border-subtle px-4 short-viewport:h-10 short-viewport:gap-2 short-viewport:px-2">
            <Link
                to="/"
                className="flex shrink-0 items-center gap-2 text-display text-lg tracking-[0.22em] text-accent-strong short-viewport:text-sm"
            >
                {/* Light-on-dark variant of the brand mark. Decorative — the
                    wordmark next to it carries the accessible name. */}
                <img
                    src="/img/logo.svg"
                    alt=""
                    aria-hidden="true"
                    className="h-6 w-auto shrink-0 short-viewport:h-4"
                />
                <span className="hidden sm:inline">TOLARIA</span>
            </Link>
            <nav
                aria-label="Main"
                className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2"
            >
                <AppNavLink to="/" exact badge={gameBadge}>
                    Home
                </AppNavLink>
                <AppNavLink to="/limited" badge={limitedBadge}>
                    Limited
                </AppNavLink>
                <AppHeaderAdminMenu />
            </nav>
            <AppHeaderProfile />
        </header>
    );
}
