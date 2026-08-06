import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";

export interface DeckBuilderHeaderProps {
    title: string;
    backLabel: string;
    onBack: () => void;
    /** Row-1 controls beyond Back + title. */
    actions?: ReactNode;
    /** A full-width second row (the Constructed search filters). */
    filters?: ReactNode;
}

/**
 * The deckbuilder's header band — ONE band for every variant of
 * `DeckBuilderShell` (ADR 0075 §1, issue #1623). Back affordance and title are
 * fixed; everything else arrives through the two slots.
 *
 * **Short-viewport treatment is derived from the slots, not from the caller's
 * identity.** Under `short-viewport:` (`max-height: 500px`, issue #2056
 * defect 2) a band carrying nothing but Back + title HIDES entirely — both are
 * reproduced inside `SaveDeckBar`'s single row, so nothing is lost and the
 * band's ~39px goes to the cards. A band that also carries CONTROLS (search,
 * Format select, filters) cannot do that without taking those controls off the
 * screen with it, so it compacts its padding and title instead. Reading that
 * off slot PRESENCE rather than off a `variant` prop is what keeps the rule
 * true for the third variant (the draft-time Pool's Grouping + Ordering bar,
 * ADR 0075 §6) without anyone revisiting it.
 *
 * The band is a single wrapping flex row so the title's parent element IS the
 * band — the element whose short-viewport treatment the height tests assert.
 * `filters` takes `basis-full`, so it wraps onto its own line beneath.
 */
export default function DeckBuilderHeader({
    title,
    backLabel,
    onBack,
    actions,
    filters,
}: DeckBuilderHeaderProps) {
    const carriesControls = Boolean(actions || filters);
    return (
        <div
            data-deckbuilder-header=""
            className={cn(
                "flex flex-wrap items-center gap-3 border-b border-border-subtle/30 bg-surface/60 px-4 py-3 md:px-6",
                carriesControls
                    ? "short-viewport:gap-1 short-viewport:py-1"
                    : "short-viewport:hidden"
            )}
        >
            <Button variant="ghost" size="sm" onClick={onBack}>
                {backLabel}
            </Button>
            <h1 className="text-lg short-viewport:text-sm font-semibold font-beleren tracking-wide text-parchment">
                {title}
            </h1>
            {actions}
            {filters && (
                <div className="flex basis-full flex-wrap items-center gap-4">
                    {filters}
                </div>
            )}
        </div>
    );
}
