import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { toneRuleClass, type Tone } from "../lib/tones";

/**
 * The framed section (PRD #3148 S1) — the dashboard's one container.
 *
 * It replaces `sectionHtml`'s head + title + info icon + meta + body, which
 * every card in both views built by string concatenation.
 *
 * NOT built on `src/components/ui/panel.tsx`, deliberately. Panel is the game
 * app's physical chrome: `.panel-physical`, `--panel-radius`, `--panel-pad`,
 * `text-text` and its tone edges are all declared in `src/index.css`, which
 * the dashboard does not import (it has its own Tailwind entry, without
 * Beleren, keyrune or the card-preview safe area — ADR 0117). Reaching for
 * Panel here would mean dragging the game's whole skin in to get a box with a
 * border, and it would drag its DARK-ONLY palette into a surface that has a
 * real light theme. The issue asked for Panel "where it fits"; this is where
 * it does not. What IS shared is the shadcn token vocabulary underneath both.
 *
 * `tone` paints a left rule and nothing else — the frame itself stays quiet,
 * because a section is a container and the verdict belongs to what is inside
 * it.
 */
export function Section({
    title,
    meta,
    tone,
    id,
    className,
    children,
}: {
    title: ReactNode;
    /** The line under the title: what this section counts, or its range. */
    meta?: ReactNode;
    tone?: Tone;
    id?: string;
    className?: string;
    children?: ReactNode;
}) {
    return (
        <section
            id={id}
            className={cn(
                "bg-card text-card-foreground rounded-lg border p-4",
                tone && `border-l-2 ${toneRuleClass(tone)}`,
                className
            )}
        >
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {meta ? (
                <div className="text-muted-foreground mt-0.5 text-xs">
                    {meta}
                </div>
            ) : null}
            <div className="mt-3">{children}</div>
        </section>
    );
}
