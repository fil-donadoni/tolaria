import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Section } from "../Section";
import { InfoMark } from "../InfoMark";
import { useFlashedSection } from "../../lib/sections";
import type { TermId } from "../../glossary";

/**
 * A Now-view section: the shared frame, its glossary mark, and the landing
 * highlight a traffic light's jump leaves behind (PRD #3148 S2).
 *
 * `id` is what a light scrolls to (`SECTION_IDS`, `nowLights.ts`) — optional,
 * for the two sections no light targets (the timeline and the activity chart;
 * there is no fifth light).
 *
 * The highlight is a ring driven by the flash store, not an animation class
 * poked onto the node: a repeated click is then an ordinary state change
 * rather than a remove-reflow-re-add dance, and a test can read which section
 * is marked. It is deliberately NOT dropped under `prefers-reduced-motion` —
 * only the smooth scroll is — because a jump with no visible landing point is
 * exactly what the mark exists to prevent.
 */
export function NowSection({
    id,
    term,
    title,
    meta,
    children,
}: {
    id?: string;
    term: TermId;
    title: string;
    /** The right-hand line: what this section counts, or its range. */
    meta?: ReactNode;
    children: ReactNode;
}) {
    const flashed = useFlashedSection();
    return (
        <Section
            id={id}
            className={cn(
                "scroll-mt-4 transition-shadow",
                id && flashed === id && "ring-ring ring-2"
            )}
            title={
                <span className="flex items-center gap-1.5">
                    {title}
                    <InfoMark id={term} what={title} />
                </span>
            }
            meta={meta}
        >
            {children}
        </Section>
    );
}
