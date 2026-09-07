import type { ReactNode } from "react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { lookupTerm } from "../glossary";

/**
 * A glossary term whose key is only known at RUNTIME (PRD #3148 S2).
 *
 * `<Term>` is the typed door and is what nearly every call site uses: its `id`
 * is `TermId`, so a typo is a compile error. A few keys genuinely cannot be
 * typed, because they are composed from a value the SERVER supplies and whose
 * set this page does not own — a receipt's `role`, a claim's `stage` as it
 * arrives on the wire. `lookupTerm` is the documented runtime door for exactly
 * that, with its own qualify-then-fallback policy.
 *
 * A key that resolves to nothing renders the text WITHOUT a tooltip rather
 * than an empty one: an affordance that opens on hover and then says nothing
 * is worse than no affordance. `dashboard-glossary.test.ts` is what keeps the
 * server's vocabularies covered, so this fallback should never be reached in
 * practice — it exists so that when it is, the page still reads.
 */
export function DynamicTerm({
    term,
    children,
}: {
    term: string;
    children: ReactNode;
}) {
    const entry = lookupTerm(term);
    if (!entry) return <>{children}</>;
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span className="cursor-help underline decoration-dotted decoration-from-font underline-offset-2" />
                }
            >
                {children}
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-left">
                {entry.tip}
            </TooltipContent>
        </Tooltip>
    );
}
