import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import {
    getView,
    subscribeToView,
    switchView,
    VIEWS,
    type View,
} from "../lib/view";

const LABELS: Record<View, string> = { now: "Now", history: "History" };

/**
 * Now / History (PRD #3148 S1).
 *
 * Two explicit modes: Now is operations and reads only `/api/loop-status` plus
 * the transcript routes (no database); History is analysis and reads the
 * telemetry store. The active one lives in `?view=`, which is what makes a
 * dashboard link shareable.
 *
 * The state is READ from the URL through `useSyncExternalStore` rather than
 * held in a `useState` beside it. That is not ceremony: the keyboard layer
 * (`dashboard/lib/shortcuts.ts`, #2635) switches views on `1` / `2`
 * without going through React at all, and a local copy would be the thing that
 * disagrees with the URL after a keystroke.
 */
export function ViewTabs() {
    // `getView` and not a local re-read of the query: one function decides
    // what "which view" means, and a second spelling of it here is the thing
    // that answers differently the day `VIEWS` grows a third member. It
    // returns a primitive, so the snapshot is referentially stable and the
    // inline closure cannot loop `useSyncExternalStore`.
    const view = useSyncExternalStore(subscribeToView, getView);
    return (
        <nav className="flex gap-1" role="tablist" aria-label="Dashboard view">
            {VIEWS.map((v) => (
                <button
                    key={v}
                    id={`tab-${v}`}
                    type="button"
                    role="tab"
                    data-view={v}
                    aria-controls={`view-${v}`}
                    aria-selected={v === view}
                    onClick={() => switchView(v)}
                    className={cn(
                        "rounded-md px-3 py-1.5 text-sm transition-colors",
                        v === view
                            ? "bg-secondary text-secondary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    {LABELS[v]}
                </button>
            ))}
        </nav>
    );
}
