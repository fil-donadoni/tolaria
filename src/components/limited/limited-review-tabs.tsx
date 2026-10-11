import { cn } from "~/lib/utils";

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
                        aria-selected={on}
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
