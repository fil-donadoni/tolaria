// The phone-portrait Browse navigation (issue #2582, ADR 0101, PRD #2405 user
// story 6: "a bottom nav with safe-area padding, so that the primary
// destinations are under my thumb").
//
// It replaces the top bar on a portrait phone rather than joining it: two
// bands would cost ~112px of an 844px viewport, which is the budget v3 exists
// to reclaim. `AppShell` mounts exactly one of the two.
//
// HEIGHT CONTRACT. `min-h-14` (`SHELL_BOTTOM_NAV_BAND_PX`) plus
// `env(safe-area-inset-bottom)` for the home indicator, on a `shrink-0` band.
// `min-h-14` and not `h-14`: Tailwind boxes are border-box, so a hard height
// would let the safe-area padding eat the items instead of growing the band,
// and `shellBands` adds the inset ON TOP of `SHELL_BOTTOM_NAV_BAND_PX` —
// and `shellBands`/`resolveShellLayout` subtract BOTH from `<main>`. A bottom
// band that the shell's height model did not know about is the #2056/#2274 bug
// class in a new place: `<main>` would size itself against the full viewport
// and the last row of every page would sit under the nav, unreachable.
//
// "Decks" is deliberately absent. ADR 0101 lists Play · Decks · Limited · Me,
// but there is no `/decks` LIST route today — decks live on the lobby, and the
// route that splits them out belongs to the PRD's lobby slice. A nav item
// pointing at a 404 is worse than three that work; see
// `docs/findings/2582-bottom-nav-decks-destination.md`.
import { Home, Layers } from "lucide-react";
import AppBottomNavItem from "./app-bottom-nav-item";
import AppBottomNavMe from "./app-bottom-nav-me";

export default function AppBottomNav({
    /** A game is in progress — badge the destination that leads back to it. */
    gameBadge = false,
    /** A Limited event is in progress. */
    limitedBadge = false,
}: {
    gameBadge?: boolean;
    limitedBadge?: boolean;
}) {
    return (
        <nav
            aria-label="Primary"
            data-slot="app-bottom-nav"
            className="flex min-h-14 shrink-0 items-stretch gap-1 border-t border-border-subtle bg-surface-raised px-2 pb-[env(safe-area-inset-bottom)]"
        >
            <AppBottomNavItem
                to="/"
                exact
                icon={Home}
                label="Play"
                badge={gameBadge}
            />
            <AppBottomNavItem
                to="/limited"
                icon={Layers}
                label="Limited"
                badge={limitedBadge}
            />
            <AppBottomNavMe />
        </nav>
    );
}
