import type { ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "~/components/ui/button";

interface AdminScopeRailProps {
    open: boolean;
    onToggle: () => void;
    /** Accessible name of the rail landmark. */
    label: string;
    children: ReactNode;
}

/** The collapsible left rail of an admin tool page (PRD #8772): scope, review
 *  progress and the catalogue rows live in `children`; collapsed, only the
 *  toggle stays so the table takes the width. Below 1500px the rail stacks
 *  above the table instead of beside it. */
export default function AdminScopeRail({
    open,
    onToggle,
    label,
    children,
}: AdminScopeRailProps) {
    const Icon = open ? PanelLeftClose : PanelLeftOpen;
    return (
        <aside
            aria-label={label}
            className="flex shrink-0 flex-col gap-3 min-[1500px]:w-80"
        >
            <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-expanded={open}
                aria-label={open ? "Collapse rail" : "Expand rail"}
                onClick={onToggle}
                className="self-start"
            >
                <Icon className="size-4" aria-hidden="true" />
                {open ? "Collapse" : "Rail"}
            </Button>
            {open && children}
        </aside>
    );
}
