import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The cockpit's chrome (issue #5652) — a title, the line saying what the
 * reading covers, the theme toggle, and one page under them. No tabs: the
 * "Now" view went with ADR 0156 Amendment I, the Actions tab is the now.
 */
export function Shell({
    meta,
    children,
}: {
    /** What the reading covers — its window, when it was read. */
    meta: ReactNode;
    children: ReactNode;
}) {
    return (
        <TooltipProvider>
            <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4">
                <header className="flex flex-wrap items-center gap-3">
                    <h1 className="text-base font-semibold tracking-tight">
                        Tolaria cockpit
                    </h1>
                    <span className="text-muted-foreground text-xs">
                        {meta}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                        <ThemeToggle />
                    </div>
                </header>
                <main className="flex flex-col gap-4">{children}</main>
            </div>
        </TooltipProvider>
    );
}
