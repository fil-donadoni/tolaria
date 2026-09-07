import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CONTROL_CLASS } from "../lib/controls";
import { toggleSheet } from "../lib/shortcuts";
import type { View } from "../lib/view";
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
 * The shortcuts button is the only affordance making the keyboard layer
 * discoverable without already knowing `?` opens it (#2635 AC). S2 wires it
 * straight to the sheet's own store rather than to an id a vanilla module
 * looked up, and drops `<Button>` with it: that primitive's whole appearance
 * is `btn-base` / `btn-tone-*`, custom utilities declared in `src/index.css`,
 * which the dashboard deliberately does not import (ADR 0117) — so it rendered
 * here as unskinned text. Dashboard controls wear `controls.ts`.
 */
export function Shell({
    now,
    history,
    view,
}: {
    now: ReactNode;
    history: ReactNode;
    view: View;
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
                        <button
                            id="shortcuts-btn"
                            type="button"
                            className={CONTROL_CLASS}
                            aria-haspopup="dialog"
                            onClick={toggleSheet}
                        >
                            Keyboard shortcuts
                        </button>
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
