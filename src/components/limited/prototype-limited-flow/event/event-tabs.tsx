// PROTOTYPE — throwaway. [Event] [Review the table] — from Games on.
import { cn } from "~/lib/utils";
import type { EventProto, EventTab } from "./use-event-proto";

const TABS: { key: EventTab; label: string }[] = [
    { key: "event", label: "Event" },
    { key: "review", label: "Review the table" },
];

export default function EventTabs({
    p,
    look = "underline",
    className,
}: {
    p: EventProto;
    look?: "underline" | "pill";
    className?: string;
}) {
    if (!p.hasTabs) return null;
    return (
        <div
            role="tablist"
            className={cn(
                "flex",
                look === "underline"
                    ? "gap-5 border-b border-[var(--hairline-strong)]"
                    : "gap-1 rounded-full border border-border-strong bg-surface-base/80 p-1 backdrop-blur",
                className
            )}
        >
            {TABS.map((t) => {
                const on = p.tab === t.key;
                return (
                    <button
                        key={t.key}
                        role="tab"
                        type="button"
                        aria-selected={on}
                        onClick={() => p.setTab(t.key)}
                        className={cn(
                            "text-sm font-semibold transition",
                            look === "underline"
                                ? cn(
                                      "-mb-px border-b-2 px-0.5 pb-2",
                                      on
                                          ? "border-accent text-parchment"
                                          : "border-transparent text-text-muted hover:text-parchment"
                                  )
                                : cn(
                                      "rounded-full px-4 py-1.5",
                                      on
                                          ? "bg-accent text-surface-base"
                                          : "text-text-muted hover:text-parchment"
                                  )
                        )}
                    >
                        {t.label}
                    </button>
                );
            })}
        </div>
    );
}
