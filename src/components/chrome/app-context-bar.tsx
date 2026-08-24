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
        <div
            data-slot="app-context-bar"
            // `min-h`, not `h` (issue #2594): this bar is the FIRST thing
            // rendered in Immersive mode — flush against the shell's own top
            // edge, with nothing above it, so in a standalone PWA launch (no
            // browser chrome already clearing the notch) it needs
            // `pt-[env(safe-area-inset-top)]` to keep Exit/title/overflow out
            // from under a notch/dynamic island. A FIXED `h-11` would squeeze
            // that same content into a shorter box on a device where the
            // inset is nonzero — `min-h` avoids that, but a min-height that
            // does not ITSELF include the inset does not fix it either
            // (issue #2662 review): this element is `border-box`, so its
            // rendered height is `max(natural, min-height)` where `natural`
            // already includes the padding — `min-height` and `padding-top`
            // are NOT independent terms that sum. A bare `min-h-9` (36px)
            // against a 28px control + a nonzero inset resolves to
            // `content + inset + border`, i.e. the inset is ABSORBED by the
            // band's own slack instead of adding to it (measured: a 20px
            // inset yielded 49px, not 36+20=56). Folding the inset INTO the
            // min-height (`calc(<band>rem + env(...))`) instead of leaving it
            // to the padding alone is what makes the floor `band + inset`:
            // natural height stays `content + inset + border`, which is
            // always below `band + inset` (content + border < band at both
            // rungs bar the coarse-pointer 44px/44px coincidence noted below),
            // so the min-height wins and the box lands at exactly
            // `band + inset`. `<main>`'s sibling `flex-1 min-h-0` (not a
            // hardcoded subtraction) already fills whatever's actually left,
            // so this never needs `SHELL_CONTEXTUAL_BAND_PX` /
            // `SHELL_CONTEXTUAL_COMPACT_BAND_PX` to change — those constants
            // are, and remain, the zero-inset case per viewport (issue
            // #2662). (A coarse-pointer device where `--control-h` itself
            // equals the 44px band — content + a 1px border then exceeds the
            // band by 1px regardless of inset — is a pre-existing,
            // independent-of-this-fix rounding edge, not the absorption bug
            // this comment is about.)
            className="flex min-h-[calc(2.75rem_+_env(safe-area-inset-top))] shrink-0 items-center justify-between gap-2 border-b border-border-subtle bg-surface-raised px-2 pt-[env(safe-area-inset-top)] short-viewport:min-h-[calc(2.25rem_+_env(safe-area-inset-top))]"
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
                <span className="min-w-0 truncate font-beleren text-sm tracking-[0.14em] text-accent-strong">
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
                        className="flex min-w-40 flex-col"
                    >
                        <Link
                            to="/"
                            onClick={() => setOpen(false)}
                            className="rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-parchment"
                        >
                            Home
                        </Link>
                        <Link
                            to="/limited"
                            onClick={() => setOpen(false)}
                            className="rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-parchment"
                        >
                            Limited
                        </Link>
                    </nav>
                </PopoverContent>
            </Popover>
        </div>
    );
}
