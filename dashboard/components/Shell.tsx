import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle } from "./ThemeToggle";
import { ViewTabs } from "./ViewTabs";

/**
 * The dashboard's chrome (PRD #3148 S1) — header, tabs, theme, shortcuts.
 *
 * The two view panels are rendered by the caller and shown/hidden here, by the
 * SAME `?view=` value the tabs write. `hidden` rather than unmounting: the
 * vanilla modules that still fill both panels resolve their elements once, at
 * import time, and an unmounted History would take every one of those handles
 * with it. S3 makes that a real choice again.
 *
 * `#shortcuts-btn` keeps its id because `scripts/dashboard/shortcuts.js`
 * (#2635) binds the sheet to it — that button is the only affordance making
 * the keyboard layer discoverable without already knowing `?` opens it.
 */
export function Shell({
    now,
    history,
    view,
}: {
    now: ReactNode;
    history: ReactNode;
    view: "now" | "history";
}) {
    return (
        <TooltipProvider>
            <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4">
                <header className="flex flex-wrap items-center gap-3">
                    <h1 className="text-base font-semibold tracking-tight">
                        Tolaria telemetry
                    </h1>
                    <span
                        className="text-muted-foreground text-xs"
                        id="meta-line"
                    >
                        loading…
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                        <Button
                            id="shortcuts-btn"
                            type="button"
                            variant="secondary"
                            size="sm"
                            aria-haspopup="dialog"
                        >
                            Keyboard shortcuts
                        </Button>
                        <ThemeToggle />
                    </div>
                </header>

                <ViewTabs />

                <div
                    id="view-now"
                    role="tabpanel"
                    aria-labelledby="tab-now"
                    hidden={view !== "now"}
                    className="flex flex-col gap-4"
                >
                    {now}
                </div>
                <div
                    id="view-history"
                    role="tabpanel"
                    aria-labelledby="tab-history"
                    hidden={view !== "history"}
                    className="flex flex-col gap-4"
                >
                    {history}
                </div>
            </div>
        </TooltipProvider>
    );
}
