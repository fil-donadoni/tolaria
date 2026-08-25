import * as React from "react";
import { cn } from "@/lib/utils";

export type BannerTone =
    | "danger"
    | "info"
    | "prominent"
    | "success"
    | "neutral";

/** v4 strips (ADR 0103 §5 / PRD #2721, issue #2723): every tone is the SAME
 *  quiet strip — surface fill, one hairline edge, body text at the normal
 *  colour — and the tone is carried by the dot and by the edge tint alone.
 *
 *  The v3 recipe tinted the whole box (`bg-danger-soft/40` + `text-danger-strong`,
 *  a 2px accent border for `prominent`), so five simultaneous notices read as
 *  five different components and a plain heads-up looked like an error. The
 *  hues are still the meaning-carrying signal tokens the ADR keeps; they just
 *  live in 8 pixels instead of the whole strip.
 *
 *  `danger` keeps its text colour, and only `danger`: an error message is the
 *  one tone whose TEXT must survive being skimmed, and `danger-strong` is
 *  7.99:1 on surface (plain `danger` as text was a phase-3 failure at 3.43:1). */
const TONE_EDGE: Record<BannerTone, string> = {
    danger: "border-danger/60 text-danger-strong",
    info: "border-[var(--hairline)] text-text",
    prominent: "border-[var(--hairline-strong)] font-medium text-text",
    success: "border-success/50 text-text",
    neutral: "border-[var(--hairline)] text-text-muted",
};

/** The status dot's fill — the one place a banner is allowed to be loud. */
const TONE_DOT: Record<BannerTone, string> = {
    danger: "bg-danger-strong",
    info: "bg-accent",
    prominent: "bg-accent",
    success: "bg-success-strong",
    neutral: "bg-text-disabled",
};

/**
 * The ONE inline notice (phase-3 unification): replaces the 13 copy-pasted
 * banner recipes (the error banner alone existed verbatim in 6 files).
 *
 * - `tone="danger"` — errors; pass `role="alert"`/`aria-live` as needed.
 * - `tone="info"` — neutral heads-up; `title` renders the small-caps lead-in
 *   (e.g. "Incompleteness Notice").
 * - `tone="prominent"` — the heavier strip (active-game notice): a stronger
 *   hairline and a medium weight, not a thicker border and a wash.
 * - `tone="success"` / `"neutral"` — confirmations, quiet notes.
 *
 * A caller may still pass an `icon`; it replaces the dot rather than sitting
 * beside it, so a banner never shows two leading marks.
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
                "flex items-start gap-2.5 rounded-sm border bg-surface px-3 py-2 text-sm",
                TONE_EDGE[tone],
                className
            )}
            {...props}
        >
            {icon ? (
                <span className="mt-0.5 shrink-0">{icon}</span>
            ) : (
                <span
                    data-slot="banner-dot"
                    aria-hidden
                    className={cn(
                        "mt-[0.45rem] size-2 shrink-0 rounded-full",
                        TONE_DOT[tone]
                    )}
                />
            )}
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
