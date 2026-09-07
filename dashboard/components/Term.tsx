import type { ReactNode } from "react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { GLOSSARY, type TermId } from "../glossary";

/**
 * A glossary term, rendered with its explanation (PRD #3148 S1).
 *
 * This replaces the `data-term` attribute plus the delegated scanner in
 * `scripts/dashboard/tooltip.js`. The scanner existed because the vanilla
 * views paint themselves with `innerHTML`, so there was no render site to hang
 * a tooltip on and a `MutationObserver` had to find them afterwards. A React
 * tree HAS a render site, and using it buys the thing the attribute could
 * never give: `id` is `TermId`, the literal union of the table's own keys, so
 * a typo is a compile error rather than a tooltip that silently never appears.
 *
 * The scanner stays alive until S4 for the views that still paint strings.
 * Both read the same table (`dashboard/glossary.ts`), so they cannot drift.
 *
 * `children` overrides the rendered text for the case where the surface shows
 * a glyph or an already-formatted value; the LABEL is the default, because the
 * point of the glossary is that the page prints words rather than column
 * names.
 */
export function Term({ id, children }: { id: TermId; children?: ReactNode }) {
    const entry = GLOSSARY[id];
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span className="cursor-help underline decoration-dotted decoration-from-font underline-offset-2" />
                }
            >
                {children ?? entry.label}
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-left">
                {entry.tip}
            </TooltipContent>
        </Tooltip>
    );
}
