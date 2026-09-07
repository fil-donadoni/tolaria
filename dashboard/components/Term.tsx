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
 *
 * KEYBOARD-REACHABLE (#2629 AC), which is why the trigger carries a
 * `tabIndex`. base-ui opens a tooltip on FOCUS as well as on hover, but a
 * `<span>` is not focusable on its own — so without this the explanation was
 * reachable with a pointer and by nothing else, which is the state #2629
 * exists to end. The vanilla engine wrote `tabindex="0"` onto every declared
 * term for exactly this reason.
 *
 * `focusable={false}` is for the two places where a tab stop here would be
 * WRONG rather than missing: a term rendered inside another control (interactive
 * content inside a `<button>` is not permitted — see `LightButton`), and a term
 * rendered inside an open tooltip's own popup.
 */
export function Term({
    id,
    focusable = true,
    children,
}: {
    id: TermId;
    focusable?: boolean;
    children?: ReactNode;
}) {
    const entry = GLOSSARY[id];
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span
                        tabIndex={focusable ? 0 : undefined}
                        className="cursor-help rounded-sm underline decoration-dotted decoration-from-font underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    />
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
