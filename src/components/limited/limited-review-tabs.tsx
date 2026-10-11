import { cn } from "~/lib/utils";

export const EVENT_PANEL_ID = "event-page-panel";

export type EventPageTab = "event" | "review";

const TABS: { key: EventPageTab; label: string }[] = [
    { key: "event", label: "Event" },
    { key: "review", label: "Review the table" },
];

/** The event page's [Event] [Review the table] switcher (issue #5392). The
 *  caller renders it only once the Play Phase has begun. */
export default function LimitedReviewTabs({
    tab,
    onChange,
}: {
    tab: EventPageTab;
    onChange: (tab: EventPageTab) => void;
}) {
    return (
        <div
            role="tablist"
            aria-label="Event page"
            className="flex gap-5 border-b border-border-subtle/40"
        >
            {TABS.map((t) => {
                const on = tab === t.key;
                return (
                    <button
                        key={t.key}
                        role="tab"
                        type="button"
                        id={`event-tab-${t.key}`}
                        aria-selected={on}
                        aria-controls={EVENT_PANEL_ID}
                        tabIndex={on ? 0 : -1}
                        onKeyDown={(e) => {
                            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
                                return;
                            const next = TABS.find((o) => o.key !== t.key)!;
                            onChange(next.key);
                            document
                                .getElementById(`event-tab-${next.key}`)
                                ?.focus();
                        }}
                        onClick={() => onChange(t.key)}
                        className={cn(
                            "-mb-px border-b-2 px-0.5 pb-2 text-sm font-semibold transition",
                            on
                                ? "border-accent text-parchment"
                                : "border-transparent text-text-muted hover:text-parchment"
                        )}
                    >
                        {t.label}
                    </button>
                );
            })}
        </div>
    );
}
