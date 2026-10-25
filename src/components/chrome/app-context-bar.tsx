// The Immersive-mode contextual bar (issue #2582, ADR 0101, PRD #2405 user
// story 7: "an immersive surface with an explicit Exit and an overflow menu,
// so that nav never steals space or taps").
//
// 44px (`min-h-[calc(2.75rem_+_env(safe-area-inset-top))]`,
// `SHELL_CONTEXTUAL_BAND_PX` = `--control-h-coarse`) instead of the Browse
// bar's 56px, and it carries no destinations at all —
// one Exit, the surface's title, and an overflow for the two places a user
// might still want to reach. WHERE the Exit goes is not this component's
// decision: it comes from the route's own registry row in `shellChrome.ts`,
// so a new immersive route declares its way out beside its mode rather than
// teaching this file about itself.
//
// `short-viewport:` (issue #2662) shrinks the band to 36px on a landscape
// phone (`SHELL_CONTEXTUAL_COMPACT_BAND_PX`) and its Exit/overflow controls to
// `--control-h-xs` (28px, WCAG 2.5.8 AA floor + margin) — the same
// height-driven split `AppHeader` already applies to the Browse bar
// (`short-viewport:h-10` beside `SHELL_BROWSE_COMPACT_BAND_PX`). 44px is the
// coarse-pointer COMFORT target (ADR 0101 §2), not a viewport rule, and it
// alone ate ~11% of a ~390px-tall landscape-phone screen before the surface
// below it drew anything.
//
// The band, inset padding and compact band live in `ContextualBarFrame`
// (issue #3682), shared with the Draft Room bar; the `min-h` / safe-area
// derivation (issues #2594, #2662) is documented there.
//
// The board (`/game`) never renders this bar — it owns its chrome (`ownChrome`
// in the registry), and its pause menu already offers the exit this would
// duplicate.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import {
    Popover,
    PopoverTrigger,
    PopoverContent,
} from "@/components/ui/popover";
import OverflowNavLink from "./overflow-nav-link";
import ContextualBarFrame from "./contextual-bar-frame";

export default function AppContextBar({
    title,
    exitTo,
}: {
    /** The surface's own name — "Edit deck", "Build your deck". */
    title: string | null;
    /** Concrete path (params already substituted by `resolveShellChrome`). */
    exitTo: string | null;
}) {
    const [open, setOpen] = useState(false);

    return (
        <ContextualBarFrame
            slot="app-context-bar"
            className="justify-between gap-2"
        >
            {exitTo ? (
                <Link
                    to={exitTo}
                    className="flex min-h-[var(--control-h)] items-center gap-1 rounded-sm px-2 text-xs tracking-[0.14em] uppercase text-text-muted transition-colors hover:text-parchment short-viewport:min-h-[var(--control-h-xs)]"
                >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    Exit
                </Link>
            ) : (
                <span />
            )}
            {title && (
                <span className="min-w-0 truncate text-display text-sm tracking-[0.14em] text-accent-strong">
                    {title}
                </span>
            )}
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    aria-label="More"
                    className="flex min-h-[var(--control-h)] min-w-[var(--control-h)] items-center justify-center rounded-sm text-text-muted transition-colors hover:text-parchment data-[state=open]:text-accent-strong short-viewport:min-h-[var(--control-h-xs)] short-viewport:min-w-[var(--control-h-xs)]"
                >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </PopoverTrigger>
                <PopoverContent side="bottom" align="end" className="p-1">
                    <nav
                        aria-label="Overflow"
                        className="flex min-w-40 flex-col gap-[var(--menu-row-gap)]"
                    >
                        <OverflowNavLink to="/" onClick={() => setOpen(false)}>
                            Home
                        </OverflowNavLink>
                        <OverflowNavLink
                            to="/limited"
                            onClick={() => setOpen(false)}
                        >
                            Limited
                        </OverflowNavLink>
                    </nav>
                </PopoverContent>
            </Popover>
        </ContextualBarFrame>
    );
}
