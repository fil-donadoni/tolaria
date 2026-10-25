// The header's Admin dropdown. Rendered only for an admin — and that is a
// display decision, not the security boundary: every `/admin/*` route gates
// itself (`AdminRouteGate`, 404 for a non-admin) and every admin query/mutation
// behind those pages gates on `assertIsAdmin` server-side. Hiding the menu just
// keeps the chrome honest about what the viewer can reach.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
    Popover,
    PopoverTrigger,
    PopoverContent,
} from "@/components/ui/popover";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { canViewAdminSection } from "@/lib/adminGating";
import { ADMIN_NAV } from "@/lib/adminNav";
import OverflowNavLink from "./overflow-nav-link";

export default function AppHeaderAdminMenu() {
    const user = useCurrentUser();
    const [open, setOpen] = useState(false);

    if (!canViewAdminSection(user)) return null;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger className="flex min-h-[var(--control-h)] items-center gap-1 rounded-sm px-2 text-xs tracking-[0.14em] uppercase text-text-muted transition-colors hover:text-parchment short-viewport:min-h-[var(--control-h-xs)]">
                Admin
                <ChevronDown className="h-3 w-3" />
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="p-1">
                <nav className="flex min-w-44 flex-col gap-[var(--menu-row-gap)]">
                    {ADMIN_NAV.map((entry) => (
                        <OverflowNavLink
                            key={entry.to}
                            to={entry.to}
                            onClick={() => setOpen(false)}
                            activeClassName="text-accent-strong"
                        >
                            {entry.label}
                        </OverflowNavLink>
                    ))}
                </nav>
            </PopoverContent>
        </Popover>
    );
}
