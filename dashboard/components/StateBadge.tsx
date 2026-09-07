import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toneBadgeClass, type Confidence, type Tone } from "../lib/tones";
import { Term } from "./Term";
import type { TermId } from "../glossary";

/**
 * One word, in a state tone (PRD #3148 S2) — a claim's verdict, a pass's
 * outcome, a session's liveness, a receipt's role.
 *
 * `variant="outline"` and a tone class, never a variant per tone: shadcn's
 * badge variants are about EMPHASIS, not meaning (`tones.ts` states the rule),
 * so mapping a tone onto a variant would fork the primitive for a vocabulary
 * only this page has.
 *
 * `term` makes the WORD itself explainable. That is the whole reason the
 * glossary exists as a feature rather than decoration: `claims-held` and
 * `orphan` are the engine's own vocabulary, and a badge that prints one
 * without being able to say what it counts is a raw column name in a rounded
 * box.
 */
export function StateBadge({
    tone,
    term,
    confidence,
    className,
    children,
}: {
    tone: Tone;
    term?: TermId;
    /** `inferred` wears a dashed edge — a deduction, not a measurement. */
    confidence?: Confidence;
    className?: string;
    children: ReactNode;
}) {
    return (
        <Badge
            variant="outline"
            className={cn(toneBadgeClass(tone, confidence), className)}
        >
            {term ? <Term id={term}>{children}</Term> : children}
        </Badge>
    );
}
