// The app-wide header (was `DashboardTopBar`, the LOBBY's app-bar — PRD #589,
// issue #600). Promoting it to shared chrome is the fix for sections that had
// drifted off it entirely: everything under `/limited` rendered with no
// wordmark, no way home, no nickname and no sign-out, because the bar was
// mounted by `lobby.tsx` rather than by the shell.
//
// Same ornate language as before — filigree frame, wordmark, ornamental
// divider — plus the primary section nav and (for an admin) the Admin menu.
// Mounted by `AppShell`, which decides WHERE it appears; this component is
// only what it looks like.
import { Link } from "@tanstack/react-router";
import CornerFiligreeFrame from "~/components/ui/corner-filigree-frame";
import OrnamentalDivider from "~/components/ui/ornamental-divider";
import AppNavLink from "./app-nav-link";
import AppHeaderAdminMenu from "./app-header-admin-menu";
import AppHeaderProfile from "./app-header-profile";

export default function AppHeader() {
    return (
        <header className="panel-physical relative rounded-md border border-border-subtle">
            {/* short-viewport:hidden (issue #2056 defect 3 amplification):
                pure decoration (`overlay` mode is `absolute inset-0`, so it
                never contributed to the band's height) — dropped anyway on a
                scarce viewport, alongside the divider below, rather than
                leaving ornament that competes with the content for visual
                attention in a squeezed row. */}
            <CornerFiligreeFrame
                overlay
                size={32}
                subtle
                className="short-viewport:hidden"
            />
            <div className="flex flex-col items-center justify-between gap-4 px-5 py-3 short-viewport:gap-2 short-viewport:py-1 md:flex-row">
                <div className="flex flex-col items-center gap-4 short-viewport:gap-2 sm:flex-row">
                    <Link
                        to="/"
                        className="flex items-center gap-3 font-beleren text-2xl short-viewport:text-sm tracking-[0.22em] text-accent-strong"
                    >
                        {/* Light-on-dark variant of the brand mark: same
                            gradients as the source logo, luminance remapped so
                            it reads against the app's dark chrome. Decorative —
                            the wordmark next to it carries the accessible name. */}
                        <img
                            src="/img/logo.svg"
                            alt=""
                            aria-hidden="true"
                            className="h-8 short-viewport:h-4 w-auto shrink-0"
                        />
                        TOLARIA
                    </Link>
                    <nav
                        aria-label="Main"
                        className="flex items-center gap-1 sm:gap-2"
                    >
                        <AppNavLink to="/" exact>
                            Home
                        </AppNavLink>
                        <AppNavLink to="/limited">Limited</AppNavLink>
                        <AppHeaderAdminMenu />
                    </nav>
                </div>

                <AppHeaderProfile />
            </div>
            {/* short-viewport:hidden (issue #2056 defect 3 amplification):
                the divider's own `py-1` plus `pb-2` was ~16-20px of pure
                ornament — cut where the whole nav band's budget is ~40px. */}
            <OrnamentalDivider className="px-5 pb-2 short-viewport:hidden" />
        </header>
    );
}
