import * as React from "react";
import { cn } from "@/lib/utils";

export type BannerTone =
    | "danger"
    | "info"
    | "prominent"
    | "success"
    | "neutral";

const TONE_CLASSES: Record<BannerTone, string> = {
    /* danger text is danger-strong (7.99:1 on surface — the 3.43:1 `danger`
       as text was a phase-3 contrast failure) */
    danger: "border-danger/60 bg-danger-soft/40 text-danger-strong",
    info: "border-accent/40 bg-accent-soft/30 text-text",
    prominent: "border-2 border-accent bg-accent/15 font-medium text-text",
    success: "border-success/50 bg-success-soft/40 text-success-strong",
    neutral: "border-border-subtle bg-surface-elevated/30 text-text-muted",
};

/**
 * The ONE inline notice (phase-3 unification): replaces the 13 copy-pasted
 * banner recipes (the error banner alone existed verbatim in 6 files).
 *
 * - `tone="danger"` — errors; pass `role="alert"`/`aria-live` as needed.
 * - `tone="info"` — neutral heads-up; `title` renders the small-caps lead-in
 *   (e.g. "Incompleteness Notice").
 * - `tone="prominent"` — the heavier accent strip (active-game notice).
 * - `tone="success"` / `"neutral"` — confirmations, quiet notes.
 */
function Banner({
    tone,
    title,
    icon,
    className,
    children,
    ...props
}: {
    tone: BannerTone;
    /** Small-caps lead-in rendered before the body (info notes). */
    title?: React.ReactNode;
    icon?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
} & React.ComponentProps<"div">) {
    return (
        <div
            data-slot="banner"
            data-tone={tone}
            className={cn(
                "flex items-start gap-2 rounded-sm border px-3 py-2 text-sm",
                TONE_CLASSES[tone],
                className
            )}
            {...props}
        >
            {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
            <div className="min-w-0 flex-1">
                {title && (
                    <span className="mr-1 font-semibold tracking-wide uppercase">
                        {title}
                        {" — "}
                    </span>
                )}
                {children}
            </div>
        </div>
    );
}

export { Banner };
