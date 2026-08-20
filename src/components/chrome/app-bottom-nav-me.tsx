// The bottom nav's "Me" entry (issue #2582, ADR 0101).
//
// A portrait phone gets no top bar at all, so everything the bar's right-hand
// side carried — nickname, email, sign-out, and the admin section for an
// admin — has to be reachable from the bottom nav or it is reachable nowhere.
// This is that popover: `AppHeaderProfile` verbatim (it already owns the
// nickname edit / sign-out state) plus the admin links.
//
// The admin links are inlined rather than reusing `AppHeaderAdminMenu`, which
// is itself a Popover — nesting one inside another gives two dismiss layers
// over a 390px viewport. `canViewAdminSection` still gates them, and that gate
// is cosmetic in both places: `/admin/*` 404s for a non-admin and every admin
// function asserts server-side.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import {
    Popover,
    PopoverTrigger,
    PopoverContent,
} from "@/components/ui/popover";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { canViewAdminSection } from "@/lib/adminGating";
import { ADMIN_NAV } from "@/lib/adminNav";
import AppHeaderProfile from "./app-header-profile";

export default function AppBottomNavMe() {
    const user = useCurrentUser();
    const [open, setOpen] = useState(false);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger className="flex min-h-[var(--control-h-coarse)] flex-1 flex-col items-center justify-center gap-0.5 rounded-sm text-text-muted transition-colors hover:text-parchment data-[state=open]:text-accent-strong">
                <UserRound className="h-5 w-5" aria-hidden="true" />
                <span className="text-[0.625rem] tracking-[0.14em] uppercase">
                    Me
                </span>
            </PopoverTrigger>
            <PopoverContent
                side="top"
                align="end"
                className="flex max-w-[calc(100vw-1rem)] flex-col gap-2 p-2"
            >
                <AppHeaderProfile />
                {canViewAdminSection(user) && (
                    <nav
                        aria-label="Admin"
                        className="flex flex-col border-t border-border-subtle pt-2"
                    >
                        {ADMIN_NAV.map((entry) => (
                            <Link
                                key={entry.to}
                                to={entry.to}
                                onClick={() => setOpen(false)}
                                className="rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-parchment"
                                activeProps={{
                                    className: "text-accent-strong",
                                }}
                            >
                                {entry.label}
                            </Link>
                        ))}
                    </nav>
                )}
            </PopoverContent>
        </Popover>
    );
}
