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
            <CornerFiligreeFrame overlay size={32} subtle />
            <div className="flex flex-col items-center justify-between gap-4 px-5 py-3 md:flex-row">
                <div className="flex flex-col items-center gap-4 sm:flex-row">
                    <Link
                        to="/"
                        className="font-beleren text-2xl tracking-[0.22em] text-accent-strong"
                    >
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
            <OrnamentalDivider className="px-5 pb-2" />
        </header>
    );
}
